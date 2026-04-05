// ---------------------------------------------------------------------------
// friends tab — list, detail, and add-friend sub-views
// ---------------------------------------------------------------------------

import { Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import {
  isOnline as bridgeIsOnline,
  isProtocolReady as bridgeIsProtocolReady,
  onOnlineChange,
  sendFriendRequest,
} from "../../../src/p2p/friendz-bridge";
import { createSkeinInput, type SkeinInputHandle } from "../../../src/widgets/skein-input";
import {
  ACCENT,
  BG,
  BORDER,
  BUTTON_GAP,
  BUTTON_HEIGHT,
  BUTTON_RADIUS,
  FIELD_BG,
  FIELD_BORDER,
  FIELD_GAP,
  FIELD_HEIGHT,
  FONT,
  LABEL_COLOR,
  LABEL_SIZE,
  MUTED_TEXT,
  OFFLINE_COLOR,
  ONLINE_COLOR,
  ONLINE_DOT_BORDER,
  ONLINE_DOT_SIZE,
  OPTION_FONT_SIZE,
  OPTION_PILL_GAP,
  OPTION_PILL_HEIGHT,
  OPTION_PILL_RADIUS,
  PADDING_X,
  REJECT_COLOR,
  RESOLUTION,
  ROW_ALT_BG,
  ROW_AVATAR_SIZE,
  ROW_HEIGHT,
  ROW_NAME_SIZE,
  ROW_PADDING_X,
  ROW_SUB_SIZE,
  SCROLL_SPEED,
  TAB_FONT_SIZE,
  TEXT_COLOR,
  TEXT_SIZE,
} from "./constants";
import {
  colorForName,
  friendDisplayName,
  friendDisplayNameFull,
  isValidNodeId,
  truncate,
} from "./helpers";
import type { FriendEntry, FriendGroup } from "./schema";
import type { TabContext, TabController } from "./types";

// ---------------------------------------------------------------------------
// detail view local constants
// ---------------------------------------------------------------------------

const DETAIL_AVATAR_SIZE = 48;
const DETAIL_NAME_SIZE = 16;
const DETAIL_BIO_SIZE = 11;
const DETAIL_NODEID_SIZE = 10;
const DETAIL_BTN_HEIGHT = 32;
const DETAIL_BTN_RADIUS = 4;
const COPY_FEEDBACK_MS = 1500;

// ---------------------------------------------------------------------------
// collapsed groups — module-level singleton state
// ---------------------------------------------------------------------------

const collapsedGroups = new Set<string>();

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------

export function createFriendsTab(ctx: TabContext): TabController {
  const container = new Container();
  container.eventMode = "static";

  let currentWidth = 0;
  let currentHeight = 0;

  // internal sub-view mode (managed entirely by this tab)
  let viewMode: "list" | "detail" | "add" = "list";

  // selected friend for detail view
  let selectedFriendId: string | null = null;

  // scroll state for the list view
  let scrollY = 0;

  // detail view editing state
  let editingAlias = false;
  let aliasInputHandle: SkeinInputHandle | null = null;
  let editingNewGroup = false;
  let groupInputHandle: SkeinInputHandle | null = null;

  // ---------------------------------------------------------------------------
  // friend list area (scrollable, masked)
  // ---------------------------------------------------------------------------

  const listContainer = new Container();
  listContainer.eventMode = "static";
  container.addChild(listContainer);

  const listMask = new Graphics();
  container.addChild(listMask);
  listContainer.mask = listMask;

  // inner container for friend rows — positioned by scrollY
  const listInner = new Container();
  listInner.eventMode = "static";
  listContainer.addChild(listInner);

  // placeholder text for empty state
  const emptyText = new Text({
    text: "no friends yet",
    style: {
      fontFamily: FONT,
      fontSize: 11,
      fill: MUTED_TEXT,
    },
    resolution: RESOLUTION,
  });
  emptyText.eventMode = "none";
  container.addChild(emptyText);

  // scroll handler on the list container — only capture when content overflows
  listContainer.on("wheel", (e: WheelEvent) => {
    const canScroll = totalListHeight > listAreaHeight;
    if (!canScroll) return; // let the event pass through to the canvas viewport

    e.stopPropagation();
    // claim the native event so the viewport doesn't also pan
    if ((e as any).nativeEvent) (e as any).nativeEvent._skeinWidgetScroll = true;
    scrollY += e.deltaY > 0 ? SCROLL_SPEED : -SCROLL_SPEED;
    clampScroll();
    positionListInner();
  });

  let listAreaHeight = 0;
  let totalListHeight = 0;

  const clampScroll = () => {
    const maxScroll = Math.max(0, totalListHeight - listAreaHeight);
    scrollY = Math.max(0, Math.min(scrollY, maxScroll));
  };

  const positionListInner = () => {
    listInner.y = -scrollY;
  };

  // ---------------------------------------------------------------------------
  // rebuild friend rows
  // ---------------------------------------------------------------------------

  const rebuildRows = (friends: FriendEntry[], contentW: number) => {
    // destroy old children of listInner
    while (listInner.children.length > 0) {
      listInner.removeChildAt(0).destroy({ children: true });
    }

    const maxNameChars = Math.max(
      6,
      Math.floor((contentW - ROW_AVATAR_SIZE - ROW_PADDING_X * 4) / (ROW_NAME_SIZE * 0.55))
    );

    // group friends by their group field
    const grouped = new Map<string, FriendEntry[]>();
    const ungrouped: FriendEntry[] = [];

    for (const friend of friends) {
      if (friend.group) {
        const existing = grouped.get(friend.group);
        if (existing) {
          existing.push(friend);
        } else {
          grouped.set(friend.group, [friend]);
        }
      } else {
        ungrouped.push(friend);
      }
    }

    // sort group names alphabetically
    const sortedGroupNames = [...grouped.keys()].sort((a, b) => a.localeCompare(b));

    // build the ordered list of items to render
    type RowItem =
      | { type: "header"; group: string; count: number }
      | { type: "friend"; friend: FriendEntry };
    const items: RowItem[] = [];

    for (const groupName of sortedGroupNames) {
      const groupFriends = grouped.get(groupName)!;
      items.push({ type: "header", group: groupName, count: groupFriends.length });
      if (!collapsedGroups.has(groupName)) {
        for (const friend of groupFriends) {
          items.push({ type: "friend", friend });
        }
      }
    }

    // ungrouped friends at the end without a header
    for (const friend of ungrouped) {
      items.push({ type: "friend", friend });
    }

    let friendRowIndex = 0;
    let currentY = 0;

    for (const item of items) {
      if (item.type === "header") {
        // render group header row
        const headerRow = new Container();
        headerRow.eventMode = "static";
        headerRow.cursor = "pointer";
        headerRow.hitArea = new Rectangle(0, 0, contentW, ROW_HEIGHT);
        headerRow.y = currentY;
        listInner.addChild(headerRow);

        const headerBg = new Graphics();
        headerBg.eventMode = "none";
        headerBg.rect(0, 0, contentW, ROW_HEIGHT);
        headerBg.fill({ color: 0x1c1c28 });
        headerRow.addChild(headerBg);

        const isCollapsed = collapsedGroups.has(item.group);
        const chevronChar = isCollapsed ? "\u25b8" : "\u25be";
        const chevronText = new Text({
          text: chevronChar,
          style: { fontFamily: FONT, fontSize: 11, fill: LABEL_COLOR },
          resolution: RESOLUTION,
        });
        chevronText.eventMode = "none";
        chevronText.x = ROW_PADDING_X;
        chevronText.y = (ROW_HEIGHT - 11) / 2;
        headerRow.addChild(chevronText);

        const groupNameText = new Text({
          text: item.group,
          style: { fontFamily: FONT, fontSize: 11, fontWeight: "bold", fill: LABEL_COLOR },
          resolution: RESOLUTION,
        });
        groupNameText.eventMode = "none";
        groupNameText.x = ROW_PADDING_X + chevronText.width + 6;
        groupNameText.y = (ROW_HEIGHT - 11) / 2;
        headerRow.addChild(groupNameText);

        // count badge on the right
        const countText = new Text({
          text: String(item.count),
          style: { fontFamily: FONT, fontSize: 10, fill: MUTED_TEXT },
          resolution: RESOLUTION,
        });
        countText.eventMode = "none";
        countText.x = contentW - ROW_PADDING_X - countText.width;
        countText.y = (ROW_HEIGHT - 10) / 2;
        headerRow.addChild(countText);

        const groupName = item.group;
        headerRow.on("pointertap", (e) => {
          e.stopPropagation();
          if (collapsedGroups.has(groupName)) {
            collapsedGroups.delete(groupName);
          } else {
            collapsedGroups.add(groupName);
          }
          layout(currentWidth, currentHeight);
        });

        currentY += ROW_HEIGHT;
      } else {
        // render friend row
        const friend = item.friend;
        const i = friendRowIndex;
        friendRowIndex++;

        const rowContainer = new Container();
        rowContainer.eventMode = "static";
        rowContainer.cursor = "pointer";
        rowContainer.hitArea = new Rectangle(0, 0, contentW, ROW_HEIGHT);
        rowContainer.y = currentY;
        listInner.addChild(rowContainer);

        // alternating row background
        const rowBg = new Graphics();
        rowBg.eventMode = "none";
        rowBg.rect(0, 0, contentW, ROW_HEIGHT);
        if (i % 2 === 1) {
          rowBg.fill({ color: ROW_ALT_BG, alpha: 0.5 });
        } else {
          rowBg.fill({ color: BG, alpha: 0.01 });
        }
        rowContainer.addChild(rowBg);

        // avatar circle with initial letter
        const displayName = friendDisplayName(friend);
        const avatarColor = colorForName(displayName, i);
        const avatarX = ROW_PADDING_X + ROW_AVATAR_SIZE / 2;
        const avatarY = ROW_HEIGHT / 2;

        const avatarUrl = friend.nodeIds.find((n) => n.avatarDataUrl)?.avatarDataUrl;

        const avatar = new Graphics();
        avatar.eventMode = "none";
        avatar.circle(avatarX, avatarY, ROW_AVATAR_SIZE / 2);
        avatar.fill({ color: avatarColor });
        rowContainer.addChild(avatar);

        const initial = displayName.charAt(0).toUpperCase() || "?";
        const avatarLetter = new Text({
          text: initial,
          style: {
            fontFamily: FONT,
            fontSize: 11,
            fontWeight: "bold",
            fill: 0xffffff,
            align: "center",
          },
          resolution: RESOLUTION,
        });
        avatarLetter.eventMode = "none";
        avatarLetter.anchor.set(0.5);
        avatarLetter.x = avatarX;
        avatarLetter.y = avatarY;
        rowContainer.addChild(avatarLetter);

        // async avatar image overlay
        if (avatarUrl) {
          const cacheKey = `friend-avatar-${friend.id}`;
          Assets.load({ src: avatarUrl, alias: cacheKey })
            .then((texture) => {
              if (rowContainer.destroyed) return;
              const avatarSprite = new Sprite(texture);
              avatarSprite.eventMode = "none";
              avatarSprite.width = ROW_AVATAR_SIZE;
              avatarSprite.height = ROW_AVATAR_SIZE;
              avatarSprite.x = avatarX - ROW_AVATAR_SIZE / 2;
              avatarSprite.y = avatarY - ROW_AVATAR_SIZE / 2;

              const spriteMask = new Graphics();
              spriteMask.circle(avatarX, avatarY, ROW_AVATAR_SIZE / 2);
              spriteMask.fill({ color: 0xffffff });
              rowContainer.addChild(spriteMask);
              avatarSprite.mask = spriteMask;
              rowContainer.addChild(avatarSprite);

              avatar.visible = false;
              avatarLetter.visible = false;
            })
            .catch(() => {});
        }

        // online/offline dot — overlaid on avatar bottom-right with border ring
        const isAnyNodeOnline = friend.nodeIds.some((n) => bridgeIsOnline(n.nodeId));
        const dotColor = isAnyNodeOnline ? ONLINE_COLOR : OFFLINE_COLOR;
        const dotCx = avatarX + ROW_AVATAR_SIZE / 2 - ONLINE_DOT_SIZE / 2 + 1;
        const dotCy = avatarY + ROW_AVATAR_SIZE / 2 - ONLINE_DOT_SIZE / 2 + 1;

        const onlineDot = new Graphics();
        onlineDot.eventMode = "none";
        // border ring (matches parent background)
        onlineDot.circle(dotCx, dotCy, ONLINE_DOT_SIZE / 2 + ONLINE_DOT_BORDER);
        onlineDot.fill({ color: BG });
        // inner dot
        onlineDot.circle(dotCx, dotCy, ONLINE_DOT_SIZE / 2);
        onlineDot.fill({ color: dotColor });
        rowContainer.addChild(onlineDot);

        // name text — vertically centered
        const textX = ROW_PADDING_X + ROW_AVATAR_SIZE + ROW_PADDING_X;
        // primary name label (bold) — username or alias
        const nameText = new Text({
          text: truncate(displayName || "unnamed", maxNameChars),
          style: {
            fontFamily: FONT,
            fontSize: ROW_NAME_SIZE,
            fontWeight: "bold",
            fill: TEXT_COLOR,
          },
          resolution: RESOLUTION,
        });
        nameText.eventMode = "none";
        nameText.x = textX;
        nameText.y = (ROW_HEIGHT - ROW_NAME_SIZE) / 2;
        rowContainer.addChild(nameText);

        // if the friend has both a username and an alias, show the alias
        // after the name in italic parentheses: "bob (bestie)"
        if (friend.username && friend.alias) {
          const aliasText = new Text({
            text: ` (${truncate(friend.alias, 12)})`,
            style: {
              fontFamily: FONT,
              fontSize: ROW_NAME_SIZE,
              fontStyle: "italic",
              fill: MUTED_TEXT,
            },
            resolution: RESOLUTION,
          });
          aliasText.eventMode = "none";
          aliasText.x = textX + nameText.width;
          aliasText.y = (ROW_HEIGHT - ROW_NAME_SIZE) / 2;
          rowContainer.addChild(aliasText);
        }

        // chevron hint on the right
        const chevron = new Text({
          text: "\u203a",
          style: { fontFamily: FONT, fontSize: 16, fill: MUTED_TEXT },
          resolution: RESOLUTION,
        });
        chevron.eventMode = "none";
        chevron.x = contentW - ROW_PADDING_X - chevron.width;
        chevron.y = (ROW_HEIGHT - 16) / 2;
        rowContainer.addChild(chevron);

        // click row -> open detail view
        const friendId = friend.id;
        rowContainer.on("pointertap", (e) => {
          e.stopPropagation();
          selectedFriendId = friendId;
          viewMode = "detail";
          scrollY = 0;
          layout(currentWidth, currentHeight);
        });

        // hover effect
        rowContainer.on("pointerover", () => {
          rowBg.clear();
          rowBg.rect(0, 0, contentW, ROW_HEIGHT);
          rowBg.fill({ color: 0x252536, alpha: 0.8 });
        });
        rowContainer.on("pointerout", () => {
          rowBg.clear();
          rowBg.rect(0, 0, contentW, ROW_HEIGHT);
          if (i % 2 === 1) {
            rowBg.fill({ color: ROW_ALT_BG, alpha: 0.5 });
          } else {
            rowBg.fill({ color: BG, alpha: 0.01 });
          }
        });

        currentY += ROW_HEIGHT;
      }
    }

    totalListHeight = currentY;
  };

  // ---------------------------------------------------------------------------
  // detail view
  // ---------------------------------------------------------------------------

  const detailContainer = new Container();
  detailContainer.eventMode = "static";
  detailContainer.visible = false;
  container.addChild(detailContainer);

  const rebuildDetailView = (friend: FriendEntry, contentW: number, areaHeight: number) => {
    // clean up any existing input handles before destroying children
    if (aliasInputHandle) {
      aliasInputHandle.destroy();
      aliasInputHandle = null;
    }
    if (groupInputHandle) {
      groupInputHandle.destroy();
      groupInputHandle = null;
    }

    while (detailContainer.children.length > 0) {
      detailContainer.removeChildAt(0).destroy({ children: true });
    }

    let dy = 0;

    // back button
    const backBtn = new Container();
    backBtn.eventMode = "static";
    backBtn.cursor = "pointer";
    const backText = new Text({
      text: "\u2039 friends",
      style: { fontFamily: FONT, fontSize: TAB_FONT_SIZE, fill: ACCENT },
      resolution: RESOLUTION,
    });
    backText.eventMode = "none";
    backBtn.addChild(backText);
    backBtn.hitArea = new Rectangle(0, 0, backText.width + 8, backText.height + 4);
    backBtn.on("pointertap", (e) => {
      e.stopPropagation();
      selectedFriendId = null;
      viewMode = "list";
      editingAlias = false;
      editingNewGroup = false;
      scrollY = 0;
      layout(currentWidth, currentHeight);
    });
    detailContainer.addChild(backBtn);
    dy += backText.height + 12;

    // avatar — large centered circle
    const displayName = friendDisplayName(friend);
    const avatarColor = colorForName(displayName, 0);
    const avatarCx = contentW / 2;
    const avatarCy = dy + DETAIL_AVATAR_SIZE / 2;

    const avatarUrl = friend.nodeIds.find((n) => n.avatarDataUrl)?.avatarDataUrl;

    const avatarCircle = new Graphics();
    avatarCircle.eventMode = "none";
    avatarCircle.circle(avatarCx, avatarCy, DETAIL_AVATAR_SIZE / 2);
    avatarCircle.fill({ color: avatarColor });
    detailContainer.addChild(avatarCircle);

    const initial = displayName.charAt(0).toUpperCase() || "?";
    const avatarInitial = new Text({
      text: initial,
      style: {
        fontFamily: FONT,
        fontSize: 20,
        fontWeight: "bold",
        fill: 0xffffff,
        align: "center",
      },
      resolution: RESOLUTION,
    });
    avatarInitial.eventMode = "none";
    avatarInitial.anchor.set(0.5);
    avatarInitial.x = avatarCx;
    avatarInitial.y = avatarCy;
    detailContainer.addChild(avatarInitial);

    if (avatarUrl) {
      // helper to overlay the avatar sprite once we have a texture
      const applyAvatarTexture = (texture: Texture) => {
        if (avatarCircle.destroyed) return;
        const avatarSprite = new Sprite(texture);
        avatarSprite.eventMode = "none";
        avatarSprite.width = DETAIL_AVATAR_SIZE;
        avatarSprite.height = DETAIL_AVATAR_SIZE;
        avatarSprite.x = avatarCx - DETAIL_AVATAR_SIZE / 2;
        avatarSprite.y = avatarCy - DETAIL_AVATAR_SIZE / 2;

        const spriteMask = new Graphics();
        spriteMask.circle(avatarCx, avatarCy, DETAIL_AVATAR_SIZE / 2);
        spriteMask.fill({ color: 0xffffff });
        detailContainer.addChild(spriteMask);
        avatarSprite.mask = spriteMask;
        detailContainer.addChild(avatarSprite);

        avatarCircle.visible = false;
        avatarInitial.visible = false;
      };

      // try synchronous cache first (list view may have loaded it already)
      const cacheKey = `friend-avatar-${friend.id}`;
      const cached = Assets.get<Texture>(cacheKey);
      if (cached) {
        applyAvatarTexture(cached);
      } else {
        // fallback: load via an Image element (data URLs resolve ~instantly)
        const img = new Image();
        img.onload = () => {
          try {
            const texture = Texture.from({ resource: img, label: cacheKey });
            applyAvatarTexture(texture);
          } catch {
            // texture creation failed — keep the fallback circle
          }
        };
        img.src = avatarUrl;
      }
    }

    dy += DETAIL_AVATAR_SIZE + 10;

    // online status dot + text
    const isOnline = friend.nodeIds.some((n) => bridgeIsOnline(n.nodeId));
    const statusDot = new Graphics();
    statusDot.eventMode = "none";
    const statusColor = isOnline ? ONLINE_COLOR : OFFLINE_COLOR;
    const statusLabel = isOnline ? "online" : "offline";
    const statusText = new Text({
      text: statusLabel,
      style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
      resolution: RESOLUTION,
    });
    statusText.eventMode = "none";
    const statusTotalW = ONLINE_DOT_SIZE + 4 + statusText.width;
    const statusStartX = (contentW - statusTotalW) / 2;
    statusDot.circle(
      statusStartX + ONLINE_DOT_SIZE / 2,
      dy + statusText.height / 2,
      ONLINE_DOT_SIZE / 2
    );
    statusDot.fill({ color: statusColor });
    detailContainer.addChild(statusDot);
    statusText.x = statusStartX + ONLINE_DOT_SIZE + 4;
    statusText.y = dy;
    detailContainer.addChild(statusText);
    dy += statusText.height + 8;

    // display name — centered
    const nameText = new Text({
      text: friendDisplayNameFull(friend),
      style: {
        fontFamily: FONT,
        fontSize: DETAIL_NAME_SIZE,
        fontWeight: "bold",
        fill: TEXT_COLOR,
      },
      resolution: RESOLUTION,
    });
    nameText.eventMode = "none";
    nameText.x = Math.max(0, (contentW - nameText.width) / 2);
    nameText.y = dy;
    detailContainer.addChild(nameText);
    dy += DETAIL_NAME_SIZE + 6;

    // -----------------------------------------------------------------------
    // alias section — inline editing
    // -----------------------------------------------------------------------

    const aliasLabel = new Text({
      text: "alias",
      style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
      resolution: RESOLUTION,
    });
    aliasLabel.eventMode = "none";
    aliasLabel.x = 0;
    aliasLabel.y = dy;
    detailContainer.addChild(aliasLabel);
    dy += LABEL_SIZE + 4;

    if (editingAlias) {
      // editing mode — show input field with save/cancel
      aliasInputHandle = createSkeinInput({
        canvasElement: ctx.canvasElement,
        width: contentW,
        height: FIELD_HEIGHT,
        value: friend.alias,
        onChange: () => {},
      });
      aliasInputHandle.input.x = 0;
      aliasInputHandle.input.y = dy;
      detailContainer.addChild(aliasInputHandle.input);
      dy += FIELD_HEIGHT + 6;

      // save button
      const aliasSaveBtn = new Container();
      aliasSaveBtn.eventMode = "static";
      aliasSaveBtn.cursor = "pointer";
      const aliasSaveBg = new Graphics();
      aliasSaveBg.eventMode = "none";
      const aliasSaveText = new Text({
        text: "save",
        style: { fontFamily: FONT, fontSize: 9, fill: 0xffffff },
        resolution: RESOLUTION,
      });
      aliasSaveText.eventMode = "none";
      const savePadX = 10;
      const savePadY = 4;
      const saveW = aliasSaveText.width + savePadX * 2;
      const saveH = aliasSaveText.height + savePadY * 2;
      aliasSaveBg.roundRect(0, 0, saveW, saveH, 3);
      aliasSaveBg.fill({ color: ACCENT });
      aliasSaveBtn.addChild(aliasSaveBg);
      aliasSaveText.x = savePadX;
      aliasSaveText.y = savePadY;
      aliasSaveBtn.addChild(aliasSaveText);
      aliasSaveBtn.hitArea = new Rectangle(0, 0, saveW, saveH);
      aliasSaveBtn.x = 0;
      aliasSaveBtn.y = dy;
      const savedFriendId = friend.id;
      aliasSaveBtn.on("pointertap", (e) => {
        e.stopPropagation();
        const newValue = aliasInputHandle ? aliasInputHandle.value.trim() : "";
        editingAlias = false;
        ctx.doc.change((draft) => {
          const idx = draft.friends.findIndex((f: FriendEntry) => f.id === savedFriendId);
          if (idx !== -1) draft.friends[idx].alias = newValue;
        });
      });
      detailContainer.addChild(aliasSaveBtn);

      // cancel button
      const aliasCancelBtn = new Container();
      aliasCancelBtn.eventMode = "static";
      aliasCancelBtn.cursor = "pointer";
      const aliasCancelBg = new Graphics();
      aliasCancelBg.eventMode = "none";
      const aliasCancelText = new Text({
        text: "cancel",
        style: { fontFamily: FONT, fontSize: 9, fill: MUTED_TEXT },
        resolution: RESOLUTION,
      });
      aliasCancelText.eventMode = "none";
      const cancelPadX = 10;
      const cancelPadY = 4;
      const cancelW = aliasCancelText.width + cancelPadX * 2;
      const cancelH = aliasCancelText.height + cancelPadY * 2;
      aliasCancelBg.roundRect(0, 0, cancelW, cancelH, 3);
      aliasCancelBg.fill({ color: FIELD_BG });
      aliasCancelBg.stroke({ color: FIELD_BORDER, width: 1 });
      aliasCancelBtn.addChild(aliasCancelBg);
      aliasCancelText.x = cancelPadX;
      aliasCancelText.y = cancelPadY;
      aliasCancelBtn.addChild(aliasCancelText);
      aliasCancelBtn.hitArea = new Rectangle(0, 0, cancelW, cancelH);
      aliasCancelBtn.x = saveW + 6;
      aliasCancelBtn.y = dy;
      aliasCancelBtn.on("pointertap", (e) => {
        e.stopPropagation();
        editingAlias = false;
        layout(currentWidth, currentHeight);
      });
      detailContainer.addChild(aliasCancelBtn);

      dy += saveH + 8;
    } else {
      // display mode — show alias value with edit button
      const aliasRow = new Container();
      aliasRow.eventMode = "static";
      aliasRow.y = dy;
      detailContainer.addChild(aliasRow);

      const aliasValue = friend.alias || "none";
      const aliasValueText = new Text({
        text: aliasValue,
        style: {
          fontFamily: FONT,
          fontSize: DETAIL_NODEID_SIZE,
          fill: friend.alias ? TEXT_COLOR : MUTED_TEXT,
        },
        resolution: RESOLUTION,
      });
      aliasValueText.eventMode = "none";
      aliasValueText.y = 2;
      aliasRow.addChild(aliasValueText);

      // edit button — pill-shaped
      const aliasEditBtn = new Container();
      aliasEditBtn.eventMode = "static";
      aliasEditBtn.cursor = "pointer";
      aliasEditBtn.x = aliasValueText.width + 8;
      const aliasEditBg = new Graphics();
      aliasEditBg.eventMode = "none";
      const aliasEditLabel = new Text({
        text: "edit",
        style: { fontFamily: FONT, fontSize: 9, fill: ACCENT },
        resolution: RESOLUTION,
      });
      aliasEditLabel.eventMode = "none";
      const editPadX = 8;
      const editPadY = 3;
      const editW = aliasEditLabel.width + editPadX * 2;
      const editH = aliasEditLabel.height + editPadY * 2;
      aliasEditBg.roundRect(0, 0, editW, editH, 3);
      aliasEditBg.fill({ color: FIELD_BG });
      aliasEditBg.stroke({ color: FIELD_BORDER, width: 1 });
      aliasEditBtn.addChild(aliasEditBg);
      aliasEditLabel.x = editPadX;
      aliasEditLabel.y = editPadY;
      aliasEditBtn.addChild(aliasEditLabel);
      aliasEditBtn.hitArea = new Rectangle(0, 0, editW, editH);
      aliasEditBtn.on("pointertap", (e) => {
        e.stopPropagation();
        editingAlias = true;
        layout(currentWidth, currentHeight);
      });
      aliasRow.addChild(aliasEditBtn);

      dy += editH + 8;
    }

    // -----------------------------------------------------------------------
    // bio (if any nodeId has one)
    // -----------------------------------------------------------------------

    const bio = friend.nodeIds.find((n) => n.bio)?.bio;
    if (bio) {
      const bioText = new Text({
        text: truncate(bio, 80),
        style: {
          fontFamily: FONT,
          fontSize: DETAIL_BIO_SIZE,
          fill: MUTED_TEXT,
          wordWrap: true,
          wordWrapWidth: contentW,
        },
        resolution: RESOLUTION,
      });
      bioText.eventMode = "none";
      bioText.x = Math.max(0, (contentW - bioText.width) / 2);
      bioText.y = dy;
      detailContainer.addChild(bioText);
      dy += bioText.height + 10;
    } else {
      dy += 4;
    }

    // separator
    const sep = new Graphics();
    sep.moveTo(0, dy);
    sep.lineTo(contentW, dy);
    sep.stroke({ color: BORDER, width: 1, alpha: 0.5 });
    detailContainer.addChild(sep);
    dy += 10;

    // -----------------------------------------------------------------------
    // node IDs section
    // -----------------------------------------------------------------------

    for (const nodeEntry of friend.nodeIds) {
      if (!nodeEntry.nodeId) continue;

      const nodeIdLabel = new Text({
        text: "node id",
        style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
        resolution: RESOLUTION,
      });
      nodeIdLabel.eventMode = "none";
      nodeIdLabel.x = 0;
      nodeIdLabel.y = dy;
      detailContainer.addChild(nodeIdLabel);
      dy += LABEL_SIZE + 4;

      // abbreviated node ID + copy button in a row
      const nodeIdRow = new Container();
      nodeIdRow.eventMode = "static";
      nodeIdRow.y = dy;
      detailContainer.addChild(nodeIdRow);

      const abbreviated = nodeEntry.nodeId.slice(0, 8) + "\u2026" + nodeEntry.nodeId.slice(-8);
      const nodeIdText = new Text({
        text: abbreviated,
        style: {
          fontFamily: FONT,
          fontSize: DETAIL_NODEID_SIZE,
          fill: TEXT_COLOR,
        },
        resolution: RESOLUTION,
      });
      nodeIdText.eventMode = "none";
      nodeIdText.y = 2;
      nodeIdRow.addChild(nodeIdText);

      // copy button
      const copyBtn = new Container();
      copyBtn.eventMode = "static";
      copyBtn.cursor = "pointer";
      copyBtn.x = nodeIdText.width + 8;

      const copyBtnBg = new Graphics();
      copyBtnBg.eventMode = "none";
      const copyLabel = new Text({
        text: "copy",
        style: { fontFamily: FONT, fontSize: 9, fill: ACCENT },
        resolution: RESOLUTION,
      });
      copyLabel.eventMode = "none";
      const copyPadX = 8;
      const copyPadY = 3;
      const copyW = copyLabel.width + copyPadX * 2;
      const copyH = copyLabel.height + copyPadY * 2;
      copyBtnBg.roundRect(0, 0, copyW, copyH, 3);
      copyBtnBg.fill({ color: FIELD_BG });
      copyBtnBg.stroke({ color: FIELD_BORDER, width: 1 });
      copyBtn.addChild(copyBtnBg);
      copyLabel.x = copyPadX;
      copyLabel.y = copyPadY;
      copyBtn.addChild(copyLabel);
      copyBtn.hitArea = new Rectangle(0, 0, copyW, copyH);

      const fullNodeId = nodeEntry.nodeId;
      copyBtn.on("pointertap", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(fullNodeId).then(
          () => {
            copyLabel.text = "copied!";
            setTimeout(() => {
              if (detailContainer.destroyed) return;
              copyLabel.text = "copy";
            }, COPY_FEEDBACK_MS);
          },
          () => {}
        );
      });

      nodeIdRow.addChild(copyBtn);
      dy += copyH + 8;
    }

    // -----------------------------------------------------------------------
    // group — editable picker
    // -----------------------------------------------------------------------
    {
      const groupLabel = new Text({
        text: "group",
        style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
        resolution: RESOLUTION,
      });
      groupLabel.eventMode = "none";
      groupLabel.y = dy;
      detailContainer.addChild(groupLabel);
      dy += LABEL_SIZE + 6;

      // collect all known groups
      const knownGroups: string[] = (ctx.doc.current.groups ?? []).map((g: FriendGroup) => g.name);
      if (friend.group && !knownGroups.includes(friend.group)) {
        knownGroups.push(friend.group);
      }
      knownGroups.sort((a, b) => a.localeCompare(b));

      // build pill options: "none" + known groups + "+ new"
      const pillOptions: string[] = ["none", ...knownGroups, "+ new"];
      let px = 0;
      let pillRowY = dy;
      const friendIdForGroup = friend.id;

      for (const opt of pillOptions) {
        const isActive =
          (opt === "none" && !friend.group) ||
          (opt !== "none" && opt !== "+ new" && friend.group === opt);
        const pillW = Math.max(40, opt.length * (OPTION_FONT_SIZE * 0.65) + 20);

        // wrap to next line if exceeds contentW
        if (px + pillW > contentW && px > 0) {
          px = 0;
          pillRowY += OPTION_PILL_HEIGHT + OPTION_PILL_GAP;
        }

        const pill = new Container();
        pill.eventMode = "static";
        pill.cursor = "pointer";
        pill.hitArea = new Rectangle(0, 0, pillW, OPTION_PILL_HEIGHT);
        pill.x = px;
        pill.y = pillRowY;

        const pillBg = new Graphics();
        pillBg.roundRect(0, 0, pillW, OPTION_PILL_HEIGHT, OPTION_PILL_RADIUS);
        if (isActive) {
          pillBg.fill({ color: ACCENT });
        } else {
          pillBg.fill({ color: FIELD_BG });
          pillBg.stroke({ color: FIELD_BORDER, width: 1 });
        }
        pill.addChild(pillBg);

        const pillText = new Text({
          text: opt,
          style: {
            fontFamily: FONT,
            fontSize: OPTION_FONT_SIZE,
            fill: isActive ? 0xffffff : MUTED_TEXT,
          },
          resolution: RESOLUTION,
        });
        pillText.eventMode = "none";
        pillText.x = (pillW - pillText.width) / 2;
        pillText.y = (OPTION_PILL_HEIGHT - OPTION_FONT_SIZE) / 2;
        pill.addChild(pillText);

        const optValue = opt;
        pill.on("pointertap", (e) => {
          e.stopPropagation();
          if (optValue === "+ new") {
            editingNewGroup = true;
            layout(currentWidth, currentHeight);
          } else if (optValue === "none") {
            ctx.doc.change((draft) => {
              const idx = draft.friends.findIndex((f: FriendEntry) => f.id === friendIdForGroup);
              if (idx !== -1) draft.friends[idx].group = "";
            });
          } else {
            ctx.doc.change((draft) => {
              const idx = draft.friends.findIndex((f: FriendEntry) => f.id === friendIdForGroup);
              if (idx !== -1) draft.friends[idx].group = optValue;
            });
          }
        });

        detailContainer.addChild(pill);
        px += pillW + OPTION_PILL_GAP;
      }

      dy = pillRowY + OPTION_PILL_HEIGHT + 8;

      // new group input (shown when "+ new" is clicked)
      if (editingNewGroup) {
        groupInputHandle = createSkeinInput({
          canvasElement: ctx.canvasElement,
          width: contentW,
          height: FIELD_HEIGHT,
          value: "",
          onChange: () => {},
        });
        groupInputHandle.input.x = 0;
        groupInputHandle.input.y = dy;
        detailContainer.addChild(groupInputHandle.input);
        dy += FIELD_HEIGHT + 6;

        // confirm button
        const newGroupConfirmBtn = new Container();
        newGroupConfirmBtn.eventMode = "static";
        newGroupConfirmBtn.cursor = "pointer";
        const newGroupConfirmBg = new Graphics();
        newGroupConfirmBg.eventMode = "none";
        const newGroupConfirmText = new Text({
          text: "add group",
          style: { fontFamily: FONT, fontSize: 9, fill: 0xffffff },
          resolution: RESOLUTION,
        });
        newGroupConfirmText.eventMode = "none";
        const ngPadX = 10;
        const ngPadY = 4;
        const ngW = newGroupConfirmText.width + ngPadX * 2;
        const ngH = newGroupConfirmText.height + ngPadY * 2;
        newGroupConfirmBg.roundRect(0, 0, ngW, ngH, 3);
        newGroupConfirmBg.fill({ color: ACCENT });
        newGroupConfirmBtn.addChild(newGroupConfirmBg);
        newGroupConfirmText.x = ngPadX;
        newGroupConfirmText.y = ngPadY;
        newGroupConfirmBtn.addChild(newGroupConfirmText);
        newGroupConfirmBtn.hitArea = new Rectangle(0, 0, ngW, ngH);
        newGroupConfirmBtn.x = 0;
        newGroupConfirmBtn.y = dy;
        newGroupConfirmBtn.on("pointertap", (e) => {
          e.stopPropagation();
          const newGroupName = groupInputHandle ? groupInputHandle.value.trim() : "";
          if (newGroupName) {
            editingNewGroup = false;
            ctx.doc.change((draft) => {
              // add group if it doesn't already exist
              const groupExists = draft.groups.some((g: FriendGroup) => g.name === newGroupName);
              if (!groupExists) {
                draft.groups.push({ name: newGroupName, createdAt: new Date().toISOString() });
              }
              // assign friend to new group
              const idx = draft.friends.findIndex((f: FriendEntry) => f.id === friendIdForGroup);
              if (idx !== -1) draft.friends[idx].group = newGroupName;
            });
          }
        });
        detailContainer.addChild(newGroupConfirmBtn);

        // cancel button
        const newGroupCancelBtn = new Container();
        newGroupCancelBtn.eventMode = "static";
        newGroupCancelBtn.cursor = "pointer";
        const newGroupCancelBg = new Graphics();
        newGroupCancelBg.eventMode = "none";
        const newGroupCancelText = new Text({
          text: "cancel",
          style: { fontFamily: FONT, fontSize: 9, fill: MUTED_TEXT },
          resolution: RESOLUTION,
        });
        newGroupCancelText.eventMode = "none";
        const ngcPadX = 10;
        const ngcPadY = 4;
        const ngcW = newGroupCancelText.width + ngcPadX * 2;
        const ngcH = newGroupCancelText.height + ngcPadY * 2;
        newGroupCancelBg.roundRect(0, 0, ngcW, ngcH, 3);
        newGroupCancelBg.fill({ color: FIELD_BG });
        newGroupCancelBg.stroke({ color: FIELD_BORDER, width: 1 });
        newGroupCancelBtn.addChild(newGroupCancelBg);
        newGroupCancelText.x = ngcPadX;
        newGroupCancelText.y = ngcPadY;
        newGroupCancelBtn.addChild(newGroupCancelText);
        newGroupCancelBtn.hitArea = new Rectangle(0, 0, ngcW, ngcH);
        newGroupCancelBtn.x = ngW + 6;
        newGroupCancelBtn.y = dy;
        newGroupCancelBtn.on("pointertap", (e) => {
          e.stopPropagation();
          editingNewGroup = false;
          layout(currentWidth, currentHeight);
        });
        detailContainer.addChild(newGroupCancelBtn);

        dy += ngH + 8;
      }
    }

    // -----------------------------------------------------------------------
    // added date
    // -----------------------------------------------------------------------

    if (friend.createdAt) {
      const addedLabel = new Text({
        text: "added",
        style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
        resolution: RESOLUTION,
      });
      addedLabel.eventMode = "none";
      addedLabel.y = dy;
      detailContainer.addChild(addedLabel);
      dy += LABEL_SIZE + 4;

      const addedText = new Text({
        text: new Date(friend.createdAt).toLocaleDateString(),
        style: { fontFamily: FONT, fontSize: DETAIL_NODEID_SIZE, fill: TEXT_COLOR },
        resolution: RESOLUTION,
      });
      addedText.eventMode = "none";
      addedText.y = dy;
      detailContainer.addChild(addedText);
      dy += addedText.height + 10;
    }

    // -----------------------------------------------------------------------
    // delete button — anchored to bottom of area
    // -----------------------------------------------------------------------

    const deleteBtnY = areaHeight - DETAIL_BTN_HEIGHT;
    const deleteBtn = new Container();
    deleteBtn.eventMode = "static";
    deleteBtn.cursor = "pointer";
    deleteBtn.hitArea = new Rectangle(0, 0, contentW, DETAIL_BTN_HEIGHT);
    deleteBtn.y = deleteBtnY;
    detailContainer.addChild(deleteBtn);

    const deleteBg = new Graphics();
    deleteBg.eventMode = "none";
    deleteBg.roundRect(0, 0, contentW, DETAIL_BTN_HEIGHT, DETAIL_BTN_RADIUS);
    deleteBg.fill({ color: FIELD_BG });
    deleteBg.stroke({ color: 0x7f1d1d, width: 1 });
    deleteBtn.addChild(deleteBg);

    const deleteText = new Text({
      text: "remove friend",
      style: { fontFamily: FONT, fontSize: TEXT_SIZE, fill: REJECT_COLOR },
      resolution: RESOLUTION,
    });
    deleteText.eventMode = "none";
    deleteText.x = (contentW - deleteText.width) / 2;
    deleteText.y = (DETAIL_BTN_HEIGHT - TEXT_SIZE) / 2;
    deleteBtn.addChild(deleteText);

    let deleteConfirmPending = false;
    let deleteConfirmTimer: ReturnType<typeof setTimeout> | null = null;
    const friendId = friend.id;

    deleteBtn.on("pointertap", (e) => {
      e.stopPropagation();
      if (!deleteConfirmPending) {
        // first click — switch to confirm state
        deleteConfirmPending = true;
        deleteText.text = "confirm remove?";
        deleteText.style.fill = 0xffffff;
        deleteText.x = (contentW - deleteText.width) / 2;
        deleteBg.clear();
        deleteBg.roundRect(0, 0, contentW, DETAIL_BTN_HEIGHT, DETAIL_BTN_RADIUS);
        deleteBg.fill({ color: REJECT_COLOR });
        // auto-reset after 3 seconds
        deleteConfirmTimer = setTimeout(() => {
          if (detailContainer.destroyed) return;
          deleteConfirmPending = false;
          deleteText.text = "remove friend";
          deleteText.style.fill = REJECT_COLOR;
          deleteText.x = (contentW - deleteText.width) / 2;
          deleteBg.clear();
          deleteBg.roundRect(0, 0, contentW, DETAIL_BTN_HEIGHT, DETAIL_BTN_RADIUS);
          deleteBg.fill({ color: FIELD_BG });
          deleteBg.stroke({ color: 0x7f1d1d, width: 1 });
          deleteConfirmTimer = null;
        }, 3000);
      } else {
        // second click — actually remove
        if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);
        selectedFriendId = null;
        viewMode = "list";
        editingAlias = false;
        editingNewGroup = false;
        scrollY = 0;
        ctx.doc.change((draft) => {
          const idx = draft.friends.findIndex((f: FriendEntry) => f.id === friendId);
          if (idx !== -1) {
            draft.friends.splice(idx, 1);
          }
        });
      }
    });
  };

  // ---------------------------------------------------------------------------
  // add-friend view
  // ---------------------------------------------------------------------------

  const addModeContainer = new Container();
  addModeContainer.eventMode = "static";
  addModeContainer.visible = false;
  container.addChild(addModeContainer);

  interface AddFieldEntry {
    label: Text;
    handle: SkeinInputHandle;
    layoutAt: (x: number, y: number, w: number) => void;
  }

  function createAddField(
    labelStr: string,
    parentContainer: Container,
    placeholder: string
  ): AddFieldEntry {
    const label = new Text({
      text: labelStr,
      style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
      resolution: RESOLUTION,
    });
    label.eventMode = "none";
    parentContainer.addChild(label);

    const handle = createSkeinInput({
      canvasElement: ctx.canvasElement,
      width: 200, // initial width — updated by layoutAt
      height: FIELD_HEIGHT,
      placeholder,
      value: "",
      onChange: () => {},
    });

    parentContainer.addChild(handle.input);

    const layoutAt = (x: number, y: number, w: number) => {
      label.x = x;
      label.y = y;
      handle.input.x = x;
      handle.input.y = y + LABEL_SIZE + 4;
      handle.setWidth(w);
    };

    return { label, handle, layoutAt };
  }

  const nameField = createAddField(
    "alias (optional)",
    addModeContainer,
    "nickname for this friend..."
  );
  const nodeIdField = createAddField("node id", addModeContainer, "64-char hex node ID");

  // add-mode buttons: cancel and add
  const addCancelBtn = new Container();
  addCancelBtn.eventMode = "static";
  addCancelBtn.cursor = "pointer";

  const addCancelBg = new Graphics();
  addCancelBtn.addChild(addCancelBg);

  const addCancelText = new Text({
    text: "cancel",
    style: { fontFamily: FONT, fontSize: TEXT_SIZE, fill: MUTED_TEXT },
    resolution: RESOLUTION,
  });
  addCancelText.eventMode = "none";
  addCancelBtn.addChild(addCancelText);
  addModeContainer.addChild(addCancelBtn);

  addCancelBtn.on("pointertap", (e) => {
    e.stopPropagation();
    nameField.handle.blur();
    nodeIdField.handle.blur();
    viewMode = "list";
    addModeContainer.visible = false;
    nameField.handle.value = "";
    nodeIdField.handle.value = "";
    layout(currentWidth, currentHeight);
  });

  const addConfirmBtn = new Container();
  addConfirmBtn.eventMode = "static";
  addConfirmBtn.cursor = "pointer";

  const addConfirmBg = new Graphics();
  addConfirmBtn.addChild(addConfirmBg);

  const addConfirmText = new Text({
    text: "add",
    style: { fontFamily: FONT, fontSize: TEXT_SIZE, fontWeight: "bold", fill: 0xffffff },
    resolution: RESOLUTION,
  });
  addConfirmText.eventMode = "none";
  addConfirmBtn.addChild(addConfirmText);
  addModeContainer.addChild(addConfirmBtn);

  addConfirmBtn.on("pointertap", (e) => {
    e.stopPropagation();
    nameField.handle.blur();
    nodeIdField.handle.blur();

    const name = nameField.handle.value.trim();
    const nodeId = nodeIdField.handle.value.trim();

    if (!name && !nodeId) {
      // nothing to add — just close
      viewMode = "list";
      addModeContainer.visible = false;
      nameField.handle.value = "";
      nodeIdField.handle.value = "";
      layout(currentWidth, currentHeight);
      return;
    }

    // validate node ID format if provided
    if (nodeId && !isValidNodeId(nodeId)) {
      console.warn("[friends-tab] invalid node ID format — expected 64-char hex string");
      return;
    }

    // switch view state BEFORE the doc change so that the on("change")
    // listener's layout() call renders the list view (not the add view)
    viewMode = "list";
    addModeContainer.visible = false;
    nameField.handle.value = "";
    nodeIdField.handle.value = "";
    scrollY = Infinity;

    ctx.doc.change((draft) => {
      draft.friends.push({
        id: crypto.randomUUID(),
        alias: name,
        username: "",
        group: "",
        nodeIds: nodeId
          ? [
              {
                nodeId: nodeId,
                addedAt: new Date().toISOString(),
                lastSeenAt: "",
                username: "",
                bio: "",
                avatarDataUrl: "",
              },
            ]
          : [],
        createdAt: new Date().toISOString(),
      });
    });

    // if a node ID was provided and the protocol is ready, also send
    // a friend request so the remote peer gets notified
    if (nodeId && bridgeIsProtocolReady()) {
      sendFriendRequest(nodeId).catch((err) => {
        console.warn("[friends-tab] failed to send friend request after add:", err);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // "add friend" button (shown in list view)
  // ---------------------------------------------------------------------------

  const addBtn = new Container();
  addBtn.eventMode = "static";
  addBtn.cursor = "pointer";

  const addBtnBg = new Graphics();
  addBtn.addChild(addBtnBg);

  const addBtnText = new Text({
    text: "add friend",
    style: { fontFamily: FONT, fontSize: TEXT_SIZE, fontWeight: "bold", fill: 0xffffff },
    resolution: RESOLUTION,
  });
  addBtnText.eventMode = "none";
  addBtn.addChild(addBtnText);
  container.addChild(addBtn);

  addBtn.on("pointertap", (e) => {
    e.stopPropagation();
    viewMode = "add";
    addModeContainer.visible = true;
    addBtn.visible = false;
    layout(currentWidth, currentHeight);
    // auto-focus the name field
    nameField.handle.focus();
  });

  // ---------------------------------------------------------------------------
  // layout — called by parent with content area dimensions
  // ---------------------------------------------------------------------------

  const layout = (w: number, h: number) => {
    currentWidth = w;
    currentHeight = h;

    const friends = ctx.doc.current.friends;

    // hide all sub-view containers first
    listContainer.visible = false;
    detailContainer.visible = false;
    addModeContainer.visible = false;
    addBtn.visible = false;
    emptyText.visible = false;

    switch (viewMode) {
      case "list": {
        listContainer.visible = true;
        addBtn.visible = true;

        const addBtnY = h - BUTTON_HEIGHT;

        addBtnBg.clear();
        addBtnBg.roundRect(0, 0, w, BUTTON_HEIGHT, BUTTON_RADIUS);
        addBtnBg.fill({ color: ACCENT });
        addBtn.hitArea = new Rectangle(0, 0, w, BUTTON_HEIGHT);
        addBtn.x = 0;
        addBtn.y = addBtnY;
        addBtnText.x = (w - addBtnText.width) / 2;
        addBtnText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;

        // list area spans from top to above the add button
        const listTop = 0;
        listAreaHeight = addBtnY - listTop - 8;

        // update mask — the parent positions us so (0,0) is the content origin
        listMask.clear();
        listMask.rect(0, listTop, w, listAreaHeight);
        listMask.fill({ color: 0xffffff });

        // position list container
        listContainer.x = 0;
        listContainer.y = listTop;
        listContainer.hitArea = new Rectangle(0, 0, w, listAreaHeight);

        // rebuild rows
        rebuildRows(friends, w);

        // clamp scroll after rebuilding
        clampScroll();
        positionListInner();

        // empty state
        if (friends.length === 0) {
          emptyText.visible = true;
          emptyText.text = "no friends yet";
          emptyText.x = (w - emptyText.width) / 2;
          emptyText.y = listTop + listAreaHeight / 2 - 6;
        }
        break;
      }

      case "detail": {
        const selectedFriend = friends.find((f) => f.id === selectedFriendId);
        if (!selectedFriend) {
          // friend was deleted or not found — go back to list
          viewMode = "list";
          selectedFriendId = null;
          editingAlias = false;
          editingNewGroup = false;
          layout(w, h);
          return;
        }
        detailContainer.visible = true;
        detailContainer.x = 0;
        detailContainer.y = 0;
        rebuildDetailView(selectedFriend, w, h);
        break;
      }

      case "add": {
        addModeContainer.visible = true;
        addModeContainer.x = 0;
        addModeContainer.y = 0;

        let addY = 0;

        // name field — small internal padding for the input fields
        const fieldPad = PADDING_X;
        const fieldW = w - fieldPad * 2;

        nameField.layoutAt(fieldPad, addY, fieldW);
        addY += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

        // node id field
        nodeIdField.layoutAt(fieldPad, addY, fieldW);
        addY += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

        // buttons — anchored to the bottom
        const buttonY = h - BUTTON_HEIGHT;
        const buttonW = (w - BUTTON_GAP) / 2;

        // cancel button
        addCancelBg.clear();
        addCancelBg.roundRect(0, 0, buttonW, BUTTON_HEIGHT, BUTTON_RADIUS);
        addCancelBg.fill({ color: FIELD_BG });
        addCancelBg.stroke({ color: FIELD_BORDER, width: 1 });
        addCancelBtn.hitArea = new Rectangle(0, 0, buttonW, BUTTON_HEIGHT);
        addCancelBtn.x = 0;
        addCancelBtn.y = buttonY;
        addCancelText.x = (buttonW - addCancelText.width) / 2;
        addCancelText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;

        // add button
        addConfirmBg.clear();
        addConfirmBg.roundRect(0, 0, buttonW, BUTTON_HEIGHT, BUTTON_RADIUS);
        addConfirmBg.fill({ color: ACCENT });
        addConfirmBtn.hitArea = new Rectangle(0, 0, buttonW, BUTTON_HEIGHT);
        addConfirmBtn.x = buttonW + BUTTON_GAP;
        addConfirmBtn.y = buttonY;
        addConfirmText.x = (buttonW - addConfirmText.width) / 2;
        addConfirmText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;
        break;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // subscriptions
  // ---------------------------------------------------------------------------

  // subscribe to doc changes for re-rendering
  const unsub = ctx.doc.on("change", () => {
    layout(currentWidth, currentHeight);
  });

  // subscribe to online status changes for re-rendering friend dots and detail view
  const unsubOnline = onOnlineChange(() => {
    if (viewMode === "list" || viewMode === "detail") {
      layout(currentWidth, currentHeight);
    }
  });

  // ---------------------------------------------------------------------------
  // controller
  // ---------------------------------------------------------------------------

  return {
    container,

    layout(width: number, height: number) {
      layout(width, height);
    },

    destroy() {
      nameField.handle.destroy();
      nodeIdField.handle.destroy();
      if (aliasInputHandle) {
        aliasInputHandle.destroy();
        aliasInputHandle = null;
      }
      if (groupInputHandle) {
        groupInputHandle.destroy();
        groupInputHandle = null;
      }
      unsub();
      unsubOnline();
      container.destroy({ children: true });
    },
  };
}

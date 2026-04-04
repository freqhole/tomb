import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import {
  acceptFriendRequest,
  isOnline as bridgeIsOnline,
  setFriendRequestsFrom as bridgeSetFriendRequestsFrom,
  setProfileVisibility as bridgeSetProfileVisibility,
  onOnlineChange,
  rejectFriendRequest,
} from "../../src/p2p/friendz-bridge";
import { createSkeinInput, type SkeinInputHandle } from "../../src/widgets/skein-input";
import type {
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../../src/widgets/widget-types";

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

const friendNodeIdSchema = z.object({
  nodeId: z.string(),
  addedAt: z.string().default(""),
  lastSeenAt: z.string().default(""),
  // profile fields populated by fetching the peer's profile
  username: z.string().default(""),
  bio: z.string().default(""),
  avatarDataUrl: z.string().default(""),
});

const friendEntrySchema = z.object({
  id: z.string(), // UUID — canonical friend identity
  alias: z.string().default(""), // user-set nickname (display priority)
  username: z.string().default(""), // best-effort: from most recently seen nodeId's profile
  group: z.string().default(""), // folder-style group name ("" = ungrouped)
  nodeIds: z.array(friendNodeIdSchema).default([]),
  createdAt: z.string().default(""),
});

const friendGroupSchema = z.object({
  name: z.string(),
  createdAt: z.string().default(""),
});

const pendingFriendRequestSchema = z.object({
  fromNodeId: z.string(),
  fromUsername: z.string().default(""),
  receivedAt: z.string().default(""),
  status: z.enum(["pending", "accepted", "rejected"]).default("pending"),
});

export const friendsSchema = z.object({
  friends: z.array(friendEntrySchema).default([]),
  groups: z.array(friendGroupSchema).default([]),
  pendingRequests: z.array(pendingFriendRequestSchema).default([]),
  profileVisibility: z.enum(["friends", "everyone", "nobody"]).default("friends"),
  friendRequestsFrom: z.enum(["everyone", "nobody"]).default("everyone"),
});

export type FriendNodeId = z.infer<typeof friendNodeIdSchema>;
export type FriendEntry = z.infer<typeof friendEntrySchema>;
export type FriendGroup = z.infer<typeof friendGroupSchema>;
export type PendingFriendRequest = z.infer<typeof pendingFriendRequestSchema>;
export type FriendsState = z.infer<typeof friendsSchema>;

// ---------------------------------------------------------------------------
// visual constants
// ---------------------------------------------------------------------------

const BG = 0x1a1a24;
const BORDER = 0x2a2a3e;
const FIELD_BG = 0x12121a;
const FIELD_BORDER = 0x333348;

const LABEL_COLOR = 0x888898;
const TEXT_COLOR = 0xf0f0ff;
const MUTED_TEXT = 0x666678;
const ACCENT = 0x6366f1;

const COLOR_PALETTE = [
  0xd946ef, 0x6366f1, 0x06b6d4, 0x10b981, 0xeab308, 0xf97316, 0xef4444, 0x8b5cf6,
];

const CARD_RADIUS = 6;

const BUTTON_RADIUS = 4;
const PADDING_X = 16;
const PADDING_Y = 14;
const FIELD_HEIGHT = 28;
const LABEL_SIZE = 10;
const TEXT_SIZE = 12;
const HEADER_SIZE = 14;
const FIELD_GAP = 10;
const BUTTON_HEIGHT = 30;
const BUTTON_GAP = 8;
const FONT = "system-ui, sans-serif";
const RESOLUTION = 3;

const ROW_HEIGHT = 44;
const ROW_PADDING_X = 10;
const ROW_AVATAR_SIZE = 16;
const ROW_NAME_SIZE = 12;
const ROW_SUB_SIZE = 10;
const ROW_ALT_BG = 0x1e1e2a;
const REMOVE_BTN_SIZE = 16;
const SCROLL_SPEED = 20;

const ONLINE_DOT_SIZE = 6;
const ONLINE_COLOR = 0x22c55e;
const OFFLINE_COLOR = 0x444455;
const TAB_HEIGHT = 28;
const TAB_FONT_SIZE = 11;
const TAB_ACTIVE_COLOR = 0x6366f1; // ACCENT
const TAB_INACTIVE_COLOR = 0x666678; // MUTED_TEXT
const REQUEST_ROW_HEIGHT = 52;
const ACTION_BTN_SIZE = 24;
const ACCEPT_COLOR = 0x22c55e;
const REJECT_COLOR = 0xef4444;
const SETTINGS_ROW_HEIGHT = 36;
const OPTION_PILL_HEIGHT = 26;
const OPTION_PILL_RADIUS = 13;
const OPTION_PILL_GAP = 6;
const OPTION_FONT_SIZE = 10;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// simple hash to pick a palette color from a string
function colorForName(name: string, index: number): number {
  if (!name) return COLOR_PALETTE[index % COLOR_PALETTE.length];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars - 1).trimEnd() + "\u2026";
}

/**
 * check if a string looks like a valid iroh node ID.
 * iroh node IDs are 64-character lowercase hex strings (32-byte ed25519 public key).
 */
export function isValidNodeId(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

/**
 * migrate v1 friends data to v2 format.
 * wraps single nodeId into nodeIds array, copies name → username.
 */
export function migrateV1ToV2(v1Data: {
  friends?: Array<{
    id: string;
    name?: string;
    description?: string;
    nodeId?: string;
    createdAt?: string;
  }>;
}): FriendsState {
  // note: v1 `description` is intentionally not migrated — v2 stores `bio`
  // at the per-nodeId level (in FriendNodeId), not at the friend entry level.
  // the description data is lost during migration.
  const friends: FriendEntry[] = (v1Data.friends ?? []).map((f) => ({
    id: f.id,
    alias: "",
    username: f.name ?? "",
    group: "",
    nodeIds: f.nodeId
      ? [
          {
            nodeId: f.nodeId,
            addedAt: f.createdAt ?? "",
            lastSeenAt: "",
            username: "",
            bio: "",
            avatarDataUrl: "",
          },
        ]
      : [],
    createdAt: f.createdAt ?? "",
  }));
  return {
    friends,
    groups: [],
    pendingRequests: [],
    profileVisibility: "friends" as const,
    friendRequestsFrom: "everyone" as const,
  };
}

/**
 * resolve the best display name for a friend.
 * priority: alias > username > truncated first nodeId > "unknown"
 */
export function friendDisplayName(friend: FriendEntry): string {
  if (friend.alias) return friend.alias;
  if (friend.username) return friend.username;
  if (friend.nodeIds.length > 0 && friend.nodeIds[0].nodeId) {
    const id = friend.nodeIds[0].nodeId;
    return id.slice(0, 8) + "..." + id.slice(-8);
  }
  return "unknown";
}

/**
 * format the display name with alias annotation.
 * if alias is set and username exists: "username (alias)"
 * otherwise: just the display name
 */
export function friendDisplayNameFull(friend: FriendEntry): string {
  if (friend.alias && friend.username) {
    return `${friend.username} (${friend.alias})`;
  }
  return friendDisplayName(friend);
}

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------

export const friendsWidget: WidgetFactory<typeof friendsSchema> = {
  type: "friends",
  metadata: {
    name: "friends",
    description: "peer identity directory — add and manage friends",
    version: "0.1.0",
    category: "narthex",
    singleton: true,
    singletonId: "skein-friends",
    defaultWidth: 280,
    defaultHeight: 400,
  },
  schema: friendsSchema,
  editableProps: [],

  create(ctx: WidgetMountContext<typeof friendsSchema>): WidgetController {
    const container = new Container();
    container.eventMode = "static";

    let currentWidth = ctx.width;
    let currentHeight = ctx.height;

    // whether we're in "add friend" mode
    let viewMode: "list" | "requests" | "settings" | "add" = "list";

    // scroll state
    let scrollY = 0;

    // ---------------------------------------------------------------------------
    // background card
    // ---------------------------------------------------------------------------

    const cardBg = new Graphics();
    container.addChild(cardBg);

    const drawCard = (w: number, h: number) => {
      cardBg.clear();
      cardBg.roundRect(0, 0, w, h, CARD_RADIUS);
      cardBg.fill({ color: BG });
      cardBg.stroke({ color: BORDER, width: 1 });
    };

    // ---------------------------------------------------------------------------
    // header
    // ---------------------------------------------------------------------------

    const headerText = new Text({
      text: "friends",
      style: {
        fontFamily: FONT,
        fontSize: HEADER_SIZE,
        fontWeight: "bold",
        fill: TEXT_COLOR,
      },
      resolution: RESOLUTION,
    });
    headerText.eventMode = "none";
    container.addChild(headerText);

    const headerSep = new Graphics();
    container.addChild(headerSep);

    // ---------------------------------------------------------------------------
    // tab bar
    // ---------------------------------------------------------------------------

    const tabFriendsText = new Text({
      text: "friends",
      style: { fontFamily: FONT, fontSize: TAB_FONT_SIZE, fill: TAB_ACTIVE_COLOR },
      resolution: RESOLUTION,
    });
    tabFriendsText.eventMode = "static";
    tabFriendsText.cursor = "pointer";
    container.addChild(tabFriendsText);

    const tabRequestsText = new Text({
      text: "requests",
      style: { fontFamily: FONT, fontSize: TAB_FONT_SIZE, fill: TAB_INACTIVE_COLOR },
      resolution: RESOLUTION,
    });
    tabRequestsText.eventMode = "static";
    tabRequestsText.cursor = "pointer";
    container.addChild(tabRequestsText);

    const tabSettingsText = new Text({
      text: "settings",
      style: { fontFamily: FONT, fontSize: TAB_FONT_SIZE, fill: TAB_INACTIVE_COLOR },
      resolution: RESOLUTION,
    });
    tabSettingsText.eventMode = "static";
    tabSettingsText.cursor = "pointer";
    container.addChild(tabSettingsText);

    const tabUnderline = new Graphics();
    container.addChild(tabUnderline);

    tabFriendsText.on("pointertap", (e) => {
      e.stopPropagation();
      viewMode = "list";
      scrollY = 0;
      layout(currentWidth, currentHeight);
    });

    tabRequestsText.on("pointertap", (e) => {
      e.stopPropagation();
      viewMode = "requests";
      scrollY = 0;
      layout(currentWidth, currentHeight);
    });

    tabSettingsText.on("pointertap", (e) => {
      e.stopPropagation();
      viewMode = "settings";
      scrollY = 0;
      layout(currentWidth, currentHeight);
    });

    const drawTabBar = (y: number, _contentW: number, pendingCount: number) => {
      tabRequestsText.text = pendingCount > 0 ? `requests (${pendingCount})` : "requests";

      tabFriendsText.style.fill = viewMode === "list" ? TAB_ACTIVE_COLOR : TAB_INACTIVE_COLOR;
      tabRequestsText.style.fill = viewMode === "requests" ? TAB_ACTIVE_COLOR : TAB_INACTIVE_COLOR;
      tabSettingsText.style.fill = viewMode === "settings" ? TAB_ACTIVE_COLOR : TAB_INACTIVE_COLOR;

      const tabGap = 16;
      tabFriendsText.x = PADDING_X;
      tabFriendsText.y = y + (TAB_HEIGHT - TAB_FONT_SIZE) / 2;

      tabRequestsText.x = tabFriendsText.x + tabFriendsText.width + tabGap;
      tabRequestsText.y = y + (TAB_HEIGHT - TAB_FONT_SIZE) / 2;

      tabSettingsText.x = tabRequestsText.x + tabRequestsText.width + tabGap;
      tabSettingsText.y = y + (TAB_HEIGHT - TAB_FONT_SIZE) / 2;

      tabUnderline.clear();
      let underX = PADDING_X;
      let underW = tabFriendsText.width;
      if (viewMode === "list") {
        underX = tabFriendsText.x;
        underW = tabFriendsText.width;
      } else if (viewMode === "requests") {
        underX = tabRequestsText.x;
        underW = tabRequestsText.width;
      } else if (viewMode === "settings") {
        underX = tabSettingsText.x;
        underW = tabSettingsText.width;
      }
      tabUnderline.moveTo(underX, y + TAB_HEIGHT - 2);
      tabUnderline.lineTo(underX + underW, y + TAB_HEIGHT - 2);
      tabUnderline.stroke({ color: TAB_ACTIVE_COLOR, width: 2 });

      tabFriendsText.visible = true;
      tabRequestsText.visible = true;
      tabSettingsText.visible = true;
      tabUnderline.visible = true;
    };

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

    // scroll handler on the list container
    listContainer.on("wheel", (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      scrollY += e.deltaY > 0 ? SCROLL_SPEED : -SCROLL_SPEED;
      clampScroll();
      positionListInner();
    });

    let listAreaY = 0;
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

      const dotOffset = 10;
      const maxNameChars = Math.max(
        6,
        Math.floor(
          (contentW - dotOffset - ROW_AVATAR_SIZE - ROW_PADDING_X * 3 - REMOVE_BTN_SIZE) /
            (ROW_NAME_SIZE * 0.55)
        )
      );
      const maxSubChars = Math.max(
        6,
        Math.floor(
          (contentW - dotOffset - ROW_AVATAR_SIZE - ROW_PADDING_X * 3 - REMOVE_BTN_SIZE) /
            (ROW_SUB_SIZE * 0.55)
        )
      );

      for (let i = 0; i < friends.length; i++) {
        const friend = friends[i];
        const rowY = i * ROW_HEIGHT;

        const rowContainer = new Container();
        rowContainer.eventMode = "static";
        rowContainer.y = rowY;
        listInner.addChild(rowContainer);

        // alternating row background
        const rowBg = new Graphics();
        rowBg.eventMode = "none";
        if (i % 2 === 1) {
          rowBg.rect(0, 0, contentW, ROW_HEIGHT);
          rowBg.fill({ color: ROW_ALT_BG, alpha: 0.5 });
        }
        rowContainer.addChild(rowBg);

        // online/offline dot
        const isAnyNodeOnline = friend.nodeIds.some((n) => bridgeIsOnline(n.nodeId));
        const dotColor = isAnyNodeOnline ? ONLINE_COLOR : OFFLINE_COLOR;

        const onlineDot = new Graphics();
        onlineDot.eventMode = "none";
        onlineDot.circle(ROW_PADDING_X / 2 + 2, ROW_HEIGHT / 2, ONLINE_DOT_SIZE / 2);
        onlineDot.fill({ color: dotColor });
        rowContainer.addChild(onlineDot);

        // avatar circle with initial letter
        const displayName = friendDisplayName(friend);
        const avatarColor = colorForName(displayName, i);
        const avatarX = ROW_PADDING_X + dotOffset + ROW_AVATAR_SIZE / 2;
        const avatarY = ROW_HEIGHT / 2;

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
            fontSize: 9,
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

        // name text
        const textX = ROW_PADDING_X + dotOffset + ROW_AVATAR_SIZE + ROW_PADDING_X;
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
        nameText.y = 6;
        rowContainer.addChild(nameText);

        // subtitle: group or first nodeId
        const firstNodeId = friend.nodeIds[0]?.nodeId ?? "";
        const subtitle = friend.group || firstNodeId;
        if (subtitle) {
          const subText = new Text({
            text: truncate(subtitle, maxSubChars),
            style: {
              fontFamily: FONT,
              fontSize: ROW_SUB_SIZE,
              fill: MUTED_TEXT,
            },
            resolution: RESOLUTION,
          });
          subText.eventMode = "none";
          subText.x = textX;
          subText.y = 24;
          rowContainer.addChild(subText);
        }

        // remove button
        const removeBtn = new Container();
        removeBtn.eventMode = "static";
        removeBtn.cursor = "pointer";
        removeBtn.x = contentW - REMOVE_BTN_SIZE - ROW_PADDING_X;
        removeBtn.y = (ROW_HEIGHT - REMOVE_BTN_SIZE) / 2;

        const removeBg = new Graphics();
        removeBg.eventMode = "none";
        removeBg.roundRect(0, 0, REMOVE_BTN_SIZE, REMOVE_BTN_SIZE, 3);
        removeBg.fill({ color: BG, alpha: 0 });
        removeBtn.addChild(removeBg);

        const removeX = new Text({
          text: "\u00d7",
          style: {
            fontFamily: FONT,
            fontSize: 14,
            fill: MUTED_TEXT,
          },
          resolution: RESOLUTION,
        });
        removeX.eventMode = "none";
        removeX.x = (REMOVE_BTN_SIZE - removeX.width) / 2;
        removeX.y = (REMOVE_BTN_SIZE - 14) / 2 - 1;
        removeBtn.addChild(removeX);

        // capture friend id for the closure
        const friendId = friend.id;
        removeBtn.on("pointertap", (e) => {
          e.stopPropagation();
          ctx.doc.change((draft) => {
            const idx = draft.friends.findIndex((f: FriendEntry) => f.id === friendId);
            if (idx !== -1) {
              draft.friends.splice(idx, 1);
            }
          });
        });

        // hover effect on remove button
        removeBtn.on("pointerover", () => {
          removeX.style.fill = 0xef4444;
        });
        removeBtn.on("pointerout", () => {
          removeX.style.fill = MUTED_TEXT;
        });

        rowContainer.addChild(removeBtn);
      }

      totalListHeight = friends.length * ROW_HEIGHT;
    };

    // ---------------------------------------------------------------------------
    // requests view
    // ---------------------------------------------------------------------------

    const requestsContainer = new Container();
    requestsContainer.eventMode = "static";
    requestsContainer.visible = false;
    container.addChild(requestsContainer);

    const requestsMask = new Graphics();
    container.addChild(requestsMask);
    requestsContainer.mask = requestsMask;

    const requestsInner = new Container();
    requestsInner.eventMode = "static";
    requestsContainer.addChild(requestsInner);

    const requestsEmptyText = new Text({
      text: "no pending requests",
      style: { fontFamily: FONT, fontSize: 11, fill: MUTED_TEXT },
      resolution: RESOLUTION,
    });
    requestsEmptyText.eventMode = "none";
    container.addChild(requestsEmptyText);

    requestsContainer.on("wheel", (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      scrollY += e.deltaY > 0 ? SCROLL_SPEED : -SCROLL_SPEED;
      clampRequestsScroll();
      positionRequestsInner();
    });

    let requestsAreaY = 0;
    let requestsAreaHeight = 0;
    let totalRequestsHeight = 0;

    const clampRequestsScroll = () => {
      const maxScroll = Math.max(0, totalRequestsHeight - requestsAreaHeight);
      scrollY = Math.max(0, Math.min(scrollY, maxScroll));
    };

    const positionRequestsInner = () => {
      requestsInner.y = -scrollY;
    };

    const rebuildRequestRows = (pending: PendingFriendRequest[], contentW: number) => {
      while (requestsInner.children.length > 0) {
        requestsInner.removeChildAt(0).destroy({ children: true });
      }

      for (let i = 0; i < pending.length; i++) {
        const request = pending[i];
        const rowY = i * REQUEST_ROW_HEIGHT;

        const rowContainer = new Container();
        rowContainer.eventMode = "static";
        rowContainer.y = rowY;
        requestsInner.addChild(rowContainer);

        // alternating row background
        const rowBg = new Graphics();
        rowBg.eventMode = "none";
        if (i % 2 === 1) {
          rowBg.rect(0, 0, contentW, REQUEST_ROW_HEIGHT);
          rowBg.fill({ color: ROW_ALT_BG, alpha: 0.5 });
        }
        rowContainer.addChild(rowBg);

        // avatar circle
        const displayName = request.fromUsername || request.fromNodeId.slice(0, 8);
        const avatarColor = colorForName(displayName, i);
        const avatarX = ROW_PADDING_X + ROW_AVATAR_SIZE / 2;
        const avatarY = REQUEST_ROW_HEIGHT / 2;

        const avatar = new Graphics();
        avatar.eventMode = "none";
        avatar.circle(avatarX, avatarY, ROW_AVATAR_SIZE / 2);
        avatar.fill({ color: avatarColor });
        rowContainer.addChild(avatar);

        const initial = (request.fromUsername || "?").charAt(0).toUpperCase();
        const avatarLetter = new Text({
          text: initial,
          style: {
            fontFamily: FONT,
            fontSize: 9,
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

        // username or truncated nodeId
        const textX = ROW_PADDING_X + ROW_AVATAR_SIZE + ROW_PADDING_X;
        const maxReqNameChars = Math.max(
          6,
          Math.floor((contentW - textX - ACTION_BTN_SIZE * 2 - 24) / (ROW_NAME_SIZE * 0.55))
        );
        const nameLabel = request.fromUsername
          ? truncate(request.fromUsername, maxReqNameChars)
          : truncate(request.fromNodeId, maxReqNameChars);

        const nameText = new Text({
          text: nameLabel,
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
        nameText.y = 8;
        rowContainer.addChild(nameText);

        // received at subtitle
        const receivedLabel = request.receivedAt
          ? new Date(request.receivedAt).toLocaleDateString()
          : "";
        if (receivedLabel) {
          const subText = new Text({
            text: receivedLabel,
            style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
            resolution: RESOLUTION,
          });
          subText.eventMode = "none";
          subText.x = textX;
          subText.y = 28;
          rowContainer.addChild(subText);
        }

        // accept button (green circle with checkmark)
        const acceptBtn = new Container();
        acceptBtn.eventMode = "static";
        acceptBtn.cursor = "pointer";
        acceptBtn.x = contentW - ACTION_BTN_SIZE * 2 - ROW_PADDING_X - 4;
        acceptBtn.y = (REQUEST_ROW_HEIGHT - ACTION_BTN_SIZE) / 2;

        const acceptBg = new Graphics();
        acceptBg.eventMode = "none";
        acceptBg.circle(ACTION_BTN_SIZE / 2, ACTION_BTN_SIZE / 2, ACTION_BTN_SIZE / 2);
        acceptBg.fill({ color: ACCEPT_COLOR });
        acceptBtn.addChild(acceptBg);

        const acceptIcon = new Text({
          text: "\u2713",
          style: { fontFamily: FONT, fontSize: 13, fontWeight: "bold", fill: 0xffffff },
          resolution: RESOLUTION,
        });
        acceptIcon.eventMode = "none";
        acceptIcon.anchor.set(0.5);
        acceptIcon.x = ACTION_BTN_SIZE / 2;
        acceptIcon.y = ACTION_BTN_SIZE / 2;
        acceptBtn.addChild(acceptIcon);

        acceptBtn.on("pointertap", (e) => {
          e.stopPropagation();
          acceptFriendRequest(request.fromNodeId).catch((err) => {
            console.warn("[friends] failed to accept friend request:", err);
          });
          ctx.doc.change((draft) => {
            const req = draft.pendingRequests.find(
              (r: PendingFriendRequest) =>
                r.fromNodeId === request.fromNodeId && r.status === "pending"
            );
            if (req) req.status = "accepted";
            const exists = draft.friends.some((f: FriendEntry) =>
              f.nodeIds.some((n: FriendNodeId) => n.nodeId === request.fromNodeId)
            );
            if (!exists) {
              draft.friends.push({
                id: crypto.randomUUID(),
                alias: "",
                username: request.fromUsername,
                group: "",
                nodeIds: [
                  {
                    nodeId: request.fromNodeId,
                    addedAt: new Date().toISOString(),
                    lastSeenAt: "",
                    username: request.fromUsername,
                    bio: "",
                    avatarDataUrl: "",
                  },
                ],
                createdAt: new Date().toISOString(),
              });
            }
          });
        });
        rowContainer.addChild(acceptBtn);

        // reject button (red circle with x)
        const rejectBtn = new Container();
        rejectBtn.eventMode = "static";
        rejectBtn.cursor = "pointer";
        rejectBtn.x = contentW - ACTION_BTN_SIZE - ROW_PADDING_X;
        rejectBtn.y = (REQUEST_ROW_HEIGHT - ACTION_BTN_SIZE) / 2;

        const rejectBg = new Graphics();
        rejectBg.eventMode = "none";
        rejectBg.circle(ACTION_BTN_SIZE / 2, ACTION_BTN_SIZE / 2, ACTION_BTN_SIZE / 2);
        rejectBg.fill({ color: REJECT_COLOR });
        rejectBtn.addChild(rejectBg);

        const rejectIcon = new Text({
          text: "\u00d7",
          style: { fontFamily: FONT, fontSize: 14, fontWeight: "bold", fill: 0xffffff },
          resolution: RESOLUTION,
        });
        rejectIcon.eventMode = "none";
        rejectIcon.anchor.set(0.5);
        rejectIcon.x = ACTION_BTN_SIZE / 2;
        rejectIcon.y = ACTION_BTN_SIZE / 2;
        rejectBtn.addChild(rejectIcon);

        rejectBtn.on("pointertap", (e) => {
          e.stopPropagation();
          rejectFriendRequest(request.fromNodeId).catch((err) => {
            console.warn("[friends] failed to reject friend request:", err);
          });
          ctx.doc.change((draft) => {
            const req = draft.pendingRequests.find(
              (r: PendingFriendRequest) =>
                r.fromNodeId === request.fromNodeId && r.status === "pending"
            );
            if (req) req.status = "rejected";
          });
        });
        rowContainer.addChild(rejectBtn);
      }

      totalRequestsHeight = pending.length * REQUEST_ROW_HEIGHT;
    };

    // ---------------------------------------------------------------------------
    // settings view
    // ---------------------------------------------------------------------------

    const settingsContainer = new Container();
    settingsContainer.eventMode = "static";
    settingsContainer.visible = false;
    container.addChild(settingsContainer);

    const rebuildSettingsView = (_contentW: number, _areaHeight: number) => {
      while (settingsContainer.children.length > 0) {
        settingsContainer.removeChildAt(0).destroy({ children: true });
      }

      const state = ctx.doc.current;
      let sy = 0;

      // --- profile visibility ---
      const visLabel = new Text({
        text: "profile visibility",
        style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
        resolution: RESOLUTION,
      });
      visLabel.eventMode = "none";
      visLabel.x = 0;
      visLabel.y = sy;
      settingsContainer.addChild(visLabel);
      sy += LABEL_SIZE + 8;

      const visOptions: Array<"friends" | "everyone" | "nobody"> = [
        "friends",
        "everyone",
        "nobody",
      ];
      let vx = 0;
      for (const opt of visOptions) {
        const isActive = state.profileVisibility === opt;
        const pillW = Math.max(60, opt.length * (OPTION_FONT_SIZE * 0.65) + 20);

        const pill = new Container();
        pill.eventMode = "static";
        pill.cursor = "pointer";
        pill.x = vx;
        pill.y = sy;

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

        const value = opt;
        pill.on("pointertap", (e) => {
          e.stopPropagation();
          ctx.doc.change((draft) => {
            draft.profileVisibility = value;
          });
          bridgeSetProfileVisibility(value);
        });

        settingsContainer.addChild(pill);
        vx += pillW + OPTION_PILL_GAP;
      }
      sy += OPTION_PILL_HEIGHT + SETTINGS_ROW_HEIGHT;

      // --- friend requests from ---
      const reqLabel = new Text({
        text: "incoming requests",
        style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
        resolution: RESOLUTION,
      });
      reqLabel.eventMode = "none";
      reqLabel.x = 0;
      reqLabel.y = sy;
      settingsContainer.addChild(reqLabel);
      sy += LABEL_SIZE + 8;

      const reqOptions: Array<"everyone" | "nobody"> = ["everyone", "nobody"];
      let rx = 0;
      for (const opt of reqOptions) {
        const isActive = state.friendRequestsFrom === opt;
        const pillW = Math.max(60, opt.length * (OPTION_FONT_SIZE * 0.65) + 20);

        const pill = new Container();
        pill.eventMode = "static";
        pill.cursor = "pointer";
        pill.x = rx;
        pill.y = sy;

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

        const value = opt;
        pill.on("pointertap", (e) => {
          e.stopPropagation();
          ctx.doc.change((draft) => {
            draft.friendRequestsFrom = value;
          });
          bridgeSetFriendRequestsFrom(value);
        });

        settingsContainer.addChild(pill);
        rx += pillW + OPTION_PILL_GAP;
      }
    };

    // ---------------------------------------------------------------------------
    // add-mode text fields (reuses same createTextField pattern as wizard)
    // ---------------------------------------------------------------------------

    const addModeContainer = new Container();
    addModeContainer.eventMode = "static";
    addModeContainer.visible = false;
    container.addChild(addModeContainer);

    // we need a local bg for add mode section
    const addModeBg = new Graphics();
    addModeBg.eventMode = "none";
    addModeContainer.addChild(addModeBg);

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
        width: currentWidth - PADDING_X * 2,
        height: FIELD_HEIGHT,
        placeholder,
        value: "",
        onChange: () => {}, // we read .value directly when needed
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

    const nameField = createAddField("name", addModeContainer, "friend's name...");
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
        console.warn("[friends] invalid node ID format — expected 64-char hex string");
        return;
      }

      ctx.doc.change((draft) => {
        draft.friends.push({
          id: crypto.randomUUID(),
          alias: "",
          username: name,
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

      viewMode = "list";
      addModeContainer.visible = false;
      nameField.handle.value = "";
      nodeIdField.handle.value = "";

      // scroll to bottom to show the new friend
      // (will be clamped in next layout)
      scrollY = Infinity;
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
    // layout
    // ---------------------------------------------------------------------------

    const layout = (w: number, h: number) => {
      const state = ctx.doc.current;
      const friends = state.friends;
      const pendingRequests = (state.pendingRequests ?? []).filter(
        (r: PendingFriendRequest) => r.status === "pending"
      );
      const contentW = w - PADDING_X * 2;
      let y = PADDING_Y;

      // card background
      drawCard(w, h);

      // header
      headerText.x = PADDING_X;
      headerText.y = y;
      y += HEADER_SIZE + 8;

      // header separator
      headerSep.clear();
      headerSep.moveTo(PADDING_X, y);
      headerSep.lineTo(w - PADDING_X, y);
      headerSep.stroke({ color: BORDER, width: 1, alpha: 0.6 });
      y += 6;

      // tab bar (hidden in add mode)
      if (viewMode !== "add") {
        drawTabBar(y, contentW, pendingRequests.length);
        y += TAB_HEIGHT + 4;
      } else {
        tabFriendsText.visible = false;
        tabRequestsText.visible = false;
        tabSettingsText.visible = false;
        tabUnderline.visible = false;
      }

      // hide all view containers first
      listContainer.visible = false;
      requestsContainer.visible = false;
      requestsEmptyText.visible = false;
      settingsContainer.visible = false;
      addModeContainer.visible = false;
      addBtn.visible = false;
      emptyText.visible = false;

      switch (viewMode) {
        case "list": {
          listContainer.visible = true;
          addBtn.visible = true;
          const addBtnY = h - PADDING_Y - BUTTON_HEIGHT;

          addBtnBg.clear();
          addBtnBg.roundRect(0, 0, contentW, BUTTON_HEIGHT, BUTTON_RADIUS);
          addBtnBg.fill({ color: ACCENT });
          addBtn.x = PADDING_X;
          addBtn.y = addBtnY;
          addBtnText.x = (contentW - addBtnText.width) / 2;
          addBtnText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;

          // list area
          listAreaY = y;
          listAreaHeight = addBtnY - y - 8;

          // update mask
          listMask.clear();
          listMask.rect(PADDING_X, listAreaY, contentW, listAreaHeight);
          listMask.fill({ color: 0xffffff });

          // position list container
          listContainer.x = PADDING_X;
          listContainer.y = listAreaY;

          // rebuild rows
          rebuildRows(friends, contentW);

          // clamp scroll after rebuilding
          clampScroll();
          positionListInner();

          // empty state
          if (friends.length === 0) {
            emptyText.visible = true;
            emptyText.text = "no friends yet";
            emptyText.x = PADDING_X + (contentW - emptyText.width) / 2;
            emptyText.y = listAreaY + listAreaHeight / 2 - 6;
          }
          break;
        }

        case "requests": {
          requestsContainer.visible = true;

          requestsAreaY = y;
          requestsAreaHeight = h - y - PADDING_Y;

          // update mask
          requestsMask.clear();
          requestsMask.rect(PADDING_X, requestsAreaY, contentW, requestsAreaHeight);
          requestsMask.fill({ color: 0xffffff });

          // position requests container
          requestsContainer.x = PADDING_X;
          requestsContainer.y = requestsAreaY;

          // rebuild request rows
          rebuildRequestRows(pendingRequests, contentW);
          clampRequestsScroll();
          positionRequestsInner();

          // empty state
          if (pendingRequests.length === 0) {
            requestsEmptyText.visible = true;
            requestsEmptyText.x = PADDING_X + (contentW - requestsEmptyText.width) / 2;
            requestsEmptyText.y = requestsAreaY + requestsAreaHeight / 2 - 6;
          }
          break;
        }

        case "settings": {
          settingsContainer.visible = true;
          settingsContainer.x = PADDING_X;
          settingsContainer.y = y;
          rebuildSettingsView(contentW, h - y - PADDING_Y);
          break;
        }

        case "add": {
          addModeContainer.visible = true;

          let addY = 0;

          // background for add mode section
          addModeContainer.x = 0;
          addModeContainer.y = y;

          addModeBg.clear();
          addModeBg.rect(PADDING_X, 0, contentW, h - y - PADDING_Y);
          addModeBg.fill({ color: BG, alpha: 0 });

          // name field
          nameField.layoutAt(PADDING_X, addY, contentW);
          addY += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

          // node id field
          nodeIdField.layoutAt(PADDING_X, addY, contentW);
          addY += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

          // buttons — anchored to the bottom of the card
          const buttonY = h - y - PADDING_Y - BUTTON_HEIGHT;
          const buttonW = (contentW - BUTTON_GAP) / 2;

          // cancel button
          addCancelBg.clear();
          addCancelBg.roundRect(0, 0, buttonW, BUTTON_HEIGHT, BUTTON_RADIUS);
          addCancelBg.fill({ color: FIELD_BG });
          addCancelBg.stroke({ color: FIELD_BORDER, width: 1 });
          addCancelBtn.x = PADDING_X;
          addCancelBtn.y = buttonY;
          addCancelText.x = (buttonW - addCancelText.width) / 2;
          addCancelText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;

          // add button
          addConfirmBg.clear();
          addConfirmBg.roundRect(0, 0, buttonW, BUTTON_HEIGHT, BUTTON_RADIUS);
          addConfirmBg.fill({ color: ACCENT });
          addConfirmBtn.x = PADDING_X + buttonW + BUTTON_GAP;
          addConfirmBtn.y = buttonY;
          addConfirmText.x = (buttonW - addConfirmText.width) / 2;
          addConfirmText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;
          break;
        }
      }
    };

    // initial draw
    layout(currentWidth, currentHeight);

    // subscribe to remote doc changes (automerge sync)
    const unsub = ctx.doc.on("change", () => {
      layout(currentWidth, currentHeight);
    });

    // subscribe to online status changes for re-rendering friend dots
    const unsubOnline = onOnlineChange(() => {
      if (viewMode === "list") {
        layout(currentWidth, currentHeight);
      }
    });

    // ---------------------------------------------------------------------------
    // controller
    // ---------------------------------------------------------------------------

    return {
      container,

      destroy() {
        nameField.handle.destroy();
        nodeIdField.handle.destroy();
        unsub();
        unsubOnline();
        container.destroy({ children: true });
      },

      resize(width: number, height: number) {
        currentWidth = width;
        currentHeight = height;
        layout(width, height);
      },
    };
  },
};

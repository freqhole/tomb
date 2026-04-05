import { Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { z } from "zod";
import {
  acceptFriendRequest,
  isOnline as bridgeIsOnline,
  isProtocolReady as bridgeIsProtocolReady,
  setFriendRequestsFrom as bridgeSetFriendRequestsFrom,
  setProfileVisibility as bridgeSetProfileVisibility,
  onOnlineChange,
  rejectFriendRequest,
  sendFriendRequest,
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

const outboundFriendRequestSchema = z.object({
  toNodeId: z.string(),
  toUsername: z.string().default(""),
  sentAt: z.string().default(""),
  status: z.enum(["pending", "accepted", "rejected"]).default("pending"),
});

export const friendsSchema = z.object({
  friends: z.array(friendEntrySchema).default([]),
  groups: z.array(friendGroupSchema).default([]),
  pendingRequests: z.array(pendingFriendRequestSchema).default([]),
  outboundRequests: z.array(outboundFriendRequestSchema).default([]),
  profileVisibility: z.enum(["friends", "everyone", "nobody"]).default("friends"),
  friendRequestsFrom: z.enum(["everyone", "nobody"]).default("everyone"),
});

export type FriendNodeId = z.infer<typeof friendNodeIdSchema>;
export type FriendEntry = z.infer<typeof friendEntrySchema>;
export type FriendGroup = z.infer<typeof friendGroupSchema>;
export type PendingFriendRequest = z.infer<typeof pendingFriendRequestSchema>;
export type OutboundFriendRequest = z.infer<typeof outboundFriendRequestSchema>;
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
const ROW_AVATAR_SIZE = 24;
const ROW_NAME_SIZE = 12;
const ROW_SUB_SIZE = 10;
const ROW_ALT_BG = 0x1e1e2a;
const SCROLL_SPEED = 20;

const ONLINE_DOT_SIZE = 7;
const ONLINE_DOT_BORDER = 2;
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
    outboundRequests: [],
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

    // current view mode
    let viewMode: "list" | "requests" | "settings" | "add" | "detail" = "list";

    // selected friend for detail view
    let selectedFriendId: string | null = null;

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

      const maxNameChars = Math.max(
        6,
        Math.floor((contentW - ROW_AVATAR_SIZE - ROW_PADDING_X * 4) / (ROW_NAME_SIZE * 0.55))
      );

      for (let i = 0; i < friends.length; i++) {
        const friend = friends[i];
        const rowY = i * ROW_HEIGHT;

        const rowContainer = new Container();
        rowContainer.eventMode = "static";
        rowContainer.cursor = "pointer";
        rowContainer.hitArea = new Rectangle(0, 0, contentW, ROW_HEIGHT);
        rowContainer.y = rowY;
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
        // border ring (matches card background)
        onlineDot.circle(dotCx, dotCy, ONLINE_DOT_SIZE / 2 + ONLINE_DOT_BORDER);
        onlineDot.fill({ color: BG });
        // inner dot
        onlineDot.circle(dotCx, dotCy, ONLINE_DOT_SIZE / 2);
        onlineDot.fill({ color: dotColor });
        rowContainer.addChild(onlineDot);

        // name text — vertically centered
        const textX = ROW_PADDING_X + ROW_AVATAR_SIZE + ROW_PADDING_X;
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

        // click row → open detail view
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
      }

      totalListHeight = friends.length * ROW_HEIGHT;
    };

    // ---------------------------------------------------------------------------
    // detail view — friend profile card
    // ---------------------------------------------------------------------------

    const DETAIL_AVATAR_SIZE = 48;
    const DETAIL_NAME_SIZE = 16;
    const DETAIL_BIO_SIZE = 11;
    const DETAIL_NODEID_SIZE = 10;
    const DETAIL_BTN_HEIGHT = 32;
    const DETAIL_BTN_RADIUS = 4;
    const COPY_FEEDBACK_MS = 1500;

    const detailContainer = new Container();
    detailContainer.eventMode = "static";
    detailContainer.visible = false;
    container.addChild(detailContainer);

    const rebuildDetailView = (friend: FriendEntry, contentW: number, areaHeight: number) => {
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

      // bio (if any nodeId has one)
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

      // node IDs section
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
        // hitArea set after measuring below

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

      // group (if any)
      if (friend.group) {
        const groupLabel = new Text({
          text: "group",
          style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
          resolution: RESOLUTION,
        });
        groupLabel.eventMode = "none";
        groupLabel.y = dy;
        detailContainer.addChild(groupLabel);
        dy += LABEL_SIZE + 4;

        const groupText = new Text({
          text: friend.group,
          style: { fontFamily: FONT, fontSize: DETAIL_NODEID_SIZE, fill: TEXT_COLOR },
          resolution: RESOLUTION,
        });
        groupText.eventMode = "none";
        groupText.y = dy;
        detailContainer.addChild(groupText);
        dy += groupText.height + 8;
      }

      // added date
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

      // delete button — anchored to bottom
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
        acceptBtn.hitArea = new Rectangle(0, 0, ACTION_BTN_SIZE, ACTION_BTN_SIZE);
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
        rejectBtn.hitArea = new Rectangle(0, 0, ACTION_BTN_SIZE, ACTION_BTN_SIZE);
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

      // --- outbound requests section (shown below incoming) ---
      const outbound = ((ctx.doc.current as any).outboundRequests ?? []) as OutboundFriendRequest[];
      const pendingOutbound = outbound.filter((r) => r.status === "pending");

      if (pendingOutbound.length > 0) {
        const sectionY = pending.length * REQUEST_ROW_HEIGHT;

        // "sent requests" label
        const sentLabel = new Text({
          text: "sent requests",
          style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: MUTED_TEXT },
          resolution: RESOLUTION,
        });
        sentLabel.eventMode = "none";
        sentLabel.x = ROW_PADDING_X;
        sentLabel.y = sectionY + 4;
        requestsInner.addChild(sentLabel);

        const labelHeight = 20;

        for (let i = 0; i < pendingOutbound.length; i++) {
          const outReq = pendingOutbound[i];
          const rowY = sectionY + labelHeight + i * REQUEST_ROW_HEIGHT;

          const rowContainer = new Container();
          rowContainer.eventMode = "static";
          rowContainer.y = rowY;
          requestsInner.addChild(rowContainer);

          // alternating row bg
          const rowBg = new Graphics();
          rowBg.eventMode = "none";
          if (i % 2 === 1) {
            rowBg.rect(0, 0, contentW, REQUEST_ROW_HEIGHT);
            rowBg.fill({ color: ROW_ALT_BG, alpha: 0.5 });
          }
          rowContainer.addChild(rowBg);

          // avatar
          const displayName = outReq.toUsername || outReq.toNodeId.slice(0, 8);
          const avatarColor = colorForName(displayName, pending.length + i);
          const avatarX = ROW_PADDING_X + ROW_AVATAR_SIZE / 2;
          const avatarY = REQUEST_ROW_HEIGHT / 2;

          const avatar = new Graphics();
          avatar.eventMode = "none";
          avatar.circle(avatarX, avatarY, ROW_AVATAR_SIZE / 2);
          avatar.fill({ color: avatarColor });
          rowContainer.addChild(avatar);

          const initial = (outReq.toUsername || "?").charAt(0).toUpperCase();
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

          // name + status
          const textX = ROW_PADDING_X + ROW_AVATAR_SIZE + ROW_PADDING_X;
          const nameText = new Text({
            text: truncate(outReq.toUsername || truncate(outReq.toNodeId, 19), 20),
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

          // status label
          const statusText = new Text({
            text: "pending\u2026",
            style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
            resolution: RESOLUTION,
          });
          statusText.eventMode = "none";
          statusText.x = textX;
          statusText.y = 28;
          rowContainer.addChild(statusText);

          // cancel button (withdraw the request)
          const cancelBtn = new Container();
          cancelBtn.eventMode = "static";
          cancelBtn.cursor = "pointer";
          cancelBtn.hitArea = new Rectangle(0, 0, ACTION_BTN_SIZE, ACTION_BTN_SIZE);
          cancelBtn.x = contentW - ACTION_BTN_SIZE - ROW_PADDING_X;
          cancelBtn.y = (REQUEST_ROW_HEIGHT - ACTION_BTN_SIZE) / 2;

          const cancelBg = new Graphics();
          cancelBg.eventMode = "none";
          cancelBg.circle(ACTION_BTN_SIZE / 2, ACTION_BTN_SIZE / 2, ACTION_BTN_SIZE / 2);
          cancelBg.fill({ color: MUTED_TEXT });
          cancelBtn.addChild(cancelBg);

          const cancelIcon = new Text({
            text: "\u00d7",
            style: { fontFamily: FONT, fontSize: 14, fontWeight: "bold", fill: 0xffffff },
            resolution: RESOLUTION,
          });
          cancelIcon.eventMode = "none";
          cancelIcon.anchor.set(0.5);
          cancelIcon.x = ACTION_BTN_SIZE / 2;
          cancelIcon.y = ACTION_BTN_SIZE / 2;
          cancelBtn.addChild(cancelIcon);

          const outReqNodeId = outReq.toNodeId;
          cancelBtn.on("pointertap", (e: any) => {
            e.stopPropagation();
            ctx.doc.change((draft: any) => {
              const idx = draft.outboundRequests.findIndex(
                (r: any) => r.toNodeId === outReqNodeId && r.status === "pending"
              );
              if (idx !== -1) {
                draft.outboundRequests.splice(idx, 1);
              }
            });
          });

          rowContainer.addChild(cancelBtn);
        }

        totalRequestsHeight = sectionY + labelHeight + pendingOutbound.length * REQUEST_ROW_HEIGHT;
      } else {
        totalRequestsHeight = pending.length * REQUEST_ROW_HEIGHT;
      }
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
        pill.hitArea = new Rectangle(0, 0, pillW, OPTION_PILL_HEIGHT);
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
        pill.hitArea = new Rectangle(0, 0, pillW, OPTION_PILL_HEIGHT);
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
    // hitArea set dynamically in layout()

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
    // hitArea set dynamically in layout()

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

      // if a node ID was provided and the protocol is ready, also send
      // a friend request so the remote peer gets notified
      if (nodeId && bridgeIsProtocolReady()) {
        sendFriendRequest(nodeId).catch((err) => {
          console.warn("[friends] failed to send friend request after add:", err);
        });
      }
    });

    // ---------------------------------------------------------------------------
    // "add friend" button (shown in list view)
    // ---------------------------------------------------------------------------

    const addBtn = new Container();
    addBtn.eventMode = "static";
    addBtn.cursor = "pointer";
    // hitArea set dynamically in layout()

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
      const outboundRequests = ((state as any).outboundRequests ?? []).filter(
        (r: OutboundFriendRequest) => r.status === "pending"
      );
      const totalRequestCount = pendingRequests.length + outboundRequests.length;
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

      // tab bar (hidden in add mode and detail mode)
      if (viewMode !== "add" && viewMode !== "detail") {
        drawTabBar(y, contentW, totalRequestCount);
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
      detailContainer.visible = false;
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
          addBtn.hitArea = new Rectangle(0, 0, contentW, BUTTON_HEIGHT);
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
          if (totalRequestCount === 0) {
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

        case "detail": {
          const selectedFriend = friends.find((f) => f.id === selectedFriendId);
          if (!selectedFriend) {
            // friend was deleted or not found — go back to list
            viewMode = "list";
            selectedFriendId = null;
            layout(w, h);
            return;
          }
          detailContainer.visible = true;
          detailContainer.x = PADDING_X;
          detailContainer.y = y;
          rebuildDetailView(selectedFriend, contentW, h - y - PADDING_Y);
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
          addCancelBtn.hitArea = new Rectangle(0, 0, buttonW, BUTTON_HEIGHT);
          addCancelBtn.x = PADDING_X;
          addCancelBtn.y = buttonY;
          addCancelText.x = (buttonW - addCancelText.width) / 2;
          addCancelText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;

          // add button
          addConfirmBg.clear();
          addConfirmBg.roundRect(0, 0, buttonW, BUTTON_HEIGHT, BUTTON_RADIUS);
          addConfirmBg.fill({ color: ACCENT });
          addConfirmBtn.hitArea = new Rectangle(0, 0, buttonW, BUTTON_HEIGHT);
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

import { Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { z } from "zod";
import { sendCanvasInviteAccept, sendCanvasInviteDecline } from "../../src/p2p/friendz-bridge";
import { getStoredIdentity } from "../../src/p2p/identity";
import {
  isTransparent,
  safeColor,
  type WidgetController,
  type WidgetFactory,
  type WidgetMountContext,
} from "../../src/widgets/widget-types";

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

const canvasInviteSchema = z.object({
  id: z.string(),
  canvasDocId: z.string(),
  canvasTitle: z.string().default(""),
  canvasDescription: z.string().default(""),
  canvasColor: z.number().default(0),
  canvasPreviewUrl: z.string().default(""),
  fromNodeId: z.string(),
  fromUsername: z.string().default(""),
  relayedBy: z.string().default(""),
  receivedAt: z.string(),
  status: z.enum(["pending", "accepted", "declined"]).default("pending"),
});

const canvasShareSchema = z.object({
  id: z.string(),
  canvasDocId: z.string(),
  canvasTitle: z.string().default(""),
  canvasDescription: z.string().default(""),
  canvasColor: z.number().default(0),
  canvasPreviewUrl: z.string().default(""),
  toNodeId: z.string(),
  toUsername: z.string().default(""),
  sentAt: z.string(),
  delivered: z.boolean().default(false),
  accepted: z.boolean().default(false),
  declined: z.boolean().default(false),
});

export const inboxSchema = z.object({
  invites: z.array(canvasInviteSchema).default([]),
  shares: z.array(canvasShareSchema).default([]),
});

export type CanvasInvite = z.infer<typeof canvasInviteSchema>;
export type CanvasShare = z.infer<typeof canvasShareSchema>;
export type InboxState = z.infer<typeof inboxSchema>;

// ---------------------------------------------------------------------------
// visual constants
// ---------------------------------------------------------------------------

const BG = 0x1a1a24;
const BORDER = 0x2a2a3e;
const TEXT_COLOR = 0xf0f0ff;
const MUTED_TEXT = 0x666678;
const ACCEPT_COLOR = 0x10b981;
const DECLINE_COLOR = 0xef4444;
const DELIVERED_COLOR = 0x3b82f6;
const CARD_RADIUS = 6;
const PADDING_X = 16;
const PADDING_Y = 14;
const TAB_HEIGHT = 28;
const TAB_FONT_SIZE = 11;
const TAB_ACTIVE_COLOR = 0xf0f0ff;
const TAB_INACTIVE_COLOR = 0x666678;
const ROW_HEIGHT = 80;
const ROW_PADDING_X = 10;

const THUMB_SIZE = 44;
const THUMB_RADIUS = 4;
const THUMB_MARGIN = 10;
const COLOR_STRIPE_WIDTH = 3;
const ROW_NAME_SIZE = 11;
const ROW_SUB_SIZE = 9;
const ROW_ALT_BG = 0x1f1f2c;
const SCROLL_SPEED = 30;
const ACTION_BTN_SIZE = 22;
const FONT = "system-ui, sans-serif";
const RESOLUTION = 3;
const HEADER_SIZE = 14;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------

export const inboxWidget: WidgetFactory<typeof inboxSchema> = {
  type: "inbox",
  metadata: {
    name: "inbox",
    description: "canvas invites and share activity",
    version: "0.1.0",
    category: "narthex",
    singleton: true,
    singletonId: "skein-inbox",
    defaultWidth: 560,
    defaultHeight: 280,
  },
  schema: inboxSchema,
  editableProps: [],

  create(ctx: WidgetMountContext<typeof inboxSchema>): WidgetController {
    const container = new Container();
    container.eventMode = "static";

    let currentWidth = ctx.width;
    let currentHeight = ctx.height;

    // current view mode
    let viewMode: "inbox" | "outbox" = "inbox";

    // scroll state
    let scrollY = 0;

    // cache the local node id (resolved async)
    let localNodeId = "";
    getStoredIdentity().then((id) => {
      if (id) localNodeId = id.node_id;
    });

    // -----------------------------------------------------------------------
    // background card
    // -----------------------------------------------------------------------

    const cardBg = new Graphics();
    container.addChild(cardBg);

    const drawCard = (w: number, h: number) => {
      cardBg.clear();
      cardBg.roundRect(0, 0, w, h, CARD_RADIUS);
      cardBg.fill({ color: BG });
      cardBg.stroke({ color: BORDER, width: 1 });
    };

    // -----------------------------------------------------------------------
    // header
    // -----------------------------------------------------------------------

    const headerText = new Text({
      text: "inbox",
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

    // -----------------------------------------------------------------------
    // tab bar
    // -----------------------------------------------------------------------

    const tabInboxText = new Text({
      text: "inbox",
      style: { fontFamily: FONT, fontSize: TAB_FONT_SIZE, fill: TAB_ACTIVE_COLOR },
      resolution: RESOLUTION,
    });
    tabInboxText.eventMode = "static";
    tabInboxText.cursor = "pointer";
    container.addChild(tabInboxText);

    const tabOutboxText = new Text({
      text: "outbox",
      style: { fontFamily: FONT, fontSize: TAB_FONT_SIZE, fill: TAB_INACTIVE_COLOR },
      resolution: RESOLUTION,
    });
    tabOutboxText.eventMode = "static";
    tabOutboxText.cursor = "pointer";
    container.addChild(tabOutboxText);

    const tabUnderline = new Graphics();
    container.addChild(tabUnderline);

    tabInboxText.on("pointertap", (e) => {
      e.stopPropagation();
      viewMode = "inbox";
      scrollY = 0;
      layout(currentWidth, currentHeight);
    });

    tabOutboxText.on("pointertap", (e) => {
      e.stopPropagation();
      viewMode = "outbox";
      scrollY = 0;
      layout(currentWidth, currentHeight);
    });

    const drawTabBar = (y: number, pendingCount: number) => {
      tabInboxText.text = pendingCount > 0 ? `inbox (${pendingCount})` : "inbox";

      tabInboxText.style.fill = viewMode === "inbox" ? TAB_ACTIVE_COLOR : TAB_INACTIVE_COLOR;
      tabOutboxText.style.fill = viewMode === "outbox" ? TAB_ACTIVE_COLOR : TAB_INACTIVE_COLOR;

      const tabGap = 16;
      tabInboxText.x = PADDING_X;
      tabInboxText.y = y + (TAB_HEIGHT - TAB_FONT_SIZE) / 2;

      tabOutboxText.x = tabInboxText.x + tabInboxText.width + tabGap;
      tabOutboxText.y = y + (TAB_HEIGHT - TAB_FONT_SIZE) / 2;

      tabUnderline.clear();
      let underX: number;
      let underW: number;
      if (viewMode === "inbox") {
        underX = tabInboxText.x;
        underW = tabInboxText.width;
      } else {
        underX = tabOutboxText.x;
        underW = tabOutboxText.width;
      }
      tabUnderline.moveTo(underX, y + TAB_HEIGHT - 2);
      tabUnderline.lineTo(underX + underW, y + TAB_HEIGHT - 2);
      tabUnderline.stroke({ color: TAB_ACTIVE_COLOR, width: 2 });

      tabInboxText.visible = true;
      tabOutboxText.visible = true;
      tabUnderline.visible = true;
    };

    // -----------------------------------------------------------------------
    // inbox list area (scrollable, masked)
    // -----------------------------------------------------------------------

    const inboxListContainer = new Container();
    inboxListContainer.eventMode = "static";
    container.addChild(inboxListContainer);

    const inboxListMask = new Graphics();
    container.addChild(inboxListMask);
    inboxListContainer.mask = inboxListMask;

    const inboxListInner = new Container();
    inboxListInner.eventMode = "static";
    inboxListContainer.addChild(inboxListInner);

    const inboxEmptyText = new Text({
      text: "no invites yet",
      style: { fontFamily: FONT, fontSize: 11, fill: MUTED_TEXT },
      resolution: RESOLUTION,
    });
    inboxEmptyText.eventMode = "none";
    container.addChild(inboxEmptyText);

    inboxListContainer.on("wheel", (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      scrollY += e.deltaY > 0 ? SCROLL_SPEED : -SCROLL_SPEED;
      clampInboxScroll();
      inboxListInner.y = -scrollY;
    });

    let inboxAreaY = 0;
    let inboxAreaHeight = 0;
    let totalInboxHeight = 0;

    const clampInboxScroll = () => {
      const maxScroll = Math.max(0, totalInboxHeight - inboxAreaHeight);
      scrollY = Math.max(0, Math.min(scrollY, maxScroll));
    };

    // -----------------------------------------------------------------------
    // outbox list area (scrollable, masked)
    // -----------------------------------------------------------------------

    const outboxListContainer = new Container();
    outboxListContainer.eventMode = "static";
    container.addChild(outboxListContainer);

    const outboxListMask = new Graphics();
    container.addChild(outboxListMask);
    outboxListContainer.mask = outboxListMask;

    const outboxListInner = new Container();
    outboxListInner.eventMode = "static";
    outboxListContainer.addChild(outboxListInner);

    const outboxEmptyText = new Text({
      text: "no shares yet",
      style: { fontFamily: FONT, fontSize: 11, fill: MUTED_TEXT },
      resolution: RESOLUTION,
    });
    outboxEmptyText.eventMode = "none";
    container.addChild(outboxEmptyText);

    outboxListContainer.on("wheel", (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      scrollY += e.deltaY > 0 ? SCROLL_SPEED : -SCROLL_SPEED;
      clampOutboxScroll();
      outboxListInner.y = -scrollY;
    });

    let outboxAreaY = 0;
    let outboxAreaHeight = 0;
    let totalOutboxHeight = 0;

    const clampOutboxScroll = () => {
      const maxScroll = Math.max(0, totalOutboxHeight - outboxAreaHeight);
      scrollY = Math.max(0, Math.min(scrollY, maxScroll));
    };

    // -----------------------------------------------------------------------
    // rebuild inbox rows
    // -----------------------------------------------------------------------

    const rebuildInboxRows = (invites: CanvasInvite[], contentW: number) => {
      while (inboxListInner.children.length > 0) {
        inboxListInner.removeChildAt(0).destroy({ children: true });
      }

      // sort: pending first, then by receivedAt descending
      const sorted = [...invites].sort((a, b) => {
        if (a.status === "pending" && b.status !== "pending") return -1;
        if (a.status !== "pending" && b.status === "pending") return 1;
        return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
      });

      const leftW = COLOR_STRIPE_WIDTH + 4 + THUMB_SIZE + THUMB_MARGIN;
      const maxNameChars = Math.max(
        6,
        Math.floor((contentW - leftW - ACTION_BTN_SIZE * 2 - 40) / (ROW_NAME_SIZE * 0.55))
      );

      for (let i = 0; i < sorted.length; i++) {
        const invite = sorted[i];
        const rowY = i * ROW_HEIGHT;

        const rowContainer = new Container();
        rowContainer.eventMode = "static";
        rowContainer.y = rowY;
        inboxListInner.addChild(rowContainer);

        // alternating row background
        const rowBg = new Graphics();
        rowBg.eventMode = "none";
        if (i % 2 === 1) {
          rowBg.rect(0, 0, contentW, ROW_HEIGHT);
          rowBg.fill({ color: ROW_ALT_BG, alpha: 0.5 });
        }
        rowContainer.addChild(rowBg);

        // thumbnail area
        const thumbColor = isTransparent(invite.canvasColor)
          ? BORDER
          : safeColor(invite.canvasColor);
        const thumbX = COLOR_STRIPE_WIDTH + 4;
        const thumbY = (ROW_HEIGHT - THUMB_SIZE) / 2;

        // color stripe on left edge
        const stripe = new Graphics();
        stripe.eventMode = "none";
        stripe.rect(0, 0, COLOR_STRIPE_WIDTH, ROW_HEIGHT);
        stripe.fill({ color: thumbColor });
        rowContainer.addChild(stripe);

        if (invite.canvasPreviewUrl) {
          // placeholder bg while loading
          const thumbBg = new Graphics();
          thumbBg.eventMode = "none";
          thumbBg.roundRect(thumbX, thumbY, THUMB_SIZE, THUMB_SIZE, THUMB_RADIUS);
          thumbBg.fill({ color: thumbColor, alpha: 0.15 });
          rowContainer.addChild(thumbBg);

          // async load — fire and forget, will render when ready
          Assets.load<Texture>(invite.canvasPreviewUrl)
            .then((texture) => {
              if (!rowContainer.destroyed) {
                const sprite = new Sprite(texture);
                const scale = Math.max(THUMB_SIZE / texture.width, THUMB_SIZE / texture.height);
                sprite.width = texture.width * scale;
                sprite.height = texture.height * scale;
                sprite.x = thumbX + (THUMB_SIZE - sprite.width) / 2;
                sprite.y = thumbY + (THUMB_SIZE - sprite.height) / 2;
                sprite.eventMode = "none";
                // clip to rounded rect
                const mask = new Graphics();
                mask.roundRect(thumbX, thumbY, THUMB_SIZE, THUMB_SIZE, THUMB_RADIUS);
                mask.fill({ color: 0xffffff });
                rowContainer.addChild(mask);
                sprite.mask = mask;
                rowContainer.addChild(sprite);
              }
            })
            .catch(() => {});
        } else {
          // solid color thumbnail with canvas title initial
          const thumbBg = new Graphics();
          thumbBg.eventMode = "none";
          thumbBg.roundRect(thumbX, thumbY, THUMB_SIZE, THUMB_SIZE, THUMB_RADIUS);
          thumbBg.fill({ color: thumbColor, alpha: 0.25 });
          rowContainer.addChild(thumbBg);

          const titleInitial = (invite.canvasTitle || "?").charAt(0).toUpperCase();
          const thumbLetter = new Text({
            text: titleInitial,
            style: {
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: "bold",
              fill: thumbColor,
              align: "center",
            },
            resolution: RESOLUTION,
          });
          thumbLetter.eventMode = "none";
          thumbLetter.anchor.set(0.5);
          thumbLetter.x = thumbX + THUMB_SIZE / 2;
          thumbLetter.y = thumbY + THUMB_SIZE / 2;
          rowContainer.addChild(thumbLetter);
        }

        // text content
        const textX = leftW;
        const hasDesc = !!invite.canvasDescription;

        // line 1: canvas title (bold)
        const titleLabel = invite.canvasTitle
          ? truncate(invite.canvasTitle, maxNameChars)
          : "untitled canvas";

        const titleText = new Text({
          text: titleLabel,
          style: {
            fontFamily: FONT,
            fontSize: ROW_NAME_SIZE,
            fontWeight: "bold",
            fill: TEXT_COLOR,
          },
          resolution: RESOLUTION,
        });
        titleText.eventMode = "none";
        titleText.x = textX;
        titleText.y = hasDesc ? 12 : 22;
        rowContainer.addChild(titleText);

        // line 2: description (only if present)
        if (hasDesc) {
          const descText = new Text({
            text: truncate(invite.canvasDescription, maxNameChars),
            style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
            resolution: RESOLUTION,
          });
          descText.eventMode = "none";
          descText.x = textX;
          descText.y = 30;
          rowContainer.addChild(descText);
        }

        // line 3: from: username  ·  time
        const displayName = invite.fromUsername || invite.fromNodeId.slice(0, 8);
        let metaLabel = `from: ${displayName}  \u00b7  ${relativeTime(invite.receivedAt)}`;
        if (invite.relayedBy) metaLabel += " (relayed)";

        const metaText = new Text({
          text: metaLabel,
          style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
          resolution: RESOLUTION,
        });
        metaText.eventMode = "none";
        metaText.x = textX;
        metaText.y = hasDesc ? 47 : 42;
        rowContainer.addChild(metaText);

        // right side — depends on status
        if (invite.status === "pending") {
          // accept button (green circle with checkmark)
          const acceptBtn = new Container();
          acceptBtn.eventMode = "static";
          acceptBtn.cursor = "pointer";
          acceptBtn.hitArea = new Rectangle(0, 0, ACTION_BTN_SIZE, ACTION_BTN_SIZE);
          acceptBtn.x = contentW - ACTION_BTN_SIZE * 2 - ROW_PADDING_X - 4;
          acceptBtn.y = (ROW_HEIGHT - ACTION_BTN_SIZE) / 2;

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
            const inviteId = invite.id;
            const canvasDocId = invite.canvasDocId;
            const fromNode = invite.fromNodeId;
            sendCanvasInviteAccept(fromNode, {
              inviteId,
              canvasDocId,
              accepterNodeId: localNodeId,
            }).catch((err) => {
              console.warn("[inbox] failed to accept canvas invite:", err);
            });
            ctx.doc.change((draft) => {
              const inv = draft.invites.find(
                (r: CanvasInvite) => r.id === inviteId && r.status === "pending"
              );
              if (inv) inv.status = "accepted";
            });
          });
          rowContainer.addChild(acceptBtn);

          // decline button (red circle with X)
          const declineBtn = new Container();
          declineBtn.eventMode = "static";
          declineBtn.cursor = "pointer";
          declineBtn.hitArea = new Rectangle(0, 0, ACTION_BTN_SIZE, ACTION_BTN_SIZE);
          declineBtn.x = contentW - ACTION_BTN_SIZE - ROW_PADDING_X;
          declineBtn.y = (ROW_HEIGHT - ACTION_BTN_SIZE) / 2;

          const declineBg = new Graphics();
          declineBg.eventMode = "none";
          declineBg.circle(ACTION_BTN_SIZE / 2, ACTION_BTN_SIZE / 2, ACTION_BTN_SIZE / 2);
          declineBg.fill({ color: DECLINE_COLOR });
          declineBtn.addChild(declineBg);

          const declineIcon = new Text({
            text: "\u00d7",
            style: { fontFamily: FONT, fontSize: 14, fontWeight: "bold", fill: 0xffffff },
            resolution: RESOLUTION,
          });
          declineIcon.eventMode = "none";
          declineIcon.anchor.set(0.5);
          declineIcon.x = ACTION_BTN_SIZE / 2;
          declineIcon.y = ACTION_BTN_SIZE / 2;
          declineBtn.addChild(declineIcon);

          declineBtn.on("pointertap", (e) => {
            e.stopPropagation();
            const inviteId = invite.id;
            const canvasDocId = invite.canvasDocId;
            const fromNode = invite.fromNodeId;
            sendCanvasInviteDecline(fromNode, {
              inviteId,
              canvasDocId,
              declinerNodeId: localNodeId,
            }).catch((err) => {
              console.warn("[inbox] failed to decline canvas invite:", err);
            });
            ctx.doc.change((draft) => {
              const inv = draft.invites.find(
                (r: CanvasInvite) => r.id === inviteId && r.status === "pending"
              );
              if (inv) inv.status = "declined";
            });
          });
          rowContainer.addChild(declineBtn);
        } else if (invite.status === "accepted") {
          const statusIcon = new Text({
            text: "\u2713",
            style: { fontFamily: FONT, fontSize: 12, fontWeight: "bold", fill: ACCEPT_COLOR },
            resolution: RESOLUTION,
          });
          statusIcon.eventMode = "none";
          statusIcon.x = contentW - ROW_PADDING_X - 70;
          statusIcon.y = (ROW_HEIGHT - 12) / 2;
          rowContainer.addChild(statusIcon);

          const statusLabel = new Text({
            text: "accepted",
            style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
            resolution: RESOLUTION,
          });
          statusLabel.eventMode = "none";
          statusLabel.x = statusIcon.x + 16;
          statusLabel.y = (ROW_HEIGHT - ROW_SUB_SIZE) / 2;
          rowContainer.addChild(statusLabel);
        } else if (invite.status === "declined") {
          const statusIcon = new Text({
            text: "\u00d7",
            style: { fontFamily: FONT, fontSize: 13, fontWeight: "bold", fill: DECLINE_COLOR },
            resolution: RESOLUTION,
          });
          statusIcon.eventMode = "none";
          statusIcon.x = contentW - ROW_PADDING_X - 65;
          statusIcon.y = (ROW_HEIGHT - 13) / 2;
          rowContainer.addChild(statusIcon);

          const statusLabel = new Text({
            text: "declined",
            style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
            resolution: RESOLUTION,
          });
          statusLabel.eventMode = "none";
          statusLabel.x = statusIcon.x + 16;
          statusLabel.y = (ROW_HEIGHT - ROW_SUB_SIZE) / 2;
          rowContainer.addChild(statusLabel);
        }
      }

      totalInboxHeight = sorted.length * ROW_HEIGHT;
    };

    // -----------------------------------------------------------------------
    // rebuild outbox rows
    // -----------------------------------------------------------------------

    const rebuildOutboxRows = (shares: CanvasShare[], contentW: number) => {
      while (outboxListInner.children.length > 0) {
        outboxListInner.removeChildAt(0).destroy({ children: true });
      }

      // sort: undelivered first, then by sentAt descending
      const sorted = [...shares].sort((a, b) => {
        const aResolved = a.delivered || a.accepted || a.declined;
        const bResolved = b.delivered || b.accepted || b.declined;
        if (!aResolved && bResolved) return -1;
        if (aResolved && !bResolved) return 1;
        return new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime();
      });

      const leftW = COLOR_STRIPE_WIDTH + 4 + THUMB_SIZE + THUMB_MARGIN;
      const maxNameChars = Math.max(
        6,
        Math.floor((contentW - leftW - 80) / (ROW_NAME_SIZE * 0.55))
      );

      for (let i = 0; i < sorted.length; i++) {
        const share = sorted[i];
        const rowY = i * ROW_HEIGHT;

        const rowContainer = new Container();
        rowContainer.eventMode = "static";
        rowContainer.y = rowY;
        outboxListInner.addChild(rowContainer);

        // alternating row background
        const rowBg = new Graphics();
        rowBg.eventMode = "none";
        if (i % 2 === 1) {
          rowBg.rect(0, 0, contentW, ROW_HEIGHT);
          rowBg.fill({ color: ROW_ALT_BG, alpha: 0.5 });
        }
        rowContainer.addChild(rowBg);

        // thumbnail area
        const thumbColor = isTransparent(share.canvasColor) ? BORDER : safeColor(share.canvasColor);
        const thumbX = COLOR_STRIPE_WIDTH + 4;
        const thumbY = (ROW_HEIGHT - THUMB_SIZE) / 2;

        // color stripe on left edge
        const stripe = new Graphics();
        stripe.eventMode = "none";
        stripe.rect(0, 0, COLOR_STRIPE_WIDTH, ROW_HEIGHT);
        stripe.fill({ color: thumbColor });
        rowContainer.addChild(stripe);

        if (share.canvasPreviewUrl) {
          // placeholder bg while loading
          const thumbBg = new Graphics();
          thumbBg.eventMode = "none";
          thumbBg.roundRect(thumbX, thumbY, THUMB_SIZE, THUMB_SIZE, THUMB_RADIUS);
          thumbBg.fill({ color: thumbColor, alpha: 0.15 });
          rowContainer.addChild(thumbBg);

          // async load — fire and forget, will render when ready
          Assets.load<Texture>(share.canvasPreviewUrl)
            .then((texture) => {
              if (!rowContainer.destroyed) {
                const sprite = new Sprite(texture);
                const scale = Math.max(THUMB_SIZE / texture.width, THUMB_SIZE / texture.height);
                sprite.width = texture.width * scale;
                sprite.height = texture.height * scale;
                sprite.x = thumbX + (THUMB_SIZE - sprite.width) / 2;
                sprite.y = thumbY + (THUMB_SIZE - sprite.height) / 2;
                sprite.eventMode = "none";
                // clip to rounded rect
                const mask = new Graphics();
                mask.roundRect(thumbX, thumbY, THUMB_SIZE, THUMB_SIZE, THUMB_RADIUS);
                mask.fill({ color: 0xffffff });
                rowContainer.addChild(mask);
                sprite.mask = mask;
                rowContainer.addChild(sprite);
              }
            })
            .catch(() => {});
        } else {
          // solid color thumbnail with canvas title initial
          const thumbBg = new Graphics();
          thumbBg.eventMode = "none";
          thumbBg.roundRect(thumbX, thumbY, THUMB_SIZE, THUMB_SIZE, THUMB_RADIUS);
          thumbBg.fill({ color: thumbColor, alpha: 0.25 });
          rowContainer.addChild(thumbBg);

          const titleInitial = (share.canvasTitle || "?").charAt(0).toUpperCase();
          const thumbLetter = new Text({
            text: titleInitial,
            style: {
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: "bold",
              fill: thumbColor,
              align: "center",
            },
            resolution: RESOLUTION,
          });
          thumbLetter.eventMode = "none";
          thumbLetter.anchor.set(0.5);
          thumbLetter.x = thumbX + THUMB_SIZE / 2;
          thumbLetter.y = thumbY + THUMB_SIZE / 2;
          rowContainer.addChild(thumbLetter);
        }

        // text content
        const textX = leftW;
        const hasDesc = !!share.canvasDescription;

        // line 1: canvas title (bold)
        const titleLabel = share.canvasTitle
          ? truncate(share.canvasTitle, maxNameChars)
          : "untitled canvas";

        const titleText = new Text({
          text: titleLabel,
          style: {
            fontFamily: FONT,
            fontSize: ROW_NAME_SIZE,
            fontWeight: "bold",
            fill: TEXT_COLOR,
          },
          resolution: RESOLUTION,
        });
        titleText.eventMode = "none";
        titleText.x = textX;
        titleText.y = hasDesc ? 12 : 22;
        rowContainer.addChild(titleText);

        // line 2: description (only if present)
        if (hasDesc) {
          const descText = new Text({
            text: truncate(share.canvasDescription, maxNameChars),
            style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
            resolution: RESOLUTION,
          });
          descText.eventMode = "none";
          descText.x = textX;
          descText.y = 30;
          rowContainer.addChild(descText);
        }

        // line 3: to: username  ·  time
        const displayName = share.toUsername || share.toNodeId.slice(0, 8);
        const metaLabel = `to: ${displayName}  \u00b7  ${relativeTime(share.sentAt)}`;

        const metaText = new Text({
          text: metaLabel,
          style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
          resolution: RESOLUTION,
        });
        metaText.eventMode = "none";
        metaText.x = textX;
        metaText.y = hasDesc ? 47 : 42;
        rowContainer.addChild(metaText);

        // right side — status indicator
        let statusIconChar = "";
        let statusIconColor = MUTED_TEXT;
        let statusLabelText = "";

        if (share.accepted) {
          statusIconChar = "\u2713";
          statusIconColor = ACCEPT_COLOR;
          statusLabelText = "accepted";
        } else if (share.declined) {
          statusIconChar = "\u00d7";
          statusIconColor = DECLINE_COLOR;
          statusLabelText = "declined";
        } else if (share.delivered) {
          statusIconChar = "\u2713";
          statusIconColor = DELIVERED_COLOR;
          statusLabelText = "delivered";
        } else {
          statusLabelText = "sending\u2026";
        }

        if (statusIconChar) {
          const sIcon = new Text({
            text: statusIconChar,
            style: { fontFamily: FONT, fontSize: 12, fontWeight: "bold", fill: statusIconColor },
            resolution: RESOLUTION,
          });
          sIcon.eventMode = "none";
          sIcon.x = contentW - ROW_PADDING_X - 70;
          sIcon.y = (ROW_HEIGHT - 12) / 2;
          rowContainer.addChild(sIcon);

          const sLabel = new Text({
            text: statusLabelText,
            style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
            resolution: RESOLUTION,
          });
          sLabel.eventMode = "none";
          sLabel.x = sIcon.x + 16;
          sLabel.y = (ROW_HEIGHT - ROW_SUB_SIZE) / 2;
          rowContainer.addChild(sLabel);
        } else {
          // "sending..." with no icon
          const sLabel = new Text({
            text: statusLabelText,
            style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
            resolution: RESOLUTION,
          });
          sLabel.eventMode = "none";
          sLabel.x = contentW - ROW_PADDING_X - 55;
          sLabel.y = (ROW_HEIGHT - ROW_SUB_SIZE) / 2;
          rowContainer.addChild(sLabel);
        }
      }

      totalOutboxHeight = sorted.length * ROW_HEIGHT;
    };

    // -----------------------------------------------------------------------
    // layout
    // -----------------------------------------------------------------------

    const layout = (w: number, h: number) => {
      const state = ctx.doc.current;

      // auto-cleanup: remove accepted/declined invites older than 7 days
      const now = Date.now();
      const CLEANUP_MS = 7 * 24 * 60 * 60 * 1000;

      const staleInvites = (state.invites ?? []).filter(
        (inv: CanvasInvite) =>
          inv.status !== "pending" &&
          inv.receivedAt &&
          now - new Date(inv.receivedAt).getTime() > CLEANUP_MS
      );

      const staleShares = (state.shares ?? []).filter(
        (s: CanvasShare) =>
          (s.accepted || s.declined) && s.sentAt && now - new Date(s.sentAt).getTime() > CLEANUP_MS
      );

      if (staleInvites.length > 0 || staleShares.length > 0) {
        ctx.doc.change((draft) => {
          if (staleInvites.length > 0) {
            draft.invites = draft.invites.filter(
              (inv: CanvasInvite) =>
                inv.status === "pending" ||
                !inv.receivedAt ||
                now - new Date(inv.receivedAt).getTime() <= CLEANUP_MS
            );
          }
          if (staleShares.length > 0) {
            draft.shares = draft.shares.filter(
              (s: CanvasShare) =>
                (!s.accepted && !s.declined) ||
                !s.sentAt ||
                now - new Date(s.sentAt).getTime() <= CLEANUP_MS
            );
          }
        });
      }

      const invites = state.invites ?? [];
      const shares = state.shares ?? [];
      const pendingCount = invites.filter((inv: CanvasInvite) => inv.status === "pending").length;
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

      // tab bar
      drawTabBar(y, pendingCount);
      y += TAB_HEIGHT + 4;

      // hide all view containers
      inboxListContainer.visible = false;
      inboxEmptyText.visible = false;
      outboxListContainer.visible = false;
      outboxEmptyText.visible = false;

      if (viewMode === "inbox") {
        inboxListContainer.visible = true;

        inboxAreaY = y;
        inboxAreaHeight = h - y - PADDING_Y;

        // update mask
        inboxListMask.clear();
        inboxListMask.rect(PADDING_X, inboxAreaY, contentW, inboxAreaHeight);
        inboxListMask.fill({ color: 0xffffff });

        // position list container
        inboxListContainer.x = PADDING_X;
        inboxListContainer.y = inboxAreaY;

        // rebuild rows
        rebuildInboxRows(invites, contentW);

        // clamp scroll
        clampInboxScroll();
        inboxListInner.y = -scrollY;

        // empty state
        if (invites.length === 0) {
          inboxEmptyText.visible = true;
          inboxEmptyText.x = PADDING_X + (contentW - inboxEmptyText.width) / 2;
          inboxEmptyText.y = inboxAreaY + inboxAreaHeight / 2 - 6;
        }
      } else {
        outboxListContainer.visible = true;

        outboxAreaY = y;
        outboxAreaHeight = h - y - PADDING_Y;

        // update mask
        outboxListMask.clear();
        outboxListMask.rect(PADDING_X, outboxAreaY, contentW, outboxAreaHeight);
        outboxListMask.fill({ color: 0xffffff });

        // position list container
        outboxListContainer.x = PADDING_X;
        outboxListContainer.y = outboxAreaY;

        // rebuild rows
        rebuildOutboxRows(shares, contentW);

        // clamp scroll
        clampOutboxScroll();
        outboxListInner.y = -scrollY;

        // empty state
        if (shares.length === 0) {
          outboxEmptyText.visible = true;
          outboxEmptyText.x = PADDING_X + (contentW - outboxEmptyText.width) / 2;
          outboxEmptyText.y = outboxAreaY + outboxAreaHeight / 2 - 6;
        }
      }
    };

    // initial draw
    layout(currentWidth, currentHeight);

    // subscribe to remote doc changes
    const unsub = ctx.doc.on("change", () => {
      layout(currentWidth, currentHeight);
    });

    // -----------------------------------------------------------------------
    // controller
    // -----------------------------------------------------------------------

    return {
      container,

      destroy() {
        unsub();
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

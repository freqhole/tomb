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
  canvasColor: z.number().catch(0),
  canvasPreviewUrl: z.string().default(""),
  fromNodeId: z.string(),
  fromUsername: z.string().default(""),
  relayedBy: z.string().catch(""),
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

const canvasDeletedNotifSchema = z.object({
  id: z.string(),
  canvasDocId: z.string(),
  canvasTitle: z.string().default(""),
  canvasColor: z.number().catch(0),
  deletedBy: z.string(),
  deletedByUsername: z.string().default(""),
  deleteMode: z.string().default("soft"),
  deletedAt: z.string(),
  status: z.enum(["unread", "dismissed"]).default("unread"),
});

export const messagezSchema = z.object({
  invites: z.array(canvasInviteSchema).default([]),
  shares: z.array(canvasShareSchema).default([]),
  deletions: z.array(canvasDeletedNotifSchema).default([]),
  canvasInvitesFrom: z.enum(["everyone", "friends", "nobody"]).default("everyone"),
});

export type CanvasInvite = z.infer<typeof canvasInviteSchema>;
export type CanvasShare = z.infer<typeof canvasShareSchema>;
export type CanvasDeletedNotif = z.infer<typeof canvasDeletedNotifSchema>;
export type MessagezState = z.infer<typeof messagezSchema>;

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

export const messagezWidget: WidgetFactory<typeof messagezSchema> = {
  type: "messagez",
  metadata: {
    name: "messagez",
    description: "canvas invites and share activity",
    version: "0.1.0",
    category: "narthex",
    singleton: true,
    singletonId: "skein-messagez",
    defaultWidth: 560,
    defaultHeight: 280,
  },
  schema: messagezSchema,
  editableProps: [],

  create(ctx: WidgetMountContext<typeof messagezSchema>): WidgetController {
    const container = new Container();
    container.eventMode = "static";

    let currentWidth = ctx.width;
    let currentHeight = ctx.height;

    // current view mode
    let viewMode: "inbox" | "outbox" = "inbox";

    // scroll state
    let scrollY = 0;

    // whether to show resolved (delivered/accepted/declined) items in outbox
    let showResolved = false;

    // whether to show accepted/declined invites in inbox
    let showAccepted = false;

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

    // "clear all" button — right side of tab bar
    const clearAllText = new Text({
      text: "clear all",
      style: { fontFamily: FONT, fontSize: TAB_FONT_SIZE - 1, fill: MUTED_TEXT },
      resolution: RESOLUTION,
    });
    clearAllText.eventMode = "static";
    clearAllText.cursor = "pointer";
    clearAllText.visible = false;
    container.addChild(clearAllText);

    clearAllText.on("pointertap", (e) => {
      e.stopPropagation();
      ctx.doc.change((draft) => {
        if (viewMode === "inbox") {
          draft.invites = [];
        } else {
          draft.shares = [];
        }
      });
    });

    // "show resolved" / "hide resolved" toggle — outbox only
    const toggleResolvedText = new Text({
      text: "show resolved",
      style: { fontFamily: FONT, fontSize: TAB_FONT_SIZE - 1, fill: MUTED_TEXT },
      resolution: RESOLUTION,
    });
    toggleResolvedText.eventMode = "static";
    toggleResolvedText.cursor = "pointer";
    toggleResolvedText.visible = false;
    container.addChild(toggleResolvedText);

    toggleResolvedText.on("pointertap", (e) => {
      e.stopPropagation();
      showResolved = !showResolved;
      scrollY = 0;
      layout(currentWidth, currentHeight);
    });

    // "show accepted" / "hide accepted" toggle — inbox only
    const toggleAcceptedText = new Text({
      text: "show accepted",
      style: { fontFamily: FONT, fontSize: TAB_FONT_SIZE - 1, fill: MUTED_TEXT },
      resolution: RESOLUTION,
    });
    toggleAcceptedText.eventMode = "static";
    toggleAcceptedText.cursor = "pointer";
    toggleAcceptedText.visible = false;
    container.addChild(toggleAcceptedText);

    toggleAcceptedText.on("pointertap", (e) => {
      e.stopPropagation();
      showAccepted = !showAccepted;
      scrollY = 0;
      layout(currentWidth, currentHeight);
    });

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
      const canScroll = totalInboxHeight > inboxAreaHeight;
      if (!canScroll) return; // let the event pass through to the canvas viewport

      e.stopPropagation();
      // claim the native event so the viewport doesn't also pan
      if ((e as any).nativeEvent) (e as any).nativeEvent._skeinWidgetScroll = true;
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
      const canScroll = totalOutboxHeight > outboxAreaHeight;
      if (!canScroll) return; // let the event pass through to the canvas viewport

      e.stopPropagation();
      // claim the native event so the viewport doesn't also pan
      if ((e as any).nativeEvent) (e as any).nativeEvent._skeinWidgetScroll = true;
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
          // accept button (outlined rounded rect with text label)
          const acceptBtn = new Container();
          acceptBtn.eventMode = "static";
          acceptBtn.cursor = "pointer";
          const acceptW = 52;
          const acceptH = 22;
          acceptBtn.hitArea = new Rectangle(0, 0, acceptW, acceptH);
          acceptBtn.x = contentW - acceptW - 52 - ROW_PADDING_X - 16;
          acceptBtn.y = (ROW_HEIGHT - acceptH) / 2;

          const acceptBg = new Graphics();
          acceptBg.eventMode = "none";
          acceptBg.roundRect(0, 0, acceptW, acceptH, 4);
          acceptBg.fill({ color: 0x111118 });
          acceptBg.stroke({ color: ACCEPT_COLOR, width: 1.5 });
          acceptBtn.addChild(acceptBg);

          const acceptLabel = new Text({
            text: "accept",
            style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: ACCEPT_COLOR },
            resolution: RESOLUTION,
          });
          acceptLabel.eventMode = "none";
          acceptLabel.anchor.set(0.5);
          acceptLabel.x = acceptW / 2;
          acceptLabel.y = acceptH / 2;
          acceptBtn.addChild(acceptLabel);

          acceptBtn.on("pointertap", (e) => {
            e.stopPropagation();

            // immediate visual feedback — pulsing animation
            acceptBtn.eventMode = "none";
            acceptBtn.cursor = "default";
            acceptLabel.text = "joining...";
            acceptLabel.x = acceptW / 2;

            // pulse opacity animation
            let pulseUp = false;
            const pulseTimer = setInterval(() => {
              if (pulseUp) {
                acceptBtn.alpha = Math.min(acceptBtn.alpha + 0.05, 1.0);
                if (acceptBtn.alpha >= 1.0) pulseUp = false;
              } else {
                acceptBtn.alpha = Math.max(acceptBtn.alpha - 0.05, 0.3);
                if (acceptBtn.alpha <= 0.3) pulseUp = true;
              }
            }, 50);

            const inviteId = invite.id;
            const canvasDocId = invite.canvasDocId;
            const fromNode = invite.fromNodeId;

            // send accept notification to the peer (fire-and-forget)
            sendCanvasInviteAccept(fromNode, {
              inviteId,
              canvasDocId,
              accepterNodeId: localNodeId,
            }).catch((err) => {
              console.warn("[inbox] failed to send accept message:", err);
            });

            // listen for confirmation from boot.ts
            const cleanup = () => {
              clearInterval(pulseTimer);
              acceptBtn.alpha = 1.0;
              window.removeEventListener(
                "skein:accept-canvas-invite-done",
                onDone as EventListener
              );
              clearTimeout(timeout);
            };

            const onDone = (evt: CustomEvent) => {
              if (evt.detail?.canvasDocId !== canvasDocId) return;
              cleanup();
              // NOW change invite status
              ctx.doc.change((draft) => {
                const inv = draft.invites.find(
                  (r: CanvasInvite) => r.id === inviteId && r.status === "pending"
                );
                if (inv) inv.status = "accepted";
              });
              layout(currentWidth, currentHeight);
            };

            const timeout = setTimeout(() => {
              cleanup();
              // timeout — re-enable button so user can retry
              acceptBtn.eventMode = "static";
              acceptBtn.cursor = "pointer";
              acceptLabel.text = "retry";
              acceptLabel.x = acceptW / 2;
              console.warn("[inbox] accept timed out for canvas:", canvasDocId);
            }, 15000);

            window.addEventListener("skein:accept-canvas-invite-done", onDone as EventListener);

            // dispatch the accept event to boot.ts
            window.dispatchEvent(
              new CustomEvent("skein:accept-canvas-invite", {
                detail: {
                  canvasDocId: invite.canvasDocId,
                  fromNodeId: invite.fromNodeId,
                  canvasTitle: invite.canvasTitle,
                  canvasDescription: invite.canvasDescription ?? "",
                  canvasColor: invite.canvasColor ?? 0,
                  canvasPreviewUrl: invite.canvasPreviewUrl ?? "",
                  fromUsername: invite.fromUsername ?? "",
                },
              })
            );
          });
          rowContainer.addChild(acceptBtn);

          // decline button (outlined rounded rect with text label)
          const declineW = 52;
          const declineH = 22;
          const declineBtn = new Container();
          declineBtn.eventMode = "static";
          declineBtn.cursor = "pointer";
          declineBtn.hitArea = new Rectangle(0, 0, declineW, declineH);
          declineBtn.x = contentW - declineW - ROW_PADDING_X;
          declineBtn.y = (ROW_HEIGHT - declineH) / 2;

          const declineBg = new Graphics();
          declineBg.eventMode = "none";
          declineBg.roundRect(0, 0, declineW, declineH, 4);
          declineBg.fill({ color: 0x111118 });
          declineBg.stroke({ color: DECLINE_COLOR, width: 1.5 });
          declineBtn.addChild(declineBg);

          const declineLabel = new Text({
            text: "decline",
            style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: DECLINE_COLOR },
            resolution: RESOLUTION,
          });
          declineLabel.eventMode = "none";
          declineLabel.anchor.set(0.5);
          declineLabel.x = declineW / 2;
          declineLabel.y = declineH / 2;
          declineBtn.addChild(declineLabel);

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

      // filter out resolved items unless toggle is on
      const visible = showResolved
        ? shares
        : shares.filter((s) => !s.delivered && !s.accepted && !s.declined);

      // sort: undelivered first, then by sentAt descending
      const sorted = [...visible].sort((a, b) => {
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

      const staleDeletions = (state.deletions ?? []).filter(
        (d: CanvasDeletedNotif) =>
          d.status === "dismissed" &&
          d.deletedAt &&
          now - new Date(d.deletedAt).getTime() > CLEANUP_MS
      );

      if (staleInvites.length > 0 || staleShares.length > 0 || staleDeletions.length > 0) {
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
          if (staleDeletions.length > 0) {
            draft.deletions = draft.deletions.filter(
              (d: CanvasDeletedNotif) =>
                d.status !== "dismissed" ||
                !d.deletedAt ||
                now - new Date(d.deletedAt).getTime() <= CLEANUP_MS
            );
          }
        });
      }

      const invites = state.invites ?? [];
      const shares = state.shares ?? [];
      const deletions = state.deletions ?? [];
      const pendingCount =
        invites.filter((inv: CanvasInvite) => inv.status === "pending").length +
        deletions.filter((d: CanvasDeletedNotif) => d.status === "unread").length;
      const contentW = w - PADDING_X * 2;
      let y = PADDING_Y;

      // card background
      drawCard(w, h);

      // tab bar
      drawTabBar(y, pendingCount);

      // position "clear all" and "show resolved" on the tab bar line
      const tabBtnY = y + (TAB_HEIGHT - (TAB_FONT_SIZE - 1)) / 2;
      const currentTabItems = viewMode === "inbox" ? invites.length : shares.length;

      clearAllText.visible = currentTabItems > 0;
      clearAllText.x = w - PADDING_X - clearAllText.width;
      clearAllText.y = tabBtnY;

      toggleResolvedText.text = showResolved ? "hide resolved" : "show resolved";
      toggleResolvedText.visible = viewMode === "outbox" && shares.length > 0;
      toggleResolvedText.x = clearAllText.visible
        ? clearAllText.x - toggleResolvedText.width - 12
        : w - PADDING_X - toggleResolvedText.width;
      toggleResolvedText.y = tabBtnY;

      toggleAcceptedText.text = showAccepted ? "hide accepted" : "show accepted";
      toggleAcceptedText.visible = viewMode === "inbox" && invites.length > 0;
      toggleAcceptedText.x = clearAllText.visible
        ? clearAllText.x - toggleAcceptedText.width - 12
        : w - PADDING_X - toggleAcceptedText.width;
      toggleAcceptedText.y = tabBtnY;

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
        inboxListContainer.hitArea = new Rectangle(0, 0, contentW, inboxAreaHeight);

        // filter invites based on toggle
        const visibleInvites = showAccepted
          ? invites
          : invites.filter((inv: CanvasInvite) => inv.status === "pending");

        // filter deletions based on toggle
        const visibleDeletions = deletions.filter(
          (d: CanvasDeletedNotif) => showAccepted || d.status === "unread"
        );

        // rebuild rows
        rebuildInboxRows(visibleInvites, contentW);

        // append deletion notification rows below invites
        if (visibleDeletions.length > 0) {
          const delSorted = [...visibleDeletions].sort((a, b) => {
            if (a.status === "unread" && b.status !== "unread") return -1;
            if (a.status !== "unread" && b.status === "unread") return 1;
            return new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime();
          });

          const delStartY = totalInboxHeight;
          for (let i = 0; i < delSorted.length; i++) {
            const notif = delSorted[i];
            const rowY = delStartY + i * ROW_HEIGHT;

            const rowContainer = new Container();
            rowContainer.eventMode = "static";
            rowContainer.y = rowY;
            inboxListInner.addChild(rowContainer);

            // alternating row bg (continue from invite count)
            const globalIdx = totalInboxHeight / ROW_HEIGHT + i;
            const rowBg = new Graphics();
            rowBg.eventMode = "none";
            if (globalIdx % 2 === 1) {
              rowBg.rect(0, 0, contentW, ROW_HEIGHT);
              rowBg.fill({ color: ROW_ALT_BG, alpha: 0.5 });
            }
            rowContainer.addChild(rowBg);

            // red color stripe for deletion
            const stripe = new Graphics();
            stripe.rect(0, 2, COLOR_STRIPE_WIDTH, ROW_HEIGHT - 4);
            stripe.fill({ color: DECLINE_COLOR });
            rowContainer.addChild(stripe);

            // thumbnail — initial letter
            const thumbColor = isTransparent(notif.canvasColor)
              ? BORDER
              : safeColor(notif.canvasColor);
            const thumbX = COLOR_STRIPE_WIDTH + 4;
            const thumbY = (ROW_HEIGHT - THUMB_SIZE) / 2;

            const thumbBg = new Graphics();
            thumbBg.roundRect(thumbX, thumbY, THUMB_SIZE, THUMB_SIZE, THUMB_RADIUS);
            thumbBg.fill({ color: thumbColor, alpha: 0.3 });
            rowContainer.addChild(thumbBg);

            const titleInitial = (notif.canvasTitle || "?")[0].toUpperCase();
            const thumbLetter = new Text({
              text: titleInitial,
              style: {
                fontFamily: FONT,
                fontSize: THUMB_SIZE * 0.5,
                fontWeight: "bold",
                fill: thumbColor,
                align: "center",
              },
              resolution: RESOLUTION,
            });
            thumbLetter.x = thumbX + (THUMB_SIZE - thumbLetter.width) / 2;
            thumbLetter.y = thumbY + (THUMB_SIZE - thumbLetter.height) / 2;
            rowContainer.addChild(thumbLetter);

            // text
            const leftW = COLOR_STRIPE_WIDTH + 4 + THUMB_SIZE + THUMB_MARGIN;
            const textX = leftW;
            const isPurge = notif.deleteMode === "purge";
            const actionLabel = isPurge ? "purged" : "deleted";
            const displayName = notif.deletedByUsername || notif.deletedBy.slice(0, 12) + "...";

            const titleText = new Text({
              text: `${displayName} ${actionLabel} canvas`,
              style: {
                fontFamily: FONT,
                fontSize: ROW_NAME_SIZE,
                fontWeight: "bold",
                fill: TEXT_COLOR,
              },
              resolution: RESOLUTION,
            });
            titleText.x = textX;
            titleText.y = 8;
            rowContainer.addChild(titleText);

            const descText = new Text({
              text: truncate(notif.canvasTitle || "untitled", 30),
              style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
              resolution: RESOLUTION,
            });
            descText.x = textX;
            descText.y = titleText.y + titleText.height + 2;
            rowContainer.addChild(descText);

            const metaText = new Text({
              text: relativeTime(notif.deletedAt),
              style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: MUTED_TEXT },
              resolution: RESOLUTION,
            });
            metaText.x = textX;
            metaText.y = descText.y + descText.height + 2;
            rowContainer.addChild(metaText);

            // dismiss button
            if (notif.status === "unread") {
              const dismissW = 60;
              const dismissH = ACTION_BTN_SIZE;
              const dismissBtn = new Container();
              dismissBtn.eventMode = "static";
              dismissBtn.cursor = "pointer";

              const dismissBg = new Graphics();
              dismissBg.roundRect(0, 0, dismissW, dismissH, 4);
              dismissBg.fill({ color: DECLINE_COLOR });
              dismissBg.stroke({ color: DECLINE_COLOR, width: 1 });
              dismissBtn.addChild(dismissBg);

              const dismissLabel = new Text({
                text: "dismiss",
                style: { fontFamily: FONT, fontSize: ROW_SUB_SIZE, fill: 0xffffff },
                resolution: RESOLUTION,
              });
              dismissLabel.x = (dismissW - dismissLabel.width) / 2;
              dismissLabel.y = (dismissH - dismissLabel.height) / 2;
              dismissBtn.addChild(dismissLabel);

              dismissBtn.x = contentW - dismissW - ROW_PADDING_X;
              dismissBtn.y = (ROW_HEIGHT - dismissH) / 2;

              const notifId = notif.id;
              dismissBtn.on("pointertap", () => {
                ctx.doc.change((draft: any) => {
                  const del = (draft.deletions ?? []).find((d: any) => d.id === notifId);
                  if (del) del.status = "dismissed";
                });
              });

              rowContainer.addChild(dismissBtn);
            } else {
              const statusIcon = new Text({
                text: "\u2713",
                style: {
                  fontFamily: FONT,
                  fontSize: ROW_NAME_SIZE,
                  fontWeight: "bold",
                  fill: MUTED_TEXT,
                },
                resolution: RESOLUTION,
              });
              statusIcon.x = contentW - statusIcon.width - ROW_PADDING_X;
              statusIcon.y = (ROW_HEIGHT - statusIcon.height) / 2;
              rowContainer.addChild(statusIcon);
            }
          }

          totalInboxHeight += delSorted.length * ROW_HEIGHT;
        }

        // clamp scroll
        clampInboxScroll();
        inboxListInner.y = -scrollY;

        // empty state
        if (visibleInvites.length === 0 && visibleDeletions.length === 0) {
          inboxEmptyText.text =
            invites.length > 0 || deletions.length > 0 ? "all resolved" : "no messages yet";
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
        outboxListContainer.hitArea = new Rectangle(0, 0, contentW, outboxAreaHeight);

        // rebuild rows
        rebuildOutboxRows(shares, contentW);

        // clamp scroll
        clampOutboxScroll();
        outboxListInner.y = -scrollY;

        // empty state
        if (shares.length === 0) {
          outboxEmptyText.text = "no shares yet";
          outboxEmptyText.visible = true;
          outboxEmptyText.x = PADDING_X + (contentW - outboxEmptyText.width) / 2;
          outboxEmptyText.y = outboxAreaY + outboxAreaHeight / 2 - 6;
        } else if (totalOutboxHeight === 0) {
          outboxEmptyText.text = "all shares resolved";
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

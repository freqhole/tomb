/**
 * share dialog for the skein canvas app.
 *
 * uses @pixi/ui Dialog for the modal (backdrop, centering, button layout)
 * and DOM <input readonly> overlays for the share string / URL fields so
 * the user gets native text selection and clipboard support.
 *
 * everything else (labels, copy buttons, panel background) is pure pixi.
 */

import { ButtonContainer, Dialog, FancyButton } from "@pixi/ui";
import { Container, Graphics, Text, type Application } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export interface FriendInfo {
  friendId: string;
  username: string;
  nodeId: string;
  avatarDataUrl?: string;
  isOnline: boolean;
}

export interface ShareDialogOptions {
  app: Application;
  theme: SkeinTheme;
  shareString: string;
  shareUrl: string;
  /** list of peer node IDs this canvas is shared with (from canvas doc) */
  peers?: Array<{ nodeId: string; joinedAt: string }>;
  /** called when user clicks "remove" on a peer */
  onRemovePeer?: (nodeId: string) => void;
  /** called when user clicks "add friend" on a peer — sends a friend request */
  onAddFriend?: (nodeId: string) => void | Promise<void>;
  /** list of friends who haven't been invited to this canvas yet */
  friends?: FriendInfo[];
  /** called when user clicks "invite" on a friend row — sends canvas-invite */
  onInviteFriend?: (friend: FriendInfo) => void | Promise<void>;
  onClose?: () => void;
  /** optional map of nodeId -> display name for resolving peer names from friends list */
  peerDisplayNames?: Map<string, string>;
  /** pending invites on this canvas (from canvas doc pendingInvites) */
  pendingInvites?: Array<{
    targetNodeId: string;
    invite: {
      invitedBy: string;
      invitedByUsername: string;
      role: string;
      invitedAt: string;
    };
  }>;
  /** callback when user cancels a pending invite */
  onCancelInvite?: (targetNodeId: string) => void;
  /** declined invites (from messagez outbox shares where declined === true) */
  declinedInvites?: Array<{
    toNodeId: string;
    toUsername: string;
    canvasTitle: string;
    sentAt: string;
  }>;
}

export interface ShareDialogHandle {
  remove(): void;
}

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const DIALOG_WIDTH = 420;
const DIALOG_PADDING = 20;
const SECTION_GAP = 16;
const LABEL_GAP = 6;
const INPUT_HEIGHT = 28;
const BUTTON_PAD_H = 14;
const BUTTON_PAD_V = 6;
const COPY_FEEDBACK_MS = 1500;
const DIALOG_Z = 10002;
const DOM_Z = "10003";

const AVATAR_COLORS = [
  0x6366f1, 0x8b5cf6, 0xec4899, 0xf43f5e, 0xf97316, 0xeab308, 0x22c55e, 0x14b8a6, 0x3b82f6,
];

// ---------------------------------------------------------------------------
// helpers — pixi
// ---------------------------------------------------------------------------

function makeLabel(text: string, theme: SkeinTheme): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSizeSmall,
      fill: theme.frameHeaderText,
    },
    resolution: theme.textResolution,
  });
  t.eventMode = "none";
  return t;
}

function makeCopyButton(theme: SkeinTheme): {
  btn: ButtonContainer;
  bg: Graphics;
  text: Text;
  width: number;
  height: number;
} {
  const text = new Text({
    text: "copy",
    style: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSizeSmall,
      fill: 0xffffff,
    },
    resolution: theme.textResolution,
  });
  text.eventMode = "none";

  const bg = new Graphics();
  const width = text.width + BUTTON_PAD_H * 2;
  const height = text.height + BUTTON_PAD_V * 2;
  bg.roundRect(0, 0, width, height, 4);
  bg.fill({ color: theme.accent });

  const view = new Container();
  view.addChild(bg);
  text.x = BUTTON_PAD_H;
  text.y = BUTTON_PAD_V;
  view.addChild(text);

  const btn = new ButtonContainer(view);
  btn.cursor = "pointer";

  return { btn, bg, text, width, height };
}

/** redraw a copy button background (used after text change) */
function redrawCopyBg(bg: Graphics, text: Text, height: number, color: number): void {
  const w = text.width + BUTTON_PAD_H * 2;
  bg.clear();
  bg.roundRect(0, 0, w, height, 4);
  bg.fill({ color });
}

/** wire a copy button to clipboard + "copied!" feedback */
function wireCopy(
  btn: ButtonContainer,
  bg: Graphics,
  text: Text,
  btnHeight: number,
  value: string,
  theme: SkeinTheme,
  isRemoved: () => boolean
): void {
  btn.onPress.connect(() => {
    navigator.clipboard.writeText(value).then(
      () => {
        text.text = "copied!";
        redrawCopyBg(bg, text, btnHeight, theme.accent);
        setTimeout(() => {
          if (isRemoved()) return;
          text.text = "copy";
          redrawCopyBg(bg, text, btnHeight, theme.accent);
        }, COPY_FEEDBACK_MS);
      },
      () => {
        console.log("[skein:share] copy failed:", value.slice(0, 32) + "...");
      }
    );
  });
}

// ---------------------------------------------------------------------------
// helpers — peer row
// ---------------------------------------------------------------------------

function buildPeerRow(
  nodeId: string,
  _joinedAt: string,
  theme: SkeinTheme,
  scrollBoxWidth: number,
  copyBtnH: number,
  isRemoved: () => boolean,
  onRemovePeer?: (nodeId: string) => void,
  onAddFriend?: (nodeId: string) => void | Promise<void>,
  displayName?: string
): Container {
  const row = new Container();

  // defensive: coerce nodeId to string (automerge may return non-string from Rust peer writes)
  const safeNodeId = typeof nodeId === "string" ? nodeId : String((nodeId as unknown) ?? "unknown");
  if (safeNodeId !== nodeId) {
    console.warn("[share-dialog] buildPeerRow: coerced non-string nodeId:", typeof nodeId, nodeId);
  }

  // peer display: show name if known, otherwise truncated node ID
  const truncated = safeNodeId.slice(0, 8) + "..." + safeNodeId.slice(-8);
  const label = displayName ? displayName : truncated;
  const idText = new Text({
    text: label,
    style: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSizeSmall,
      fill: theme.frameHeaderText,
      fontWeight: displayName ? "bold" : "normal",
    },
    resolution: theme.textResolution,
  });
  idText.eventMode = "none";
  idText.y = (copyBtnH - idText.height) / 2;
  row.addChild(idText);

  // show truncated nodeId below the name if we have a display name
  if (displayName) {
    const subIdText = new Text({
      text: truncated,
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall - 1,
        fill: 0x6b7280,
      },
      resolution: theme.textResolution,
    });
    subIdText.eventMode = "none";
    subIdText.x = idText.x + idText.width + 6;
    subIdText.y = (copyBtnH - subIdText.height) / 2;
    row.addChild(subIdText);
  }
  // copy button — copies full node ID
  const copyBtn = makeCopyButton(theme);
  let rightOffset = 8;
  if (onRemovePeer) rightOffset += 70;
  if (onAddFriend) rightOffset += 70;
  copyBtn.btn.x = scrollBoxWidth - copyBtn.width - rightOffset;
  copyBtn.btn.y = 0;
  row.addChild(copyBtn.btn);
  wireCopy(copyBtn.btn, copyBtn.bg, copyBtn.text, copyBtnH, safeNodeId, theme, isRemoved);

  // remove button (if handler provided)
  if (onRemovePeer) {
    const removeBtnText = new Text({
      text: "remove",
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall,
        fill: 0xef4444,
      },
      resolution: theme.textResolution,
    });
    removeBtnText.eventMode = "none";

    const removeBtnBg = new Graphics();
    const removeW = removeBtnText.width + 14 * 2;
    const removeH = removeBtnText.height + 6 * 2;
    removeBtnBg.roundRect(0, 0, removeW, removeH, 4);
    removeBtnBg.fill({ color: 0x7f1d1d });

    const removeView = new Container();
    removeView.addChild(removeBtnBg);
    removeBtnText.x = 14;
    removeBtnText.y = 6;
    removeView.addChild(removeBtnText);

    const removeBtn = new ButtonContainer(removeView);
    removeBtn.cursor = "pointer";
    removeBtn.x = scrollBoxWidth - removeW;
    removeBtn.y = 0;
    row.addChild(removeBtn);

    removeBtn.onPress.connect(() => {
      onRemovePeer(safeNodeId);
    });
  }

  // add friend button (if handler provided)
  if (onAddFriend) {
    const friendBtnText = new Text({
      text: "friend",
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall,
        fill: 0xa78bfa,
      },
      resolution: theme.textResolution,
    });
    friendBtnText.eventMode = "none";

    const friendBtnBg = new Graphics();
    const friendW = friendBtnText.width + 14 * 2;
    const friendH = friendBtnText.height + 6 * 2;
    friendBtnBg.roundRect(0, 0, friendW, friendH, 4);
    friendBtnBg.fill({ color: 0x2e1065 });

    const friendView = new Container();
    friendView.addChild(friendBtnBg);
    friendBtnText.x = 14;
    friendBtnText.y = 6;
    friendView.addChild(friendBtnText);

    const friendBtn = new ButtonContainer(friendView);
    friendBtn.cursor = "pointer";

    let friendRightOffset = 8;
    if (onRemovePeer) friendRightOffset += 70;
    friendBtn.x = scrollBoxWidth - friendW - friendRightOffset;
    friendBtn.y = 0;
    row.addChild(friendBtn);

    friendBtn.onPress.connect(async () => {
      // show immediate feedback
      friendBtnText.text = "sending...";
      friendBtnBg.clear();
      const sendingW = friendBtnText.width + 14 * 2;
      friendBtnBg.roundRect(0, 0, sendingW, friendH, 4);
      friendBtnBg.fill({ color: 0x1e1b4b });

      try {
        await onAddFriend(safeNodeId);
        if (isRemoved()) return;
        friendBtnText.text = "sent!";
      } catch {
        if (isRemoved()) return;
        friendBtnText.text = "failed";
      }

      friendBtnBg.clear();
      const feedbackW = friendBtnText.width + 14 * 2;
      friendBtnBg.roundRect(0, 0, feedbackW, friendH, 4);
      friendBtnBg.fill({ color: 0x1e1b4b });

      setTimeout(() => {
        if (isRemoved()) return;
        friendBtnText.text = "friend";
        friendBtnBg.clear();
        friendBtnBg.roundRect(0, 0, friendW, friendH, 4);
        friendBtnBg.fill({ color: 0x2e1065 });
      }, 1500);
    });
  }

  return row;
}

// ---------------------------------------------------------------------------
// helpers — friend invite row
// ---------------------------------------------------------------------------

function buildFriendInviteRow(
  friend: FriendInfo,
  theme: SkeinTheme,
  scrollBoxWidth: number,
  rowHeight: number,
  isRemoved: () => boolean,
  onInvite?: (friend: FriendInfo) => void | Promise<void>
): Container {
  const row = new Container();

  // avatar circle — colored based on username hash
  const avatarSize = 22;
  const charSum = friend.username.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const avatarColor = AVATAR_COLORS[charSum % AVATAR_COLORS.length];

  const avatarBg = new Graphics();
  avatarBg.circle(avatarSize / 2, avatarSize / 2, avatarSize / 2);
  avatarBg.fill({ color: avatarColor });
  avatarBg.y = (rowHeight - avatarSize) / 2;
  row.addChild(avatarBg);

  // initial letter centered in avatar
  const initial = (friend.username[0] ?? "?").toUpperCase();
  const initialText = new Text({
    text: initial,
    style: {
      fontFamily: theme.fontFamily,
      fontSize: 11,
      fontWeight: "bold",
      fill: 0xffffff,
    },
    resolution: theme.textResolution,
  });
  initialText.eventMode = "none";
  initialText.x = (avatarSize - initialText.width) / 2;
  initialText.y = avatarBg.y + (avatarSize - initialText.height) / 2;
  row.addChild(initialText);

  // online status dot — 6px circle at bottom-right of avatar
  const dotSize = 6;
  const statusDot = new Graphics();
  statusDot.circle(dotSize / 2, dotSize / 2, dotSize / 2);
  statusDot.fill({ color: friend.isOnline ? 0x22c55e : 0x6b7280 });
  statusDot.x = avatarSize - dotSize + 1;
  statusDot.y = avatarBg.y + avatarSize - dotSize + 1;
  row.addChild(statusDot);

  // username text
  const displayName = friend.username || friend.nodeId.slice(0, 12) + "...";
  const nameText = new Text({
    text: displayName,
    style: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSizeSmall,
      fill: theme.frameHeaderText,
    },
    resolution: theme.textResolution,
  });
  nameText.eventMode = "none";
  nameText.x = avatarSize + 8;
  nameText.y = (rowHeight - nameText.height) / 2;
  row.addChild(nameText);

  // invite button — right-aligned
  const inviteBtnText = new Text({
    text: "invite",
    style: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSizeSmall,
      fill: 0x60a5fa,
    },
    resolution: theme.textResolution,
  });
  inviteBtnText.eventMode = "none";

  const inviteBtnBg = new Graphics();
  const inviteW = inviteBtnText.width + 14 * 2;
  const inviteH = inviteBtnText.height + 6 * 2;
  inviteBtnBg.roundRect(0, 0, inviteW, inviteH, 4);
  inviteBtnBg.fill({ color: 0x1e3a5f });

  const inviteView = new Container();
  inviteView.addChild(inviteBtnBg);
  inviteBtnText.x = 14;
  inviteBtnText.y = 6;
  inviteView.addChild(inviteBtnText);

  const inviteBtn = new ButtonContainer(inviteView);
  inviteBtn.cursor = "pointer";
  inviteBtn.x = scrollBoxWidth - inviteW - 8;
  inviteBtn.y = (rowHeight - inviteH) / 2;
  row.addChild(inviteBtn);

  inviteBtn.onPress.connect(async () => {
    // show sending feedback
    inviteBtnText.text = "sending...";
    inviteBtnText.style.fill = 0x60a5fa;
    inviteBtnBg.clear();
    const sendingW = inviteBtnText.width + 14 * 2;
    inviteBtnBg.roundRect(0, 0, sendingW, inviteH, 4);
    inviteBtnBg.fill({ color: 0x1e1b4b });

    try {
      await onInvite?.(friend);
      if (isRemoved()) return;
      // success state
      inviteBtnText.text = "sent!";
      inviteBtnText.style.fill = 0x4ade80;
      inviteBtnBg.clear();
      const sentW = inviteBtnText.width + 14 * 2;
      inviteBtnBg.roundRect(0, 0, sentW, inviteH, 4);
      inviteBtnBg.fill({ color: 0x14532d });
    } catch {
      if (isRemoved()) return;
      // failure state
      inviteBtnText.text = "failed";
      inviteBtnText.style.fill = 0xef4444;
      inviteBtnBg.clear();
      const failW = inviteBtnText.width + 14 * 2;
      inviteBtnBg.roundRect(0, 0, failW, inviteH, 4);
      inviteBtnBg.fill({ color: 0x7f1d1d });
    }

    // revert to invite after delay
    setTimeout(() => {
      if (isRemoved()) return;
      inviteBtnText.text = "invite";
      inviteBtnText.style.fill = 0x60a5fa;
      inviteBtnBg.clear();
      inviteBtnBg.roundRect(0, 0, inviteW, inviteH, 4);
      inviteBtnBg.fill({ color: 0x1e3a5f });
    }, COPY_FEEDBACK_MS);
  });

  return row;
}

// ---------------------------------------------------------------------------
// helpers — pending invite row
// ---------------------------------------------------------------------------

function buildPendingInviteRow(
  targetNodeId: string,
  invite: { invitedBy: string; invitedByUsername: string; role: string; invitedAt: string },
  theme: SkeinTheme,
  scrollBoxWidth: number,
  rowHeight: number,
  _isRemoved: () => boolean,
  onCancelInvite?: (targetNodeId: string) => void,
  displayName?: string
): Container {
  const row = new Container();

  // name or truncated node ID
  const truncated = targetNodeId.slice(0, 8) + "..." + targetNodeId.slice(-8);
  const label = displayName || truncated;
  const nameText = new Text({
    text: label,
    style: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSizeSmall,
      fill: theme.frameHeaderText,
      fontWeight: displayName ? "bold" : "normal",
    },
    resolution: theme.textResolution,
  });
  nameText.eventMode = "none";
  nameText.y = (rowHeight - nameText.height) / 2;
  row.addChild(nameText);

  // "invited [date]" subtitle
  const invitedDate = invite.invitedAt ? new Date(invite.invitedAt).toLocaleDateString() : "";
  const dateText = new Text({
    text: invitedDate ? `invited ${invitedDate}` : "invited",
    style: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSizeSmall - 1,
      fill: 0x6b7280,
    },
    resolution: theme.textResolution,
  });
  dateText.eventMode = "none";
  dateText.x = nameText.x + nameText.width + 8;
  dateText.y = (rowHeight - dateText.height) / 2;
  row.addChild(dateText);

  // cancel button
  if (onCancelInvite) {
    const cancelBtnText = new Text({
      text: "cancel",
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall,
        fill: 0xef4444,
      },
      resolution: theme.textResolution,
    });
    cancelBtnText.eventMode = "none";

    const cancelBtnBg = new Graphics();
    const cancelW = cancelBtnText.width + 14 * 2;
    const cancelH = cancelBtnText.height + 6 * 2;
    cancelBtnBg.roundRect(0, 0, cancelW, cancelH, 4);
    cancelBtnBg.fill({ color: 0x7f1d1d });

    const cancelView = new Container();
    cancelView.addChild(cancelBtnBg);
    cancelBtnText.x = 14;
    cancelBtnText.y = 6;
    cancelView.addChild(cancelBtnText);

    const cancelBtn = new ButtonContainer(cancelView);
    cancelBtn.cursor = "pointer";
    cancelBtn.x = scrollBoxWidth - cancelW;
    cancelBtn.y = (rowHeight - cancelH) / 2;
    row.addChild(cancelBtn);

    cancelBtn.onPress.connect(() => {
      onCancelInvite(targetNodeId);

      // visual feedback
      cancelBtnText.text = "cancelled";
      cancelBtnText.style.fill = 0x6b7280;
      cancelBtnBg.clear();
      const feedbackW = cancelBtnText.width + 14 * 2;
      cancelBtnBg.roundRect(0, 0, feedbackW, cancelH, 4);
      cancelBtnBg.fill({ color: 0x1f1f1f });
    });
  }

  return row;
}

// ---------------------------------------------------------------------------
// helpers — declined invite row
// ---------------------------------------------------------------------------

function buildDeclinedRow(
  toNodeId: string,
  toUsername: string,
  theme: SkeinTheme,
  _scrollBoxWidth: number,
  rowHeight: number,
  displayName?: string
): Container {
  const row = new Container();

  // name or truncated node ID
  const truncated = toNodeId.slice(0, 8) + "..." + toNodeId.slice(-8);
  const label = displayName || toUsername || truncated;
  const nameText = new Text({
    text: label,
    style: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSizeSmall,
      fill: theme.frameHeaderText,
    },
    resolution: theme.textResolution,
  });
  nameText.eventMode = "none";
  nameText.y = (rowHeight - nameText.height) / 2;
  row.addChild(nameText);

  // "declined" status label
  const statusText = new Text({
    text: "declined",
    style: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSizeSmall,
      fill: 0x6b7280,
    },
    resolution: theme.textResolution,
  });
  statusText.eventMode = "none";
  statusText.x = nameText.x + nameText.width + 8;
  statusText.y = (rowHeight - statusText.height) / 2;
  row.addChild(statusText);

  return row;
}

// ---------------------------------------------------------------------------
// helpers — DOM input overlays
// ---------------------------------------------------------------------------

/**
 * create a read-only DOM <input> positioned over a pixi placeholder container.
 * the input floats above the canvas with position: fixed so the user can
 * select and copy text natively.
 */
function createReadOnlyInput(
  placeholder: Container,
  canvasElement: HTMLCanvasElement,
  value: string,
  theme: SkeinTheme
): HTMLInputElement {
  const globalPos = placeholder.toGlobal({ x: 0, y: 0 });
  const globalEnd = placeholder.toGlobal({
    x: placeholder.width,
    y: placeholder.height,
  });
  const rect = canvasElement.getBoundingClientRect();

  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = value;
  input.autocomplete = "off";
  input.setAttribute("autocorrect", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("spellcheck", "false");

  const s = input.style;
  s.position = "fixed";
  s.left = `${rect.left + globalPos.x}px`;
  s.top = `${rect.top + globalPos.y}px`;
  s.width = `${globalEnd.x - globalPos.x}px`;
  s.height = `${globalEnd.y - globalPos.y}px`;
  s.fontFamily = theme.fontFamily;
  s.fontSize = `${theme.fontSizeSmall}px`;
  s.color = "#e0e0e0";
  s.background = "#0a0a0a";
  s.border = "1px solid #2a2a2a";
  s.borderRadius = "4px";
  s.padding = "0 8px";
  s.boxSizing = "border-box";
  s.outline = "none";
  s.zIndex = DOM_Z;

  document.body.appendChild(input);
  return input;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * show a share dialog using @pixi/ui Dialog with DOM input overlays
 * for the share string and share URL fields.
 *
 * dismisses on backdrop click, Escape, or the close button.
 */
export function showShareDialog(options: ShareDialogOptions): ShareDialogHandle {
  const { app, theme, shareString, shareUrl, onClose } = options;
  const peerList = options.peers ?? [];

  let removed = false;
  const isRemoved = () => removed;
  const domInputs: HTMLInputElement[] = [];

  // -------------------------------------------------------------------------
  // measure a copy button so we can compute row layout
  // -------------------------------------------------------------------------

  const copyBtnProbe = makeCopyButton(theme);
  const copyBtnW = copyBtnProbe.width;
  const copyBtnH = copyBtnProbe.height;

  // scrollBox width = dialogWidth - 2 * padding (Dialog does this internally)
  const scrollBoxWidth = DIALOG_WIDTH - DIALOG_PADDING * 2;
  const valueWidth = scrollBoxWidth - copyBtnW - 8;

  // -------------------------------------------------------------------------
  // build content rows — each row: label + placeholder + copy button
  // -------------------------------------------------------------------------

  function buildRow(
    labelStr: string,
    value: string
  ): { container: Container; placeholder: Graphics; copyBtn: ReturnType<typeof makeCopyButton> } {
    const row = new Container();

    const label = makeLabel(labelStr, theme);
    label.x = 0;
    label.y = 0;
    row.addChild(label);

    // placeholder graphics — marks where the DOM input will float
    const placeholder = new Graphics();
    placeholder.roundRect(0, 0, valueWidth, INPUT_HEIGHT, 4);
    placeholder.fill({ color: 0x0a0a0a });
    placeholder.stroke({ color: 0x2a2a2a, width: 1 });
    placeholder.x = 0;
    placeholder.y = label.height + LABEL_GAP;
    row.addChild(placeholder);

    // copy button
    const copyBtn = makeCopyButton(theme);
    copyBtn.btn.x = valueWidth + 8;
    copyBtn.btn.y = label.height + LABEL_GAP + (INPUT_HEIGHT - copyBtnH) / 2;
    row.addChild(copyBtn.btn);

    wireCopy(copyBtn.btn, copyBtn.bg, copyBtn.text, copyBtnH, value, theme, isRemoved);

    return { container: row, placeholder, copyBtn };
  }

  const row1 = buildRow("share string", shareString);
  const row2 = buildRow("share URL", shareUrl);

  // -------------------------------------------------------------------------
  // peer list section
  // -------------------------------------------------------------------------

  const peerSection = new Container();
  const peerLabel = makeLabel("shared with", theme);
  peerSection.addChild(peerLabel);

  if (peerList.length === 0) {
    const emptyText = new Text({
      text: "no peers yet",
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall,
        fill: 0x6b7280,
      },
      resolution: theme.textResolution,
    });
    emptyText.y = peerLabel.height + LABEL_GAP;
    peerSection.addChild(emptyText);
  } else {
    let peerY = peerLabel.height + LABEL_GAP;
    const nameMap = options.peerDisplayNames;
    for (const peer of peerList) {
      const peerRow = buildPeerRow(
        peer.nodeId,
        peer.joinedAt,
        theme,
        scrollBoxWidth,
        copyBtnH,
        isRemoved,
        options.onRemovePeer,
        options.onAddFriend,
        nameMap?.get(peer.nodeId)
      );
      peerRow.y = peerY;
      peerSection.addChild(peerRow);
      peerY += copyBtnH + 4;
    }
  }

  // -------------------------------------------------------------------------
  // friend invite section
  // -------------------------------------------------------------------------

  const friendSection = new Container();
  const friendLabel = makeLabel("invite friends", theme);
  friendSection.addChild(friendLabel);

  const friendList = options.friends ?? [];

  if (friendList.length === 0) {
    const noFriendsText = new Text({
      text: "no friends to invite",
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall,
        fill: 0x6b7280,
      },
      resolution: theme.textResolution,
    });
    noFriendsText.eventMode = "none";
    noFriendsText.y = friendLabel.height + LABEL_GAP;
    friendSection.addChild(noFriendsText);
  } else {
    let friendY = friendLabel.height + LABEL_GAP;
    for (const friend of friendList) {
      const friendRow = buildFriendInviteRow(
        friend,
        theme,
        scrollBoxWidth,
        copyBtnH,
        isRemoved,
        options.onInviteFriend
      );
      friendRow.y = friendY;
      friendSection.addChild(friendRow);
      friendY += copyBtnH + 4;
    }
  }

  // -------------------------------------------------------------------------
  // pending invites section
  // -------------------------------------------------------------------------

  const pendingSection = new Container();
  const pendingLabel = makeLabel("pending invites", theme);
  pendingSection.addChild(pendingLabel);

  const pendingList = options.pendingInvites ?? [];
  const nameMap = options.peerDisplayNames;

  if (pendingList.length === 0) {
    const noPendingText = new Text({
      text: "no pending invites",
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall,
        fill: 0x6b7280,
      },
      resolution: theme.textResolution,
    });
    noPendingText.eventMode = "none";
    noPendingText.y = pendingLabel.height + LABEL_GAP;
    pendingSection.addChild(noPendingText);
  } else {
    let pendingY = pendingLabel.height + LABEL_GAP;
    for (const entry of pendingList) {
      const pendingRow = buildPendingInviteRow(
        entry.targetNodeId,
        entry.invite,
        theme,
        scrollBoxWidth,
        copyBtnH,
        isRemoved,
        options.onCancelInvite,
        nameMap?.get(entry.targetNodeId)
      );
      pendingRow.y = pendingY;
      pendingSection.addChild(pendingRow);
      pendingY += copyBtnH + 4;
    }
  }

  // -------------------------------------------------------------------------
  // declined invites section
  // -------------------------------------------------------------------------

  const declinedSection = new Container();
  const declinedLabel = makeLabel("declined", theme);
  declinedSection.addChild(declinedLabel);

  const declinedList = options.declinedInvites ?? [];

  if (declinedList.length === 0) {
    const noneText = new Text({
      text: "none",
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall,
        fill: 0x6b7280,
      },
      resolution: theme.textResolution,
    });
    noneText.eventMode = "none";
    noneText.y = declinedLabel.height + LABEL_GAP;
    declinedSection.addChild(noneText);
  } else {
    let declinedY = declinedLabel.height + LABEL_GAP;
    for (const entry of declinedList) {
      const declinedRow = buildDeclinedRow(
        entry.toNodeId,
        entry.toUsername,
        theme,
        scrollBoxWidth,
        copyBtnH,
        nameMap?.get(entry.toNodeId)
      );
      declinedRow.y = declinedY;
      declinedSection.addChild(declinedRow);
      declinedY += copyBtnH + 4;
    }
  }

  // -------------------------------------------------------------------------
  // close button (FancyButton — required by Dialog's button API)
  // -------------------------------------------------------------------------

  const closeBtnWidth = scrollBoxWidth;
  const closeBtnHeight = INPUT_HEIGHT;

  const closeBtnBg = new Graphics();
  closeBtnBg.roundRect(0, 0, closeBtnWidth, closeBtnHeight, 4);
  closeBtnBg.fill({ color: 0x0a0a0a });
  closeBtnBg.stroke({ color: 0x1f1f1f, width: 1 });

  const closeBtnText = new Text({
    text: "close",
    style: {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSizeSmall,
      fill: theme.frameHeaderText,
    },
    resolution: theme.textResolution,
  });

  const closeButton = new FancyButton({
    defaultView: closeBtnBg,
    text: closeBtnText,
    padding: 0,
  });

  // -------------------------------------------------------------------------
  // title
  // -------------------------------------------------------------------------

  const titleText = new Text({
    text: "share canvas",
    style: {
      fontFamily: theme.fontFamily,
      fontSize: 16,
      fontWeight: "600",
      fill: theme.frameHeaderText,
    },
    resolution: theme.textResolution,
  });

  // -------------------------------------------------------------------------
  // compute dialog height
  //
  // the Dialog allocates scrollBox height as:
  //   dialogHeight - 2*padding - buttonContainer.height - titleText.height
  //
  // our content needs:
  //   row1 height + elementsMargin + row2 height
  // -------------------------------------------------------------------------

  const rowHeight = titleText.height + LABEL_GAP + INPUT_HEIGHT; // approximate single row
  const peerSectionHeight =
    peerLabel.height + LABEL_GAP + Math.max(1, peerList.length) * (copyBtnH + 4);
  const friendSectionHeight =
    friendLabel.height + LABEL_GAP + Math.max(1, friendList.length) * (copyBtnH + 4);
  const pendingSectionHeight =
    pendingLabel.height + LABEL_GAP + Math.max(1, pendingList.length) * (copyBtnH + 4);
  const declinedSectionHeight =
    declinedLabel.height + LABEL_GAP + Math.max(1, declinedList.length) * (copyBtnH + 4);
  const contentNeeded =
    rowHeight * 2 +
    SECTION_GAP * 5 +
    peerSectionHeight +
    friendSectionHeight +
    pendingSectionHeight +
    declinedSectionHeight;
  const DIALOG_HEIGHT =
    DIALOG_PADDING * 2 + titleText.height + contentNeeded + closeBtnHeight + DIALOG_PADDING;

  // -------------------------------------------------------------------------
  // background panel
  // -------------------------------------------------------------------------

  const panelBg = new Graphics();
  panelBg.roundRect(0, 0, DIALOG_WIDTH, DIALOG_HEIGHT, 8);
  panelBg.fill({ color: 0x141414 });
  panelBg.stroke({ color: 0x2a2a2a, width: 1 });

  // -------------------------------------------------------------------------
  // create the dialog
  // -------------------------------------------------------------------------

  const dialog = new Dialog({
    background: panelBg,
    title: titleText,
    width: DIALOG_WIDTH,
    height: DIALOG_HEIGHT,
    padding: DIALOG_PADDING,
    content: [
      row1.container,
      row2.container,
      peerSection,
      friendSection,
      pendingSection,
      declinedSection,
    ],
    buttons: [closeButton],
    scrollBox: {
      background: 0x141414,
      padding: 0,
      elementsMargin: SECTION_GAP,
      radius: 0,
      type: "vertical",
    },
    closeOnBackdropClick: true,
    backdropColor: 0x000000,
    backdropAlpha: 0.6,
  });

  dialog.zIndex = DIALOG_Z;
  dialog.x = app.screen.width / 2;
  dialog.y = app.screen.height / 2;
  app.stage.addChild(dialog);
  dialog.open();

  // -------------------------------------------------------------------------
  // DOM input overlays — created after dialog is open and positioned
  // -------------------------------------------------------------------------

  // force a transform update so toGlobal() returns correct screen positions
  app.stage.updateTransform({});

  const canvasEl = app.canvas as HTMLCanvasElement;
  const input1 = createReadOnlyInput(row1.placeholder, canvasEl, shareString, theme);
  const input2 = createReadOnlyInput(row2.placeholder, canvasEl, shareUrl, theme);
  domInputs.push(input1, input2);

  // -------------------------------------------------------------------------
  // close / teardown wiring
  // -------------------------------------------------------------------------

  function teardown(): void {
    if (removed) return;
    removed = true;

    window.removeEventListener("keydown", handleKeyDown, true);

    for (const input of domInputs) {
      input.remove();
    }

    app.stage.removeChild(dialog);
    dialog.destroy({ children: true });
    onClose?.();
  }

  // close button — Dialog emits onSelect with the button index
  dialog.onSelect.connect(() => {
    dialog.close();
  });

  // backdrop click — Dialog calls close() internally, which emits onClose
  dialog.onClose.connect(() => {
    teardown();
  });

  // Escape key
  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dialog.close();
    }
  };
  window.addEventListener("keydown", handleKeyDown, true);

  // -------------------------------------------------------------------------
  // handle
  // -------------------------------------------------------------------------

  return {
    remove(): void {
      teardown();
    },
  };
}

// ---------------------------------------------------------------------------
// profile tab — avatar, username, bio, accent color, node ID
// ---------------------------------------------------------------------------

import { Assets, Circle, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { ensureIdentity, getStoredIdentity, onIdentityChange } from "../../../src/p2p/identity";
import { pickImageAsDataUrl } from "../../../src/widgets/image-utils";
import { createSkeinInput, type SkeinInputHandle } from "../../../src/widgets/skein-input";
import {
    ACCENT,
    AVATAR_EXPORT_SIZE,
    AVATAR_RADIUS,
    COLOR_DOT_GAP,
    COLOR_DOT_RADIUS,
    COLOR_PALETTE,
    FIELD_GAP,
    FIELD_HEIGHT,
    FONT,
    LABEL_COLOR,
    LABEL_SIZE,
    MUTED_TEXT,
    RESOLUTION,
} from "./constants";
import type { TabContext, TabController } from "./types";

// ---------------------------------------------------------------------------
// field helper (username / bio)
// ---------------------------------------------------------------------------

interface FieldEntry {
  label: Text;
  handle: SkeinInputHandle;
  profileKey: "username" | "bio";
  layoutAt(x: number, y: number, w: number): void;
}

function createField(
  ctx: TabContext,
  parent: Container,
  labelStr: string,
  profileKey: "username" | "bio",
  placeholder: string,
  currentWidth: number,
): FieldEntry {
  const label = new Text({
    text: labelStr,
    style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
    resolution: RESOLUTION,
  });
  label.eventMode = "none";
  parent.addChild(label);

  const handle = createSkeinInput({
    canvasElement: ctx.canvasElement,
    width: currentWidth,
    height: FIELD_HEIGHT,
    placeholder,
    value: ctx.doc.current.profile[profileKey] || "",
    onChange: (value: string) => {
      ctx.doc.change((draft) => {
        draft.profile[profileKey] = value;
      });
    },
  });
  parent.addChild(handle.input);

  const layoutAt = (x: number, y: number, w: number) => {
    label.x = x;
    label.y = y;
    handle.input.x = x;
    handle.input.y = y + LABEL_SIZE + 4;
    handle.setWidth(w);
  };

  return { label, handle, profileKey, layoutAt };
}

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------

export function createProfileTab(ctx: TabContext): TabController {
  const container = new Container();
  container.eventMode = "static";

  let currentWidth = 0;
  let currentHeight = 0;

  // -------------------------------------------------------------------------
  // avatar area
  // -------------------------------------------------------------------------

  const avatarContainer = new Container();
  avatarContainer.eventMode = "static";
  avatarContainer.cursor = "pointer";
  container.addChild(avatarContainer);

  // placeholder circle (shown when no avatar image is set)
  const avatarPlaceholder = new Graphics();
  avatarPlaceholder.eventMode = "none";
  avatarContainer.addChild(avatarPlaceholder);

  // placeholder text — first letter of username, or "+"
  const avatarInitial = new Text({
    text: "+",
    style: {
      fontFamily: FONT,
      fontSize: 24,
      fontWeight: "bold",
      fill: 0xffffff,
    },
    resolution: RESOLUTION,
  });
  avatarInitial.eventMode = "none";
  avatarInitial.anchor.set(0.5, 0.5);
  avatarContainer.addChild(avatarInitial);

  // sprite for loaded avatar image
  let avatarSprite: Sprite | null = null;
  const avatarMask = new Graphics();
  avatarMask.eventMode = "none";
  avatarContainer.addChild(avatarMask);

  // "tap to change" hint below avatar
  const avatarHint = new Text({
    text: "tap to change",
    style: { fontFamily: FONT, fontSize: 9, fill: MUTED_TEXT },
    resolution: RESOLUTION,
  });
  avatarHint.eventMode = "none";
  avatarHint.visible = false;
  container.addChild(avatarHint);

  avatarContainer.on("pointerover", () => {
    avatarHint.visible = true;
  });
  avatarContainer.on("pointerout", () => {
    avatarHint.visible = false;
  });

  // track avatar center for layout
  let avatarCx = 0;
  let avatarCy = 0;

  const drawAvatarPlaceholder = () => {
    const profile = ctx.doc.current.profile;
    const color = profile.accentColor;

    avatarPlaceholder.clear();
    avatarPlaceholder.circle(avatarCx, avatarCy, AVATAR_RADIUS);
    avatarPlaceholder.fill({ color });

    const initial = profile.username.trim().charAt(0).toUpperCase() || "+";
    avatarInitial.text = initial;
    avatarInitial.x = avatarCx;
    avatarInitial.y = avatarCy;
  };

  const drawAvatarMask = () => {
    avatarMask.clear();
    avatarMask.circle(avatarCx, avatarCy, AVATAR_RADIUS);
    avatarMask.fill({ color: 0xffffff });
  };

  let lastRequestedAvatarUrl = "";
  let loadedAvatarAssetKey = "";

  const updateAvatarSprite = async (dataUrl: string) => {
    lastRequestedAvatarUrl = dataUrl;

    // destroy previous sprite if any
    if (avatarSprite) {
      avatarContainer.removeChild(avatarSprite);
      avatarSprite.destroy();
      avatarSprite = null;
    }
    if (loadedAvatarAssetKey) {
      Assets.unload(loadedAvatarAssetKey);
      loadedAvatarAssetKey = "";
    }

    if (!dataUrl) {
      avatarPlaceholder.visible = true;
      avatarInitial.visible = true;
      return;
    }

    avatarPlaceholder.visible = false;
    avatarInitial.visible = false;

    try {
      const texture = await Assets.load<Texture>(dataUrl);
      // race check — another load may have started while we awaited
      if (lastRequestedAvatarUrl !== dataUrl) return;

      avatarSprite = new Sprite(texture);
      loadedAvatarAssetKey = dataUrl;
      avatarSprite.eventMode = "none";
      avatarSprite.anchor.set(0.5, 0.5);
      avatarSprite.x = avatarCx;
      avatarSprite.y = avatarCy;
      avatarSprite.width = AVATAR_RADIUS * 2;
      avatarSprite.height = AVATAR_RADIUS * 2;
      avatarSprite.mask = avatarMask;
      avatarContainer.addChild(avatarSprite);
    } catch {
      // failed to load — fall back to placeholder
      avatarPlaceholder.visible = true;
      avatarInitial.visible = true;
    }
  };

  const repositionAvatarSprite = () => {
    if (!avatarSprite) return;
    avatarSprite.x = avatarCx;
    avatarSprite.y = avatarCy;
  };

  // -------------------------------------------------------------------------
  // avatar file picker
  // -------------------------------------------------------------------------

  const pickAvatarFile = async () => {
    const dataUrl = await pickImageAsDataUrl({
      maxWidth: AVATAR_EXPORT_SIZE,
      maxHeight: AVATAR_EXPORT_SIZE,
      quality: 0.8,
      cropSquare: true,
    });
    if (dataUrl) {
      ctx.doc.change((d) => {
        d.profile.avatarDataUrl = dataUrl;
      });
      updateAvatarSprite(dataUrl);
    }
  };

  // -------------------------------------------------------------------------
  // text fields
  // -------------------------------------------------------------------------

  const usernameField = createField(ctx, container, "username", "username", "your name...", 200);
  const bioField = createField(ctx, container, "bio", "bio", "about you...", 200);
  const fields: FieldEntry[] = [usernameField, bioField];

  // wire up avatar click (defined after fields so we can blur them)
  avatarContainer.on("pointertap", (e) => {
    e.stopPropagation();
    for (const f of fields) f.handle.blur();
    pickAvatarFile();
  });

  // -------------------------------------------------------------------------
  // accent color picker
  // -------------------------------------------------------------------------

  const colorLabel = new Text({
    text: "accent color",
    style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
    resolution: RESOLUTION,
  });
  colorLabel.eventMode = "none";
  container.addChild(colorLabel);

  const colorContainer = new Container();
  colorContainer.eventMode = "static";
  container.addChild(colorContainer);

  const colorDots: Graphics[] = [];
  const colorRing = new Graphics();
  colorRing.eventMode = "none";
  colorContainer.addChild(colorRing);

  for (let i = 0; i < COLOR_PALETTE.length; i++) {
    const dot = new Graphics();
    dot.eventMode = "static";
    dot.cursor = "pointer";
    dot.circle(0, 0, COLOR_DOT_RADIUS);
    dot.fill({ color: COLOR_PALETTE[i] });
    colorContainer.addChild(dot);
    colorDots.push(dot);

    dot.on("pointertap", (e) => {
      e.stopPropagation();
      for (const f of fields) f.handle.blur();
      ctx.doc.change((draft) => {
        draft.profile.accentColor = COLOR_PALETTE[i];
      });
      drawColorRing();
      // redraw avatar placeholder if visible (color changed)
      if (!ctx.doc.current.profile.avatarDataUrl) {
        drawAvatarPlaceholder();
      }
    });
  }

  let colorRowX = 0;
  let colorRowY = 0;

  const layoutColorDots = (x: number, y: number) => {
    colorRowX = x;
    colorRowY = y;
    for (let i = 0; i < colorDots.length; i++) {
      colorDots[i].x = x + COLOR_DOT_RADIUS + i * (COLOR_DOT_RADIUS * 2 + COLOR_DOT_GAP);
      colorDots[i].y = y + COLOR_DOT_RADIUS;
    }
    drawColorRing();
  };

  const drawColorRing = () => {
    colorRing.clear();
    const selectedColor = ctx.doc.current.profile.accentColor;
    const idx = COLOR_PALETTE.indexOf(selectedColor);
    if (idx === -1) return;
    const cx = colorRowX + COLOR_DOT_RADIUS + idx * (COLOR_DOT_RADIUS * 2 + COLOR_DOT_GAP);
    const cy = colorRowY + COLOR_DOT_RADIUS;
    colorRing.circle(cx, cy, COLOR_DOT_RADIUS + 3);
    colorRing.stroke({ color: 0xffffff, width: 2 });
  };

  // -------------------------------------------------------------------------
  // node id display (read-only)
  // -------------------------------------------------------------------------

  const nodeIdLabel = new Text({
    text: "node id",
    style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
    resolution: RESOLUTION,
  });
  nodeIdLabel.eventMode = "none";
  container.addChild(nodeIdLabel);

  const nodeIdText = new Text({
    text: "",
    style: { fontFamily: "monospace", fontSize: 9, fill: MUTED_TEXT },
    resolution: RESOLUTION,
  });
  nodeIdText.eventMode = "none";
  container.addChild(nodeIdText);

  // copy button
  const copyBtn = new Container();
  copyBtn.eventMode = "static";
  copyBtn.cursor = "pointer";
  const copyBg = new Graphics();
  copyBtn.addChild(copyBg);
  const copyLabel = new Text({
    text: "copy",
    style: { fontFamily: FONT, fontSize: 9, fill: ACCENT },
    resolution: RESOLUTION,
  });
  copyLabel.eventMode = "none";
  copyBtn.addChild(copyLabel);
  container.addChild(copyBtn);

  copyBtn.on("pointertap", (e) => {
    e.stopPropagation();
    const nid = ctx.doc.current.profile.nodeId;
    if (nid) {
      navigator.clipboard.writeText(nid).catch(() => {});
      copyLabel.text = "copied!";
      setTimeout(() => {
        copyLabel.text = "copy";
      }, 5000);
    }
  });

  // generate button — shown when no identity exists yet
  const generateBtn = new Container();
  generateBtn.eventMode = "static";
  generateBtn.cursor = "pointer";
  generateBtn.visible = false;
  const generateBg = new Graphics();
  generateBtn.addChild(generateBg);
  const generateLabel = new Text({
    text: "generate",
    style: { fontFamily: FONT, fontSize: 9, fill: 0x10b981 },
    resolution: RESOLUTION,
  });
  generateLabel.eventMode = "none";
  generateBtn.addChild(generateLabel);
  container.addChild(generateBtn);

  let generating = false;
  generateBtn.on("pointertap", (e) => {
    e.stopPropagation();
    if (generating) return;
    generating = true;
    generateLabel.text = "generating...";
    layout(currentWidth, currentHeight);

    ensureIdentity()
      .then((identity) => {
        syncNodeIdToDoc(identity.node_id);
        layout(currentWidth, currentHeight);
      })
      .catch((err) => {
        console.error("[skein:social:profile] identity generation failed:", err);
        generateLabel.text = "failed";
        setTimeout(() => {
          generateLabel.text = "generate";
        }, 3000);
      })
      .finally(() => {
        generating = false;
      });
  });

  // -------------------------------------------------------------------------
  // layout
  // -------------------------------------------------------------------------

  const layout = (w: number, h: number) => {
    currentWidth = w;
    currentHeight = h;

    const profile = ctx.doc.current.profile;
    let y = 0;

    // avatar — centered horizontally
    avatarCx = w / 2;
    avatarCy = y + AVATAR_RADIUS;

    avatarContainer.hitArea = new Circle(avatarCx, avatarCy, AVATAR_RADIUS);
    drawAvatarMask();

    if (profile.avatarDataUrl && profile.avatarDataUrl !== lastRequestedAvatarUrl) {
      updateAvatarSprite(profile.avatarDataUrl);
    } else if (profile.avatarDataUrl) {
      avatarPlaceholder.visible = false;
      avatarInitial.visible = false;
      repositionAvatarSprite();
    } else {
      drawAvatarPlaceholder();
      if (avatarSprite) {
        avatarContainer.removeChild(avatarSprite);
        avatarSprite.destroy();
        avatarSprite = null;
      }
      if (loadedAvatarAssetKey) {
        Assets.unload(loadedAvatarAssetKey);
        loadedAvatarAssetKey = "";
      }
      avatarPlaceholder.visible = true;
      avatarInitial.visible = true;
    }

    y += AVATAR_RADIUS * 2 + 4;

    // "tap to change" hint
    avatarHint.x = w / 2 - avatarHint.width / 2;
    avatarHint.y = y;
    y += 9 + FIELD_GAP;

    // username field
    usernameField.layoutAt(0, y, w);
    if (!usernameField.handle.isEditing) {
      usernameField.handle.value = profile.username;
    }
    y += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

    // bio field
    bioField.layoutAt(0, y, w);
    if (!bioField.handle.isEditing) {
      bioField.handle.value = profile.bio;
    }
    y += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

    // accent color picker
    colorLabel.x = 0;
    colorLabel.y = y;
    y += LABEL_SIZE + 6;
    layoutColorDots(0, y);

    // node id
    y += COLOR_DOT_RADIUS * 2 + FIELD_GAP;
    nodeIdLabel.x = 0;
    nodeIdLabel.y = y;
    y += LABEL_SIZE + 4;

    const nid = profile.nodeId;
    if (nid.length > 20) {
      nodeIdText.text = nid.slice(0, 8) + "..." + nid.slice(-8);
    } else {
      nodeIdText.text = nid || "(none)";
    }
    nodeIdText.x = 0;
    nodeIdText.y = y;

    // toggle copy vs generate button
    if (nid) {
      copyLabel.text = copyLabel.text === "copied!" ? "copied!" : "copy";
      copyBtn.visible = true;
      generateBtn.visible = false;
    } else {
      copyBtn.visible = false;
      generateBtn.visible = true;
    }

    // position copy button to the right of the node id text
    copyBtn.x = nodeIdText.width + 8;
    copyBtn.y = y;

    // position generate button to the right of the node id text
    generateBtn.x = nodeIdText.width + 8;
    generateBtn.y = y;

    // draw subtle hit-area backgrounds
    copyBg.clear();
    const cbPad = 4;
    copyBg.roundRect(-cbPad, -1, copyLabel.width + cbPad * 2, copyLabel.height + 2, 2);
    copyBg.fill({ color: ACCENT, alpha: 0.1 });

    generateBg.clear();
    const gbPad = 4;
    generateBg.roundRect(-gbPad, -1, generateLabel.width + gbPad * 2, generateLabel.height + 2, 2);
    generateBg.fill({ color: 0x10b981, alpha: 0.15 });
  };

  // -------------------------------------------------------------------------
  // identity sync — load the real iroh node ID from IndexedDB.
  // if one exists, write it into the doc so it displays immediately.
  // if not, the user can click "generate" to create one.
  // -------------------------------------------------------------------------

  let identityUnsub: (() => void) | null = null;

  const syncNodeIdToDoc = (nodeId: string) => {
    if (nodeId && ctx.doc.current.profile.nodeId !== nodeId) {
      ctx.doc.change((d) => {
        d.profile.nodeId = nodeId;
      });
    }
  };

  // check for a persisted identity (cheap IndexedDB read, no midden startup)
  getStoredIdentity()
    .then((identity) => {
      if (identity) {
        syncNodeIdToDoc(identity.node_id);
        layout(currentWidth, currentHeight);
      }
    })
    .catch((err) => {
      console.warn("[skein:social:profile] failed to read stored identity:", err);
    });

  // subscribe to identity changes so the tab updates when the user
  // generates an identity (either from this tab or elsewhere)
  identityUnsub = onIdentityChange((identity) => {
    if (identity) {
      syncNodeIdToDoc(identity.node_id);
    } else {
      // identity was deleted — clear the node ID
      ctx.doc.change((d) => {
        d.profile.nodeId = "";
      });
    }
    layout(currentWidth, currentHeight);
  });

  // subscribe to remote doc changes (automerge sync)
  const docUnsub = ctx.doc.on("change", () => {
    const profile = ctx.doc.current.profile;
    if (profile.avatarDataUrl && profile.avatarDataUrl !== lastRequestedAvatarUrl) {
      updateAvatarSprite(profile.avatarDataUrl);
    }
    layout(currentWidth, currentHeight);
  });

  // -------------------------------------------------------------------------
  // tab controller
  // -------------------------------------------------------------------------

  return {
    container,

    layout(width: number, height: number) {
      layout(width, height);
    },

    destroy() {
      for (const f of fields) f.handle.destroy();
      docUnsub();
      if (identityUnsub) identityUnsub();
      if (avatarSprite) {
        avatarContainer.removeChild(avatarSprite);
        avatarSprite.mask = null;
        avatarSprite.destroy();
        avatarSprite = null;
      }
      if (loadedAvatarAssetKey) {
        Assets.unload(loadedAvatarAssetKey);
        loadedAvatarAssetKey = "";
      }
      container.destroy({ children: true });
    },
  };
}

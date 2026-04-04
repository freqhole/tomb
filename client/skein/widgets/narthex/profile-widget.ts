import { Assets, Circle, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { z } from "zod";
import { pickImageAsDataUrl } from "../../src/widgets/image-utils";
import { createSkeinInput, type SkeinInputHandle } from "../../src/widgets/skein-input";
import type {
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../../src/widgets/widget-types";

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  username: z.string().default(""),
  bio: z.string().default(""),
  avatarDataUrl: z.string().default(""),
  accentColor: z.number().default(0x6366f1),
  nodeId: z.string().default(""),
});

export type ProfileState = z.infer<typeof profileSchema>;

// ---------------------------------------------------------------------------
// visual constants
// ---------------------------------------------------------------------------

const BG = 0x1a1a24;
const BORDER = 0x2a2a3e;
const LABEL_COLOR = 0x888898;
const TEXT_COLOR = 0xf0f0ff;
const MUTED_TEXT = 0x666678;

const COLOR_PALETTE = [
  0xd946ef, 0x6366f1, 0x06b6d4, 0x10b981, 0xeab308, 0xf97316, 0xef4444, 0x8b5cf6,
];

const CARD_RADIUS = 6;
const PADDING_X = 16;
const PADDING_Y = 14;
const FIELD_HEIGHT = 28;
const LABEL_SIZE = 10;
const HEADER_SIZE = 14;
const FIELD_GAP = 10;
const COLOR_DOT_RADIUS = 7;
const COLOR_DOT_GAP = 4;
const FONT = "system-ui, sans-serif";
const RESOLUTION = 3;

const AVATAR_RADIUS = 36;
const AVATAR_EXPORT_SIZE = 100;

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------

export const profileWidget: WidgetFactory<typeof profileSchema> = {
  type: "profile",
  metadata: {
    name: "profile",
    description: "set up your local identity — username, bio, and avatar",
    version: "0.1.0",
    category: "narthex",
    singleton: true,
    singletonId: "skein-profile",
    defaultWidth: 280,
    defaultHeight: 420,
  },
  schema: profileSchema,
  editableProps: [], // the widget IS the editor

  create(ctx: WidgetMountContext<typeof profileSchema>): WidgetController {
    const container = new Container();
    container.eventMode = "static";

    let currentWidth = ctx.width;
    let currentHeight = ctx.height;

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
      text: "profile",
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
    // avatar area
    // ---------------------------------------------------------------------------

    const avatarContainer = new Container();
    avatarContainer.eventMode = "static";
    avatarContainer.cursor = "pointer";
    container.addChild(avatarContainer);

    // placeholder circle (shown when no avatar is set)
    const avatarPlaceholder = new Graphics();
    avatarPlaceholder.eventMode = "none";
    avatarContainer.addChild(avatarPlaceholder);

    // placeholder text — shows initial or "+" icon
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
      style: {
        fontFamily: FONT,
        fontSize: 9,
        fill: MUTED_TEXT,
      },
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
      const state = ctx.doc.current;
      const color = state.accentColor;

      avatarPlaceholder.clear();
      avatarPlaceholder.circle(avatarCx, avatarCy, AVATAR_RADIUS);
      avatarPlaceholder.fill({ color });

      // show first letter of username, or "+" if empty
      const initial = state.username.trim().charAt(0).toUpperCase() || "+";
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

    const updateAvatarSprite = async (dataUrl: string) => {
      lastRequestedAvatarUrl = dataUrl;

      // destroy previous sprite if any
      if (avatarSprite) {
        avatarContainer.removeChild(avatarSprite);
        avatarSprite.destroy();
        avatarSprite = null;
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
        // race check
        if (lastRequestedAvatarUrl !== dataUrl) return;

        avatarSprite = new Sprite(texture);
        avatarSprite.eventMode = "none";
        avatarSprite.anchor.set(0.5, 0.5);
        avatarSprite.x = avatarCx;
        avatarSprite.y = avatarCy;
        avatarSprite.width = AVATAR_RADIUS * 2;
        avatarSprite.height = AVATAR_RADIUS * 2;
        avatarSprite.mask = avatarMask;
        avatarContainer.addChild(avatarSprite);
      } catch {
        // failed to load — show placeholder instead
        avatarPlaceholder.visible = true;
        avatarInitial.visible = true;
      }
    };

    const repositionAvatarSprite = () => {
      if (!avatarSprite) return;
      avatarSprite.x = avatarCx;
      avatarSprite.y = avatarCy;
    };

    // ---------------------------------------------------------------------------
    // avatar file picker
    // ---------------------------------------------------------------------------

    const pickAvatarFile = async () => {
      const dataUrl = await pickImageAsDataUrl({
        maxWidth: AVATAR_EXPORT_SIZE,
        maxHeight: AVATAR_EXPORT_SIZE,
        quality: 0.8,
        cropSquare: true,
      });
      if (dataUrl) {
        ctx.doc.change((d) => {
          d.avatarDataUrl = dataUrl;
        });
        updateAvatarSprite(dataUrl);
      }
    };

    // ---------------------------------------------------------------------------
    // text fields using SkeinInput
    // ---------------------------------------------------------------------------

    interface FieldEntry {
      label: Text;
      handle: SkeinInputHandle;
      docKey: "username" | "bio";
      layoutAt: (x: number, y: number, w: number) => void;
    }

    function createField(
      labelStr: string,
      docKey: "username" | "bio",
      placeholder: string
    ): FieldEntry {
      const label = new Text({
        text: labelStr,
        style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
        resolution: RESOLUTION,
      });
      label.eventMode = "none";
      container.addChild(label);

      const handle = createSkeinInput({
        width: currentWidth - PADDING_X * 2,
        height: FIELD_HEIGHT,
        placeholder,
        value: ctx.doc.current[docKey] || "",
        onChange: (value: string) => {
          ctx.doc.change((draft) => {
            (draft as Record<string, unknown>)[docKey] = value;
          });
        },
      });

      container.addChild(handle.input);

      const layoutAt = (x: number, y: number, w: number) => {
        label.x = x;
        label.y = y;
        handle.input.x = x;
        handle.input.y = y + LABEL_SIZE + 4;
        handle.setWidth(w);
      };

      return { label, handle, docKey, layoutAt };
    }

    const usernameField = createField("username", "username", "your name...");
    const bioField = createField("bio", "bio", "about you...");

    const fields = [usernameField, bioField];

    // ---------------------------------------------------------------------------
    // avatar pointertap (defined after fields so blur works)
    // ---------------------------------------------------------------------------

    avatarContainer.on("pointertap", (e) => {
      e.stopPropagation();
      for (const f of fields) f.handle.blur();
      pickAvatarFile();
    });

    // ---------------------------------------------------------------------------
    // accent color picker
    // ---------------------------------------------------------------------------

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

    // selection ring and dots
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
          draft.accentColor = COLOR_PALETTE[i];
        });
        drawColorRing();
        // redraw avatar placeholder if visible (color changed)
        if (!ctx.doc.current.avatarDataUrl) {
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
      const selectedColor = ctx.doc.current.accentColor;
      const idx = COLOR_PALETTE.indexOf(selectedColor);
      if (idx === -1) return;
      const cx = colorRowX + COLOR_DOT_RADIUS + idx * (COLOR_DOT_RADIUS * 2 + COLOR_DOT_GAP);
      const cy = colorRowY + COLOR_DOT_RADIUS;
      colorRing.circle(cx, cy, COLOR_DOT_RADIUS + 3);
      colorRing.stroke({ color: 0xffffff, width: 2 });
    };

    // ---------------------------------------------------------------------------
    // node id display (read-only)
    // ---------------------------------------------------------------------------

    const nodeIdLabel = new Text({
      text: "node id",
      style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
      resolution: RESOLUTION,
    });
    nodeIdLabel.eventMode = "none";
    container.addChild(nodeIdLabel);

    const nodeIdText = new Text({
      text: "",
      style: {
        fontFamily: "monospace",
        fontSize: 9,
        fill: MUTED_TEXT,
      },
      resolution: RESOLUTION,
    });
    nodeIdText.eventMode = "none";
    container.addChild(nodeIdText);

    // copy button — small "copy" text button next to the node id
    const copyBtn = new Container();
    copyBtn.eventMode = "static";
    copyBtn.cursor = "pointer";
    const copyBg = new Graphics();
    copyBtn.addChild(copyBg);
    const copyText = new Text({
      text: "copy",
      style: {
        fontFamily: FONT,
        fontSize: 9,
        fill: 0x6366f1,
      },
      resolution: RESOLUTION,
    });
    copyText.eventMode = "none";
    copyBtn.addChild(copyText);
    container.addChild(copyBtn);

    copyBtn.on("pointertap", (e) => {
      e.stopPropagation();
      const nid = ctx.doc.current.nodeId;
      if (nid) {
        navigator.clipboard.writeText(nid).catch(() => {});
        // brief visual feedback
        copyText.text = "copied!";
        setTimeout(() => {
          copyText.text = "copy";
        }, 5000);
      }
    });

    // ---------------------------------------------------------------------------
    // layout
    // ---------------------------------------------------------------------------

    const layout = (w: number, h: number) => {
      const state = ctx.doc.current;
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
      y += 10;

      // avatar — centered horizontally
      avatarCx = w / 2;
      avatarCy = y + AVATAR_RADIUS;

      // update hit area for avatar interaction (children are all eventMode="none"
      // so the container needs an explicit hit area for pointer events)
      avatarContainer.hitArea = new Circle(avatarCx, avatarCy, AVATAR_RADIUS);

      drawAvatarMask();

      if (state.avatarDataUrl && state.avatarDataUrl !== lastRequestedAvatarUrl) {
        updateAvatarSprite(state.avatarDataUrl);
      } else if (state.avatarDataUrl) {
        avatarPlaceholder.visible = false;
        avatarInitial.visible = false;
        repositionAvatarSprite();
      } else if (!state.avatarDataUrl) {
        drawAvatarPlaceholder();
        if (avatarSprite) {
          avatarContainer.removeChild(avatarSprite);
          avatarSprite.destroy();
          avatarSprite = null;
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
      usernameField.layoutAt(PADDING_X, y, contentW);
      if (!(usernameField.handle as any).input?.editing) {
        usernameField.handle.value = state.username;
      }
      y += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

      // bio field
      bioField.layoutAt(PADDING_X, y, contentW);
      if (!(bioField.handle as any).input?.editing) {
        bioField.handle.value = state.bio;
      }
      y += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

      // accent color picker
      colorLabel.x = PADDING_X;
      colorLabel.y = y;
      y += LABEL_SIZE + 6;
      layoutColorDots(PADDING_X, y);

      // node id (read-only)
      y += COLOR_DOT_RADIUS * 2 + FIELD_GAP;
      nodeIdLabel.x = PADDING_X;
      nodeIdLabel.y = y;
      y += LABEL_SIZE + 4;

      const nid = state.nodeId;
      // truncate to fit — show first 8 and last 8 chars with "..." in the middle
      if (nid.length > 20) {
        nodeIdText.text = nid.slice(0, 8) + "..." + nid.slice(-8);
      } else {
        nodeIdText.text = nid || "(generating...)";
      }
      nodeIdText.x = PADDING_X;
      nodeIdText.y = y;

      // position copy button to the right of the node id text
      copyBtn.x = PADDING_X + nodeIdText.width + 8;
      copyBtn.y = y;

      // draw a subtle background for the copy button hit area
      copyBg.clear();
      const cbPad = 4;
      copyBg.roundRect(-cbPad, -1, copyText.width + cbPad * 2, copyText.height + 2, 2);
      copyBg.fill({ color: 0x6366f1, alpha: 0.1 });
    };

    // generate a node ID on first mount if none exists
    const initialState = ctx.doc.current;
    if (!initialState.nodeId) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const nodeId = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      ctx.doc.change((d) => {
        d.nodeId = nodeId;
      });
    }

    // initial draw
    layout(currentWidth, currentHeight);

    // subscribe to remote doc changes (automerge sync)
    const unsub = ctx.doc.on("change", () => {
      // check if avatar data url changed — need to rebuild sprite
      const state = ctx.doc.current;
      if (state.avatarDataUrl && state.avatarDataUrl !== lastRequestedAvatarUrl) {
        updateAvatarSprite(state.avatarDataUrl);
      }
      layout(currentWidth, currentHeight);
    });

    // ---------------------------------------------------------------------------
    // controller
    // ---------------------------------------------------------------------------

    return {
      container,

      destroy() {
        for (const f of fields) f.handle.destroy();
        unsub();
        if (avatarSprite) {
          avatarSprite.destroy();
          avatarSprite = null;
        }
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

import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { z } from "zod";
import type { KeyboardHandler } from "../../src/widgets/keyboard-driver";
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
});

export type ProfileState = z.infer<typeof profileSchema>;

// ---------------------------------------------------------------------------
// visual constants
// ---------------------------------------------------------------------------

const BG = 0x1a1a24;
const BORDER = 0x2a2a3e;
const FIELD_BG = 0x12121a;
const FIELD_BORDER = 0x333348;
const FIELD_BORDER_ACTIVE = 0x6366f1;
const LABEL_COLOR = 0x888898;
const TEXT_COLOR = 0xf0f0ff;
const MUTED_TEXT = 0x666678;

const COLOR_PALETTE = [
  0xd946ef, 0x6366f1, 0x06b6d4, 0x10b981, 0xeab308, 0xf97316, 0xef4444, 0x8b5cf6,
];

const CARD_RADIUS = 6;
const FIELD_RADIUS = 4;
const PADDING_X = 16;
const PADDING_Y = 14;
const FIELD_HEIGHT = 28;
const LABEL_SIZE = 10;
const TEXT_SIZE = 12;
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
    name: "my profile",
    description: "set up your local identity — username, bio, and avatar",
    version: "0.1.0",
    category: "narthex",
    hidden: true,
    defaultWidth: 280,
    defaultHeight: 360,
  },
  schema: profileSchema,
  editableProps: [], // the widget IS the editor

  create(ctx: WidgetMountContext<typeof profileSchema>): WidgetController {
    const container = new Container();
    container.eventMode = "static";

    let currentWidth = ctx.width;
    let currentHeight = ctx.height;

    // track the currently-active field's stop-editing closure
    let activeStopEditing: (() => void) | null = null;

    // ordered list of field stop/start helpers for tab navigation
    const fieldStarters: (() => void)[] = [];

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
      text: "my profile",
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
    container.addChild(avatarHint);

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

    const updateAvatarSprite = (dataUrl: string) => {
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

      const texture = Texture.from(dataUrl);
      avatarSprite = new Sprite(texture);
      avatarSprite.eventMode = "none";
      avatarSprite.anchor.set(0.5, 0.5);
      avatarSprite.x = avatarCx;
      avatarSprite.y = avatarCy;
      avatarSprite.width = AVATAR_RADIUS * 2;
      avatarSprite.height = AVATAR_RADIUS * 2;
      avatarSprite.mask = avatarMask;
      avatarContainer.addChild(avatarSprite);
    };

    const repositionAvatarSprite = () => {
      if (!avatarSprite) return;
      avatarSprite.x = avatarCx;
      avatarSprite.y = avatarCy;
    };

    // ---------------------------------------------------------------------------
    // avatar file picker
    // ---------------------------------------------------------------------------

    const pickAvatarFile = () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.style.display = "none";
      document.body.appendChild(input);

      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) {
          input.remove();
          return;
        }

        try {
          const bitmap = await createImageBitmap(file);

          // center-crop to a square using the minimum dimension
          const minDim = Math.min(bitmap.width, bitmap.height);
          const sx = (bitmap.width - minDim) / 2;
          const sy = (bitmap.height - minDim) / 2;

          const offscreen = new OffscreenCanvas(AVATAR_EXPORT_SIZE, AVATAR_EXPORT_SIZE);
          const offCtx = offscreen.getContext("2d")!;
          offCtx.drawImage(
            bitmap,
            sx,
            sy,
            minDim,
            minDim,
            0,
            0,
            AVATAR_EXPORT_SIZE,
            AVATAR_EXPORT_SIZE
          );
          bitmap.close();

          const blob = await offscreen.convertToBlob({ type: "image/webp", quality: 0.8 });

          // convert blob to data url via FileReader
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });

          ctx.doc.change((d) => {
            d.avatarDataUrl = dataUrl;
          });

          updateAvatarSprite(dataUrl);
        } catch {
          // silently ignore — user may have cancelled or file was unreadable
        } finally {
          input.remove();
        }
      });

      input.click();
    };

    avatarContainer.on("pointertap", (e) => {
      e.stopPropagation();
      activeStopEditing?.();
      pickAvatarFile();
    });

    // ---------------------------------------------------------------------------
    // text field builder (same pattern as canvas-wizard)
    // ---------------------------------------------------------------------------

    interface FieldGroup {
      label: Text;
      fieldBg: Graphics;
      fieldText: Text;
      fieldMask: Graphics;
      startEditing: () => void;
      stopEditing: () => void;
      layoutAt: (x: number, y: number, w: number) => void;
      isEditing: () => boolean;
    }

    function createTextField(
      labelStr: string,
      docKey: "username" | "bio",
      fieldIndex: number
    ): FieldGroup {
      let editing = false;

      const label = new Text({
        text: labelStr,
        style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
        resolution: RESOLUTION,
      });
      label.eventMode = "none";
      container.addChild(label);

      const fieldBg = new Graphics();
      fieldBg.eventMode = "static";
      fieldBg.cursor = "text";
      container.addChild(fieldBg);

      const fieldMask = new Graphics();
      container.addChild(fieldMask);

      const fieldText = new Text({
        text: ctx.doc.current[docKey] || "",
        style: { fontFamily: FONT, fontSize: TEXT_SIZE, fill: TEXT_COLOR },
        resolution: RESOLUTION,
      });
      fieldText.eventMode = "none";
      fieldText.mask = fieldMask;
      container.addChild(fieldText);

      let fieldX = 0;
      let fieldY = 0;
      let fieldW = 100;

      const drawFieldBg = () => {
        const borderColor = editing ? FIELD_BORDER_ACTIVE : FIELD_BORDER;
        fieldBg.clear();
        fieldBg.roundRect(fieldX, fieldY, fieldW, FIELD_HEIGHT, FIELD_RADIUS);
        fieldBg.fill({ color: FIELD_BG });
        fieldBg.stroke({ color: borderColor, width: 1 });
      };

      const drawFieldMask = () => {
        fieldMask.clear();
        fieldMask.rect(fieldX + 6, fieldY, fieldW - 12, FIELD_HEIGHT);
        fieldMask.fill({ color: 0xffffff });
      };

      const stopEditing = () => {
        if (!editing) return;
        editing = false;
        if (activeStopEditing === stopEditing) {
          activeStopEditing = null;
        }
        ctx.keyboard.release();
        drawFieldBg();
      };

      const startEditing = () => {
        if (editing) return;
        // stop any other active field first
        activeStopEditing?.();

        editing = true;
        activeStopEditing = stopEditing;
        drawFieldBg();

        const handler: KeyboardHandler = {
          onInput(value: string) {
            fieldText.text = value;
            ctx.doc.change((draft) => {
              (draft as Record<string, unknown>)[docKey] = value;
            });
          },
          onKeyDown(event: KeyboardEvent) {
            if (event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
              stopEditing();
            } else if (event.key === "Tab") {
              event.preventDefault();
              stopEditing();
              // move to next field
              const nextIndex =
                (fieldIndex + (event.shiftKey ? -1 : 1) + fieldStarters.length) %
                fieldStarters.length;
              fieldStarters[nextIndex]();
            }
          },
          onBlur() {
            stopEditing();
          },
        };

        ctx.keyboard.acquire(handler, ctx.doc.current[docKey]);
      };

      fieldBg.on("pointertap", (e) => {
        e.stopPropagation();
        startEditing();
      });

      const layoutAt = (x: number, y: number, w: number) => {
        label.x = x;
        label.y = y;
        fieldX = x;
        fieldY = y + LABEL_SIZE + 4;
        fieldW = w;
        drawFieldBg();
        drawFieldMask();
        fieldText.x = fieldX + 8;
        fieldText.y = fieldY + (FIELD_HEIGHT - TEXT_SIZE) / 2;
      };

      return {
        label,
        fieldBg,
        fieldText,
        fieldMask,
        startEditing,
        stopEditing,
        layoutAt,
        isEditing: () => editing,
      };
    }

    const usernameField = createTextField("username", "username", 0);
    const bioField = createTextField("bio", "bio", 1);

    fieldStarters.push(usernameField.startEditing, bioField.startEditing);

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
        activeStopEditing?.();
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

      drawAvatarMask();

      if (state.avatarDataUrl) {
        avatarPlaceholder.visible = false;
        avatarInitial.visible = false;
        // only create sprite if we don't have one yet or the data url changed
        if (!avatarSprite) {
          updateAvatarSprite(state.avatarDataUrl);
        } else {
          repositionAvatarSprite();
        }
      } else {
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
      if (!usernameField.isEditing()) usernameField.fieldText.text = state.username;
      y += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

      // bio field
      bioField.layoutAt(PADDING_X, y, contentW);
      if (!bioField.isEditing()) bioField.fieldText.text = state.bio;
      y += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

      // accent color picker
      colorLabel.x = PADDING_X;
      colorLabel.y = y;
      y += LABEL_SIZE + 6;
      layoutColorDots(PADDING_X, y);
    };

    // initial draw
    layout(currentWidth, currentHeight);

    // subscribe to remote doc changes (automerge sync)
    const unsub = ctx.doc.on("change", () => {
      // check if avatar data url changed — need to rebuild sprite
      const state = ctx.doc.current;
      const currentDataUrl = avatarSprite ? state.avatarDataUrl : "";
      if (state.avatarDataUrl && state.avatarDataUrl !== currentDataUrl) {
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
        activeStopEditing?.();
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

import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
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

export const canvasWizardSchema = z.object({
  title: z.string().default("untitled canvas"),
  description: z.string().default(""),
  color: z.number().default(0xd946ef),
  previewUrl: z.string().default(""),
});

export type CanvasWizardState = z.infer<typeof canvasWizardSchema>;

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
const COLOR_DOT_RADIUS = 7;
const COLOR_DOT_GAP = 4;
const BUTTON_HEIGHT = 30;
const BUTTON_GAP = 8;
const FONT = "system-ui, sans-serif";
const RESOLUTION = 3;

const PREVIEW_HEIGHT = 80;
const PREVIEW_BG = 0x12121a;
const PREVIEW_BORDER = 0x333348;
const PREVIEW_RADIUS = 4;

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------

export const canvasWizardWidget: WidgetFactory<typeof canvasWizardSchema> = {
  type: "canvas-wizard",
  metadata: {
    name: "new canvas",
    description: "create a new canvas with title, description, and color",
    version: "0.1.0",
    category: "narthex",

    defaultWidth: 320,
    defaultHeight: 340,
  },
  schema: canvasWizardSchema,
  // no editableProps — the wizard IS the editor

  create(ctx: WidgetMountContext<typeof canvasWizardSchema>): WidgetController {
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
      text: "new canvas",
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
    // text fields using SkeinInput
    // ---------------------------------------------------------------------------

    interface FieldEntry {
      label: Text;
      handle: SkeinInputHandle;
      docKey: "title" | "description";
      layoutAt: (x: number, y: number, w: number) => void;
    }

    function createField(
      labelStr: string,
      docKey: "title" | "description",
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
        canvasElement: ctx.canvasElement,
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

    const titleField = createField("title", "title", "canvas title...");
    const descField = createField("description", "description", "short description...");

    const fields = [titleField, descField];

    // ---------------------------------------------------------------------------
    // color picker
    // ---------------------------------------------------------------------------

    const colorLabel = new Text({
      text: "color",
      style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
      resolution: RESOLUTION,
    });
    colorLabel.eventMode = "none";
    container.addChild(colorLabel);

    const colorContainer = new Container();
    colorContainer.eventMode = "static";
    container.addChild(colorContainer);

    // we keep references to each dot and selection ring so we can redraw
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
        ctx.doc.change((draft) => {
          draft.color = COLOR_PALETTE[i];
        });
        drawColorRing();
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
      const selectedColor = ctx.doc.current.color;
      const idx = COLOR_PALETTE.indexOf(selectedColor);
      if (idx === -1) return;
      const cx = colorRowX + COLOR_DOT_RADIUS + idx * (COLOR_DOT_RADIUS * 2 + COLOR_DOT_GAP);
      const cy = colorRowY + COLOR_DOT_RADIUS;
      colorRing.circle(cx, cy, COLOR_DOT_RADIUS + 3);
      colorRing.stroke({ color: 0xffffff, width: 2 });
    };

    // ---------------------------------------------------------------------------
    // image preview upload
    // ---------------------------------------------------------------------------

    const previewLabel = new Text({
      text: "preview image",
      style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
      resolution: RESOLUTION,
    });
    previewLabel.eventMode = "none";
    container.addChild(previewLabel);

    const previewArea = new Container();
    previewArea.eventMode = "static";
    container.addChild(previewArea);

    const previewBg = new Graphics();
    previewArea.addChild(previewBg);

    let previewSprite: Sprite | null = null;
    let loadedPreviewAssetKey = "";

    const uploadBtn = new Container();
    uploadBtn.eventMode = "static";
    uploadBtn.cursor = "pointer";
    const uploadBg = new Graphics();
    uploadBtn.addChild(uploadBg);
    const uploadText = new Text({
      text: "upload",
      style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: TEXT_COLOR },
      resolution: RESOLUTION,
    });
    uploadText.eventMode = "none";
    uploadBtn.addChild(uploadText);
    previewArea.addChild(uploadBtn);

    const clearImgBtn = new Container();
    clearImgBtn.eventMode = "static";
    clearImgBtn.cursor = "pointer";
    const clearImgBg = new Graphics();
    clearImgBtn.addChild(clearImgBg);
    const clearImgText = new Text({
      text: "clear",
      style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: MUTED_TEXT },
      resolution: RESOLUTION,
    });
    clearImgText.eventMode = "none";
    clearImgBtn.addChild(clearImgText);
    previewArea.addChild(clearImgBtn);

    const updatePreviewSprite = async (dataUrl: string) => {
      // clean up existing
      if (previewSprite) {
        previewArea.removeChild(previewSprite);
        previewSprite.destroy();
        previewSprite = null;
      }
      if (loadedPreviewAssetKey) {
        Assets.unload(loadedPreviewAssetKey);
        loadedPreviewAssetKey = "";
      }

      if (!dataUrl) return;

      try {
        const texture = await Assets.load<Texture>(dataUrl);
        previewSprite = new Sprite(texture);
        loadedPreviewAssetKey = dataUrl;
        previewSprite.eventMode = "none";

        // fit within the preview thumbnail area
        const maxW = PREVIEW_HEIGHT;
        const maxH = PREVIEW_HEIGHT;
        const scale = Math.min(maxW / texture.width, maxH / texture.height);
        previewSprite.width = texture.width * scale;
        previewSprite.height = texture.height * scale;
        previewSprite.x = 0;
        previewSprite.y = 0;

        previewArea.addChildAt(previewSprite, 1); // after bg, before buttons
      } catch {
        // silently ignore load failures
      }
    };

    uploadBtn.on("pointertap", async (e: any) => {
      e.stopPropagation();
      for (const f of fields) f.handle.blur();
      const dataUrl = await pickImageAsDataUrl({
        maxWidth: 320,
        maxHeight: 200,
        quality: 0.8,
      });
      if (dataUrl) {
        ctx.doc.change((draft) => {
          draft.previewUrl = dataUrl;
        });
        await updatePreviewSprite(dataUrl);
        layout(currentWidth, currentHeight);
      }
    });

    clearImgBtn.on("pointertap", (e: any) => {
      e.stopPropagation();
      ctx.doc.change((draft) => {
        draft.previewUrl = "";
      });
      updatePreviewSprite("");
      layout(currentWidth, currentHeight);
    });

    // ---------------------------------------------------------------------------
    // buttons
    // ---------------------------------------------------------------------------

    const cancelBtn = new Container();
    cancelBtn.eventMode = "static";
    cancelBtn.cursor = "pointer";

    const cancelBg = new Graphics();
    cancelBtn.addChild(cancelBg);

    const cancelText = new Text({
      text: "cancel",
      style: { fontFamily: FONT, fontSize: TEXT_SIZE, fill: MUTED_TEXT },
      resolution: RESOLUTION,
    });
    cancelText.eventMode = "none";
    cancelBtn.addChild(cancelText);
    container.addChild(cancelBtn);

    cancelBtn.on("pointertap", (e) => {
      e.stopPropagation();
      // blur any active input
      for (const f of fields) f.handle.blur();
      window.dispatchEvent(
        new CustomEvent("skein:remove-widget", {
          detail: { widgetId: ctx.widgetId },
        })
      );
    });

    const createBtn = new Container();
    createBtn.eventMode = "static";
    createBtn.cursor = "pointer";

    const createBg = new Graphics();
    createBtn.addChild(createBg);

    const createText = new Text({
      text: "create",
      style: { fontFamily: FONT, fontSize: TEXT_SIZE, fontWeight: "bold", fill: 0xffffff },
      resolution: RESOLUTION,
    });
    createText.eventMode = "none";
    createBtn.addChild(createText);
    container.addChild(createBtn);

    createBtn.on("pointertap", (e) => {
      e.stopPropagation();
      // blur any active input
      for (const f of fields) f.handle.blur();
      const state = ctx.doc.current;
      window.dispatchEvent(
        new CustomEvent("skein:create-canvas", {
          detail: {
            title: state.title,
            description: state.description,
            color: state.color,
            previewUrl: state.previewUrl,
            wizardWidgetId: ctx.widgetId,
          },
        })
      );
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

      // title field
      titleField.layoutAt(PADDING_X, y, contentW);
      // sync display value from doc if the field is not actively being edited
      if (!(titleField.handle as any).input?.editing) {
        titleField.handle.value = state.title;
      }
      y += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

      // description field
      descField.layoutAt(PADDING_X, y, contentW);
      if (!(descField.handle as any).input?.editing) {
        descField.handle.value = state.description;
      }
      y += LABEL_SIZE + 4 + FIELD_HEIGHT + FIELD_GAP;

      // color picker
      colorLabel.x = PADDING_X;
      colorLabel.y = y;
      y += LABEL_SIZE + 6;
      layoutColorDots(PADDING_X, y);
      y += COLOR_DOT_RADIUS * 2 + FIELD_GAP;

      // preview image upload
      previewLabel.x = PADDING_X;
      previewLabel.y = y;
      y += LABEL_SIZE + 4;

      const hasPreview = !!state.previewUrl;
      const thumbW = hasPreview ? PREVIEW_HEIGHT : 0;
      const btnPad = 6;
      const btnH = 22;
      const uploadBtnW = uploadText.width + 12;
      const clearBtnW = clearImgText.width + 12;

      previewArea.x = PADDING_X;
      previewArea.y = y;

      // draw preview thumbnail bg
      previewBg.clear();
      if (hasPreview) {
        previewBg.roundRect(0, 0, PREVIEW_HEIGHT, PREVIEW_HEIGHT, PREVIEW_RADIUS);
        previewBg.fill({ color: PREVIEW_BG });
        previewBg.stroke({ color: PREVIEW_BORDER, width: 1 });
      }

      // position upload button
      const btnX = hasPreview ? thumbW + btnPad : 0;
      uploadBg.clear();
      uploadBg.roundRect(0, 0, uploadBtnW, btnH, PREVIEW_RADIUS);
      uploadBg.fill({ color: FIELD_BG });
      uploadBg.stroke({ color: FIELD_BORDER, width: 1 });
      uploadBtn.x = btnX;
      uploadBtn.y = hasPreview ? (PREVIEW_HEIGHT - btnH) / 2 : 0;
      uploadText.x = 6;
      uploadText.y = (btnH - LABEL_SIZE) / 2;

      // position clear button
      clearImgBg.clear();
      clearImgBg.roundRect(0, 0, clearBtnW, btnH, PREVIEW_RADIUS);
      clearImgBg.fill({ color: FIELD_BG });
      clearImgBg.stroke({ color: FIELD_BORDER, width: 1 });
      clearImgBtn.x = btnX + uploadBtnW + 4;
      clearImgBtn.y = uploadBtn.y;
      clearImgText.x = 6;
      clearImgText.y = (btnH - LABEL_SIZE) / 2;
      clearImgBtn.visible = hasPreview;

      y += (hasPreview ? PREVIEW_HEIGHT : btnH) + FIELD_GAP;

      // buttons — anchored to the bottom of the card
      const buttonY = h - PADDING_Y - BUTTON_HEIGHT;
      const buttonW = (contentW - BUTTON_GAP) / 2;

      // cancel button
      cancelBg.clear();
      cancelBg.roundRect(0, 0, buttonW, BUTTON_HEIGHT, BUTTON_RADIUS);
      cancelBg.fill({ color: FIELD_BG });
      cancelBg.stroke({ color: FIELD_BORDER, width: 1 });
      cancelBtn.x = PADDING_X;
      cancelBtn.y = buttonY;
      cancelText.x = (buttonW - cancelText.width) / 2;
      cancelText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;

      // create button
      createBg.clear();
      createBg.roundRect(0, 0, buttonW, BUTTON_HEIGHT, BUTTON_RADIUS);
      createBg.fill({ color: ACCENT });
      createBtn.x = PADDING_X + buttonW + BUTTON_GAP;
      createBtn.y = buttonY;
      createText.x = (buttonW - createText.width) / 2;
      createText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;
    };

    // initial draw
    layout(currentWidth, currentHeight);

    // subscribe to remote doc changes (automerge sync)
    const unsub = ctx.doc.on("change", () => {
      const state = ctx.doc.current;
      layout(currentWidth, currentHeight);
      // update preview sprite if URL changed externally
      const currentUrl = loadedPreviewAssetKey;
      if (state.previewUrl !== currentUrl) {
        updatePreviewSprite(state.previewUrl);
      }
    });

    // ---------------------------------------------------------------------------
    // controller
    // ---------------------------------------------------------------------------

    return {
      container,

      destroy() {
        for (const f of fields) f.handle.destroy();
        if (previewSprite) {
          previewSprite.destroy();
        }
        if (loadedPreviewAssetKey) {
          Assets.unload(loadedPreviewAssetKey);
        }
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

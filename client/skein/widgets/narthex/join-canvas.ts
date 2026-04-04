import { Container, Graphics, Text } from "pixi.js";
import { z } from "zod";
import { decodeShareString } from "../../src/p2p/share-string";
import { createSkeinInput } from "../../src/widgets/skein-input";
import type {
  WidgetController,
  WidgetFactory,
  WidgetMountContext,
} from "../../src/widgets/widget-types";

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

export const joinCanvasSchema = z.object({
  shareString: z.string().default(""),
});

export type JoinCanvasState = z.infer<typeof joinCanvasSchema>;

// ---------------------------------------------------------------------------
// visual constants (matches canvas-wizard)
// ---------------------------------------------------------------------------

const BG = 0x1a1a24;
const BORDER = 0x2a2a3e;
const FIELD_BG = 0x12121a;
const FIELD_BORDER = 0x333348;
const LABEL_COLOR = 0x888898;
const TEXT_COLOR = 0xf0f0ff;
const MUTED_TEXT = 0x666678;
const ACCENT = 0x6366f1;

const CARD_RADIUS = 6;
const BUTTON_RADIUS = 4;
const PADDING_X = 16;
const PADDING_Y = 14;
const FIELD_HEIGHT = 28;
const LABEL_SIZE = 10;
const TEXT_SIZE = 12;
const HEADER_SIZE = 14;

const BUTTON_HEIGHT = 30;
const BUTTON_GAP = 8;
const FONT = "system-ui, sans-serif";
const RESOLUTION = 3;

// ---------------------------------------------------------------------------
// factory
// ---------------------------------------------------------------------------

export const joinCanvasWidget: WidgetFactory<typeof joinCanvasSchema> = {
  type: "join-canvas",
  metadata: {
    name: "join canvas",
    description: "join a shared canvas from a share string",
    version: "0.1.0",
    category: "narthex",
    defaultWidth: 320,
    defaultHeight: 200,
  },
  schema: joinCanvasSchema,
  editableProps: [],

  create(ctx: WidgetMountContext<typeof joinCanvasSchema>): WidgetController {
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
      text: "join canvas",
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
    // share string input field
    // ---------------------------------------------------------------------------

    const shareLabel = new Text({
      text: "share string",
      style: { fontFamily: FONT, fontSize: LABEL_SIZE, fill: LABEL_COLOR },
      resolution: RESOLUTION,
    });
    shareLabel.eventMode = "none";
    container.addChild(shareLabel);

    const shareField = createSkeinInput({
      canvasElement: ctx.canvasElement,
      width: currentWidth - PADDING_X * 2,
      height: FIELD_HEIGHT,
      placeholder: "paste share string...",
      value: ctx.doc.current.shareString || "",
      onChange: (value: string) => {
        ctx.doc.change((draft) => {
          draft.shareString = value;
        });
      },
    });
    container.addChild(shareField.input);

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
      shareField.blur();
      window.dispatchEvent(
        new CustomEvent("skein:remove-widget", {
          detail: { widgetId: ctx.widgetId },
        })
      );
    });

    const joinBtn = new Container();
    joinBtn.eventMode = "static";
    joinBtn.cursor = "pointer";

    const joinBg = new Graphics();
    joinBtn.addChild(joinBg);

    const joinText = new Text({
      text: "join",
      style: { fontFamily: FONT, fontSize: TEXT_SIZE, fontWeight: "bold", fill: 0xffffff },
      resolution: RESOLUTION,
    });
    joinText.eventMode = "none";
    joinBtn.addChild(joinText);
    container.addChild(joinBtn);

    joinBtn.on("pointertap", (e) => {
      e.stopPropagation();
      shareField.blur();
      const shareString = shareField.value.trim();

      if (!shareString) return;

      // validate the share string
      const decoded = decodeShareString(shareString);
      if (!decoded) {
        console.warn("[join-canvas] invalid share string");
        return;
      }

      window.dispatchEvent(
        new CustomEvent("skein:join-canvas", {
          detail: {
            shareString,
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

      // share string field
      shareLabel.x = PADDING_X;
      shareLabel.y = y;
      shareField.input.x = PADDING_X;
      shareField.input.y = y + LABEL_SIZE + 4;
      shareField.setWidth(contentW);
      // sync display value from doc if the field is not actively being edited
      if (!(shareField as any).input?.editing) {
        shareField.value = state.shareString;
      }

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

      // join button
      joinBg.clear();
      joinBg.roundRect(0, 0, buttonW, BUTTON_HEIGHT, BUTTON_RADIUS);
      joinBg.fill({ color: ACCENT });
      joinBtn.x = PADDING_X + buttonW + BUTTON_GAP;
      joinBtn.y = buttonY;
      joinText.x = (buttonW - joinText.width) / 2;
      joinText.y = (BUTTON_HEIGHT - TEXT_SIZE) / 2;
    };

    // initial draw
    layout(currentWidth, currentHeight);

    // subscribe to remote doc changes (automerge sync)
    const unsub = ctx.doc.on("change", () => {
      layout(currentWidth, currentHeight);
    });

    // ---------------------------------------------------------------------------
    // controller
    // ---------------------------------------------------------------------------

    return {
      container,

      destroy() {
        shareField.destroy();
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

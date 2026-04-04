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

export interface ShareDialogOptions {
  app: Application;
  theme: SkeinTheme;
  shareString: string;
  shareUrl: string;
  onClose?: () => void;
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
  const contentNeeded = rowHeight * 2 + SECTION_GAP;
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
    content: [row1.container, row2.container],
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

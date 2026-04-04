import {
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
} from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import { pickImageAsDataUrl } from "../widgets/image-utils";

import { createSkeinInput } from "../widgets/skein-input";
import type { WidgetRegistry } from "../widgets/widget-registry";
import type { WidgetDoc, WidgetPropDef } from "../widgets/widget-types";
import { TRANSPARENT_COLOR } from "../widgets/widget-types";
import type { CanvasStore } from "./canvas-store";
import type { InputRouter } from "./input-router";
import type { WidgetManager } from "./widget-manager";

// layout constants
const DEFAULT_TRAY_WIDTH = 180;
const MIN_TRAY_WIDTH = 140;
const MAX_TRAY_WIDTH = 400;
const TRAY_GAP = 8;
const TRAY_PAD_H = 10;
const TRAY_PAD_V = 8;
const ROW_GAP = 10;
const FIELD_HEIGHT = 24;
const LABEL_FIELD_GAP = 3;
const RESIZE_HANDLE_WIDTH = 6;

// preset color palette for the color picker
const COLOR_PALETTE = [
  // transparent + neutrals
  -1, 0x000000, 0x374151, 0x6b7280, 0xd1d5db, 0xffffff,
  // vivid
  0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x3b82f6, 0x8b5cf6,
  // pastel
  0xfca5a5, 0xfdba74, 0xfde047, 0x86efac, 0x93c5fd, 0xc4b5fd,
  // dark tones
  0x7f1d1d, 0x78350f, 0x713f12, 0x14532d, 0x1e3a5f, 0x3b0764,
];
const PALETTE_COLS = 6;
const SWATCH_SIZE = 20;
const SWATCH_GAP = 4;

/**
 * internal interface for a single prop control rendered inside the tray.
 */
interface PropControl {
  key: string;
  height: number;
  container: Container;
  /** update the control's displayed value (called on external doc changes) */
  update(value: unknown): void;
  /** adjust the control to a new field width (called during tray resize) */
  setWidth(fieldWidth: number): void;
  /** tear down the control */
  destroy(): void;
}

/**
 * property editing tray that appears to the right of the selected
 * widget in edit mode. renders editable controls for each WidgetPropDef
 * declared by the widget factory.
 *
 * only one tray is shown at a time. it lives in the world container
 * so it pans and zooms with widgets, at a very high zIndex so it
 * renders above all widget frames.
 *
 * the tray is horizontally resizable by dragging its right edge.
 *
 * supports string (keyboard-driven text input), number (+/- buttons),
 * boolean (toggle), color (swatch + palette popup), and select
 * (field + dropdown popup) controls.
 */
export class PropertyTray {
  readonly root: Container;

  private readonly theme: SkeinTheme;
  private readonly canvasElement: HTMLCanvasElement;
  private readonly inputRouter: InputRouter;
  private readonly widgetManager: WidgetManager;
  private readonly registry: WidgetRegistry;

  private readonly bg: Graphics;
  private readonly header: Text;
  private readonly contentContainer: Container;
  private readonly resizeHandle: Graphics;

  private trayWidth = DEFAULT_TRAY_WIDTH;
  private currentWidgetId: string | null = null;
  private controls: PropControl[] = [];
  private docUnsub: (() => void) | null = null;
  private unsubs: (() => void)[] = [];

  /**
   * function to stop the currently active keyboard editing session
   * inside a string control. null when no field is being edited.
   */
  private activeStopEditing: (() => void) | null = null;

  /**
   * function to close the currently active popup (color palette or
   * select dropdown). null when no popup is open.
   */
  private activePopupClose: (() => void) | null = null;

  // resize drag state
  private resizing = false;
  private resizeStartGlobalX = 0;
  private resizeStartWidth = 0;

  constructor(
    world: Container,
    theme: SkeinTheme,
    canvasElement: HTMLCanvasElement,
    inputRouter: InputRouter,
    widgetManager: WidgetManager,
    store: CanvasStore,
    registry: WidgetRegistry
  ) {
    this.theme = theme;
    this.canvasElement = canvasElement;
    this.inputRouter = inputRouter;
    this.widgetManager = widgetManager;
    this.registry = registry;

    // root container — hidden until a widget with editableProps is selected
    this.root = new Container();
    this.root.visible = false;
    this.root.zIndex = 99999;
    this.root.eventMode = "static";
    this.root.interactiveChildren = true;
    this.root.sortableChildren = true;

    // swallow pointer events so they don't reach the world/stage.
    // also close any open popup when clicking the tray background.
    this.root.on("pointerdown", (e) => {
      e.stopPropagation();
      this.closeActivePopup();
    });

    // tray background
    this.bg = new Graphics();
    this.root.addChild(this.bg);

    // header showing the widget name
    this.header = new Text({
      text: "",
      resolution: theme.textResolution,
      style: {
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSizeSmall,
        fill: theme.frameHeaderText,
        fontWeight: "bold",
      },
    });
    this.header.x = TRAY_PAD_H;
    this.header.y = TRAY_PAD_V;
    this.header.eventMode = "none";
    this.root.addChild(this.header);

    // container for prop control rows
    this.contentContainer = new Container();
    this.contentContainer.x = TRAY_PAD_H;
    this.root.addChild(this.contentContainer);

    // resize handle on the right edge
    this.resizeHandle = new Graphics();
    this.resizeHandle.eventMode = "static";
    this.resizeHandle.cursor = "ew-resize";
    this.root.addChild(this.resizeHandle);
    this.setupResizeHandle();

    world.addChild(this.root);

    // subscribe to selection and mode changes
    this.unsubs.push(inputRouter.onSelectionChange(() => this.refresh()));
    this.unsubs.push(inputRouter.onModeChange(() => this.refresh()));

    // reposition tray when the store changes (widget moved/resized)
    this.unsubs.push(store.onChange(() => this.repositionIfNeeded()));
  }

  // ---------------------------------------------------------------------------
  // resize handle
  // ---------------------------------------------------------------------------

  private setupResizeHandle(): void {
    this.resizeHandle.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.resizing = true;
      this.resizeStartGlobalX = e.global.x;
      this.resizeStartWidth = this.trayWidth;
    });

    this.resizeHandle.on("globalpointermove", (e: FederatedPointerEvent) => {
      if (!this.resizing) return;
      const zoom = this.root.parent?.scale.x ?? 1;
      const dx = (e.global.x - this.resizeStartGlobalX) / zoom;
      const newWidth = Math.round(
        Math.max(MIN_TRAY_WIDTH, Math.min(MAX_TRAY_WIDTH, this.resizeStartWidth + dx))
      );
      if (newWidth !== this.trayWidth) {
        this.trayWidth = newWidth;
        this.applyWidth();
      }
    });

    this.resizeHandle.on("pointerup", () => {
      this.resizing = false;
    });

    this.resizeHandle.on("pointerupoutside", () => {
      this.resizing = false;
    });
  }

  /**
   * propagate the current tray width to all controls and redraw chrome.
   */
  private applyWidth(): void {
    const fieldWidth = this.trayWidth - TRAY_PAD_H * 2;
    for (const control of this.controls) {
      control.setWidth(fieldWidth);
    }
    this.drawBackground();
    this.drawResizeHandle();
  }

  private drawResizeHandle(): void {
    const contentBottom = this.contentContainer.y + this.contentContainer.height;
    const totalHeight = contentBottom + TRAY_PAD_V;

    this.resizeHandle.clear();
    // transparent hit area on the right edge
    this.resizeHandle.rect(
      this.trayWidth - RESIZE_HANDLE_WIDTH / 2,
      0,
      RESIZE_HANDLE_WIDTH,
      totalHeight
    );
    this.resizeHandle.fill({ color: 0x000000, alpha: 0 });
    // subtle visual indicator line
    this.resizeHandle.rect(this.trayWidth - 1, 8, 1, Math.max(totalHeight - 16, 8));
    this.resizeHandle.fill({ color: this.theme.frameBorder, alpha: 0.5 });
  }

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  /**
   * re-evaluate whether the tray should be shown, hidden, or rebuilt.
   */
  private refresh(): void {
    const selectedId = this.inputRouter.selectedWidgetId;

    if (!selectedId || !this.inputRouter.isEditMode) {
      this.hide();
      return;
    }

    // if the same widget is still selected, don't rebuild
    if (selectedId === this.currentWidgetId && this.root.visible) {
      return;
    }

    const live = this.widgetManager.getLiveWidgets().get(selectedId);
    if (!live || !live.widgetDoc || live.crashed) {
      this.hide();
      return;
    }

    const factory = this.registry.get(live.entry.type);
    if (!factory?.editableProps?.length) {
      this.hide();
      return;
    }

    this.show(selectedId, factory.metadata.name, factory.editableProps, live.widgetDoc);
    this.positionNextTo(live.frame.root.x, live.frame.root.y, live.entry.width);
  }

  /**
   * build and display the tray for a specific widget.
   */
  private show(
    widgetId: string,
    widgetName: string,
    props: WidgetPropDef[],
    doc: WidgetDoc<any>
  ): void {
    // tear down any previous tray state
    this.clearControls();

    this.currentWidgetId = widgetId;
    this.header.text = widgetName;

    // position the content below the header
    this.contentContainer.y = Math.round(this.header.y + this.header.height + ROW_GAP);

    // build a control for each editable prop
    const fieldWidth = this.trayWidth - TRAY_PAD_H * 2;
    let y = 0;
    for (const prop of props) {
      const control = this.createControl(prop, doc, fieldWidth);
      control.container.y = Math.round(y);
      this.contentContainer.addChild(control.container);
      this.controls.push(control);
      y += control.height + ROW_GAP;
    }

    // subscribe to doc changes so controls stay in sync with remote edits
    this.docUnsub = doc.on("change", (state: Record<string, unknown>) => {
      for (const control of this.controls) {
        control.update(state[control.key]);
      }
    });

    this.drawBackground();
    this.drawResizeHandle();
    this.root.visible = true;
  }

  /**
   * hide the tray and tear down controls.
   */
  hide(): void {
    // release keyboard if a string field is being edited
    if (this.activeStopEditing) {
      this.activeStopEditing();
      this.activeStopEditing = null;
    }

    this.closeActivePopup();
    this.clearControls();
    this.currentWidgetId = null;
    this.root.visible = false;
  }

  /**
   * tear down controls and doc subscription without hiding the root.
   */
  private clearControls(): void {
    if (this.docUnsub) {
      this.docUnsub();
      this.docUnsub = null;
    }

    for (const control of this.controls) {
      control.destroy();
    }
    this.controls = [];
    this.contentContainer.removeChildren();
  }

  private positionNextTo(frameX: number, frameY: number, frameWidth: number): void {
    this.root.x = Math.round(frameX + frameWidth + TRAY_GAP);
    this.root.y = Math.round(frameY);
  }

  private repositionIfNeeded(): void {
    if (!this.currentWidgetId || !this.root.visible) return;

    const live = this.widgetManager.getLiveWidgets().get(this.currentWidgetId);
    if (!live) {
      this.hide();
      return;
    }

    this.positionNextTo(live.frame.root.x, live.frame.root.y, live.entry.width);
  }

  private drawBackground(): void {
    const contentBottom = this.contentContainer.y + this.contentContainer.height;
    const totalHeight = contentBottom + TRAY_PAD_V;

    this.bg.clear();
    this.bg.roundRect(0, 0, this.trayWidth, totalHeight, 6);
    this.bg.fill({ color: this.theme.toolbarBg, alpha: 0.96 });
    this.bg.stroke({ color: this.theme.toolbarBorder, width: 1 });
  }

  destroy(): void {
    this.hide();
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.root.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // popup management
  // ---------------------------------------------------------------------------

  /**
   * close the currently open popup (color palette or select dropdown).
   */
  private closeActivePopup(): void {
    if (this.activePopupClose) {
      const close = this.activePopupClose;
      this.activePopupClose = null;
      close();
    }
  }

  // ---------------------------------------------------------------------------
  // control factory
  // ---------------------------------------------------------------------------

  private createControl(prop: WidgetPropDef, doc: WidgetDoc<any>, fieldWidth: number): PropControl {
    const currentValue = doc.current[prop.key];
    const onChange = (value: unknown) => {
      doc.change((draft: Record<string, unknown>) => {
        draft[prop.key] = value;
      });
    };

    switch (prop.type) {
      case "string":
        return this.createStringControl(
          prop,
          String(currentValue ?? prop.default ?? ""),
          onChange as (v: string) => void,
          fieldWidth
        );
      case "number":
        return this.createNumberControl(
          prop,
          Number(currentValue ?? prop.default ?? 0),
          onChange as (v: number) => void,
          fieldWidth
        );
      case "boolean":
        return this.createBooleanControl(
          prop,
          Boolean(currentValue ?? prop.default ?? false),
          onChange as (v: boolean) => void,
          fieldWidth
        );
      case "color":
        return this.createColorControl(
          prop,
          Number(currentValue ?? prop.default ?? 0x000000),
          onChange as (v: number) => void,
          fieldWidth
        );
      case "select":
        return this.createSelectControl(
          prop,
          String(currentValue ?? prop.default ?? ""),
          onChange as (v: string) => void,
          fieldWidth
        );
      case "image":
        return this.createImageControl(
          prop,
          String(currentValue ?? prop.default ?? ""),
          onChange as (v: string) => void,
          fieldWidth
        );
    }
  }

  // ---------------------------------------------------------------------------
  // shared helpers
  // ---------------------------------------------------------------------------

  /**
   * create a label Text for a prop row.
   */
  private createLabel(text: string): Text {
    const label = new Text({
      text,
      resolution: this.theme.textResolution,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSizeSmall - 1,
        fill: 0x808080,
      },
    });
    label.eventMode = "none";
    return label;
  }

  /**
   * draw a standard field background rectangle.
   */
  private drawFieldBg(g: Graphics, fieldY: number, fieldWidth: number, highlight: boolean): void {
    g.clear();
    g.roundRect(0, fieldY, fieldWidth, FIELD_HEIGHT, 4);
    g.fill({ color: highlight ? 0x1a1a2e : 0x141414 });
    g.stroke({
      color: highlight ? this.theme.accent : this.theme.frameBorder,
      width: 1,
    });
  }

  // ---------------------------------------------------------------------------
  // string control
  // ---------------------------------------------------------------------------

  private createStringControl(
    prop: WidgetPropDef,
    initialValue: string,
    onChange: (value: string) => void,
    fieldWidth: number
  ): PropControl {
    const container = new Container();
    container.eventMode = "static";

    const label = this.createLabel(prop.label);
    container.addChild(label);

    const fieldY = Math.round(label.height + LABEL_FIELD_GAP);

    const handle = createSkeinInput({
      canvasElement: this.canvasElement,
      width: fieldWidth,
      height: FIELD_HEIGHT,
      value: initialValue,
      onChange,
      // theme overrides to match property tray styling
      fontSize: this.theme.fontSizeSmall,
      fontFamily: this.theme.fontFamily,
      textColor: this.theme.frameHeaderText,
      bgColor: 0x141414,
      borderColor: this.theme.frameBorder,
      borderActiveColor: this.theme.accent,
      cornerRadius: 4,
    });

    handle.input.y = fieldY;
    container.addChild(handle.input);

    // close any active popup when the input is clicked/focused
    handle.input.on("pointertap", () => {
      this.closeActivePopup();
    });

    const totalHeight = fieldY + FIELD_HEIGHT;

    return {
      key: prop.key,
      height: totalHeight,
      container,
      update(value: unknown) {
        if (!handle.isEditing) {
          handle.value = String(value ?? "");
        }
      },
      setWidth(fw: number) {
        handle.setWidth(fw);
      },
      destroy() {
        handle.blur();
        handle.destroy();
        container.destroy({ children: true });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // number control
  // ---------------------------------------------------------------------------

  private createNumberControl(
    prop: WidgetPropDef,
    initialValue: number,
    onChange: (value: number) => void,
    fieldWidth: number
  ): PropControl {
    const container = new Container();
    container.eventMode = "static";

    const label = this.createLabel(prop.label);
    container.addChild(label);

    const fieldY = Math.round(label.height + LABEL_FIELD_GAP);
    let currentFieldWidth = fieldWidth;
    let currentValue = initialValue;

    // field background
    const fieldBg = new Graphics();
    container.addChild(fieldBg);

    // value text centered in the field
    const valueText = new Text({
      text: String(currentValue),
      resolution: this.theme.textResolution,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSizeSmall,
        fill: this.theme.frameHeaderText,
      },
    });
    valueText.anchor.set(0.5, 0);
    valueText.eventMode = "none";
    container.addChild(valueText);

    const btnWidth = FIELD_HEIGHT;

    // minus button
    const minusBtn = this.createNumberButton("\u2212");
    container.addChild(minusBtn.container);

    // plus button
    const plusBtn = this.createNumberButton("+");
    container.addChild(plusBtn.container);

    const layout = () => {
      fieldBg.clear();
      fieldBg.roundRect(0, fieldY, currentFieldWidth, FIELD_HEIGHT, 4);
      fieldBg.fill({ color: 0x141414 });
      fieldBg.stroke({ color: this.theme.frameBorder, width: 1 });

      minusBtn.container.x = 0;
      minusBtn.container.y = fieldY;
      minusBtn.setSize(btnWidth, FIELD_HEIGHT);

      plusBtn.container.x = currentFieldWidth - btnWidth;
      plusBtn.container.y = fieldY;
      plusBtn.setSize(btnWidth, FIELD_HEIGHT);

      valueText.x = Math.round(currentFieldWidth / 2);
      valueText.y = fieldY + Math.round((FIELD_HEIGHT - valueText.height) / 2);
    };
    layout();

    minusBtn.container.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.closeActivePopup();
      currentValue -= 1;
      valueText.text = String(currentValue);
      onChange(currentValue);
    });

    plusBtn.container.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.closeActivePopup();
      currentValue += 1;
      valueText.text = String(currentValue);
      onChange(currentValue);
    });

    const totalHeight = fieldY + FIELD_HEIGHT;

    return {
      key: prop.key,
      height: totalHeight,
      container,
      update(value: unknown) {
        currentValue = Number(value) || 0;
        valueText.text = String(currentValue);
      },
      setWidth(fw: number) {
        currentFieldWidth = fw;
        layout();
      },
      destroy() {
        container.destroy({ children: true });
      },
    };
  }

  private createNumberButton(labelStr: string): {
    container: Container;
    setSize: (w: number, h: number) => void;
  } {
    const btnContainer = new Container();
    btnContainer.eventMode = "static";
    btnContainer.cursor = "pointer";

    const bg = new Graphics();
    btnContainer.addChild(bg);

    const text = new Text({
      text: labelStr,
      resolution: this.theme.textResolution,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSizeSmall,
        fill: this.theme.frameHeaderText,
      },
    });
    text.anchor.set(0.5);
    // transparent to pointer events so clicks reach the button bg
    text.eventMode = "none";
    btnContainer.addChild(text);

    let currentW = 0;
    let currentH = 0;

    const draw = (hover: boolean) => {
      bg.clear();
      bg.roundRect(0, 0, currentW, currentH, 4);
      bg.fill({ color: hover ? this.theme.accent : 0x1a1a1a, alpha: hover ? 0.2 : 1 });
    };

    btnContainer.on("pointerover", () => draw(true));
    btnContainer.on("pointerout", () => draw(false));

    const setSize = (w: number, h: number) => {
      currentW = w;
      currentH = h;
      text.x = Math.round(w / 2);
      text.y = Math.round(h / 2);
      draw(false);
    };

    return { container: btnContainer, setSize };
  }

  // ---------------------------------------------------------------------------
  // boolean control
  // ---------------------------------------------------------------------------

  private createBooleanControl(
    prop: WidgetPropDef,
    initialValue: boolean,
    onChange: (value: boolean) => void,
    _fieldWidth: number
  ): PropControl {
    const container = new Container();
    container.eventMode = "static";

    const label = this.createLabel(prop.label);
    container.addChild(label);

    const fieldY = Math.round(label.height + LABEL_FIELD_GAP);
    const trackWidth = 36;
    const trackHeight = 20;
    const thumbRadius = 7;
    const thumbPad = 3;

    let value = initialValue;

    const track = new Graphics();
    container.addChild(track);

    const thumb = new Graphics();
    container.addChild(thumb);

    const drawToggle = () => {
      track.clear();
      track.roundRect(0, fieldY, trackWidth, trackHeight, trackHeight / 2);
      track.fill({ color: value ? this.theme.accent : 0x2a2a2a });

      thumb.clear();
      const thumbX = value ? trackWidth - thumbRadius - thumbPad : thumbRadius + thumbPad;
      const thumbY = fieldY + trackHeight / 2;
      thumb.circle(thumbX, thumbY, thumbRadius);
      thumb.fill({ color: 0xffffff });
    };

    drawToggle();

    track.eventMode = "static";
    track.cursor = "pointer";
    track.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.closeActivePopup();
      value = !value;
      onChange(value);
      drawToggle();
    });

    const totalHeight = fieldY + trackHeight;

    return {
      key: prop.key,
      height: totalHeight,
      container,
      update(newValue: unknown) {
        value = Boolean(newValue);
        drawToggle();
      },
      setWidth() {
        // toggle is fixed width — nothing to do
      },
      destroy() {
        container.destroy({ children: true });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // color control
  // ---------------------------------------------------------------------------

  private createColorControl(
    prop: WidgetPropDef,
    initialValue: number,
    onChange: (value: number) => void,
    fieldWidth: number
  ): PropControl {
    const container = new Container();
    container.eventMode = "static";

    const label = this.createLabel(prop.label);
    container.addChild(label);

    const fieldY = Math.round(label.height + LABEL_FIELD_GAP);
    let currentFieldWidth = fieldWidth;
    let currentColor = initialValue;

    // field background
    const fieldBg = new Graphics();
    container.addChild(fieldBg);

    // color swatch
    const swatchSize = FIELD_HEIGHT - 6;
    const swatch = new Graphics();
    container.addChild(swatch);

    // hex label
    const hexText = new Text({
      text: formatHex(currentColor),
      resolution: this.theme.textResolution,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSizeSmall - 1,
        fill: this.theme.frameHeaderText,
      },
    });
    hexText.eventMode = "none";
    container.addChild(hexText);

    // palette popup container (hidden by default)
    let paletteContainer: Container | null = null;

    const drawSwatch = () => {
      swatch.clear();
      const x0 = 4,
        y0 = fieldY + 3;
      if (currentColor === TRANSPARENT_COLOR) {
        // checkerboard pattern for transparent
        const half = Math.floor(swatchSize / 2);
        // light squares
        swatch.rect(x0, y0, half, half);
        swatch.fill({ color: 0xcccccc });
        swatch.rect(x0 + half, y0 + half, swatchSize - half, swatchSize - half);
        swatch.fill({ color: 0xcccccc });
        // dark squares
        swatch.rect(x0 + half, y0, swatchSize - half, half);
        swatch.fill({ color: 0x888888 });
        swatch.rect(x0, y0 + half, half, swatchSize - half);
        swatch.fill({ color: 0x888888 });
        // border
        swatch.roundRect(x0, y0, swatchSize, swatchSize, 3);
        swatch.stroke({ color: 0x555555, width: 1 });
      } else {
        swatch.roundRect(x0, y0, swatchSize, swatchSize, 3);
        swatch.fill({ color: currentColor });
        swatch.stroke({ color: 0x555555, width: 1 });
      }
    };

    const drawFieldLayout = () => {
      this.drawFieldBg(fieldBg, fieldY, currentFieldWidth, false);
      drawSwatch();
      hexText.x = 4 + swatchSize + 6;
      hexText.y = fieldY + Math.round((FIELD_HEIGHT - hexText.height) / 2);
    };
    drawFieldLayout();

    const closePalette = () => {
      if (paletteContainer) {
        if (paletteContainer.parent) {
          paletteContainer.parent.removeChild(paletteContainer);
        }
        paletteContainer.destroy({ children: true });
        paletteContainer = null;
      }
      if (this.activePopupClose === closePalette) {
        this.activePopupClose = null;
      }
    };

    const openPalette = () => {
      // close any other popup first
      this.closeActivePopup();
      if (this.activeStopEditing) {
        this.activeStopEditing();
        this.activeStopEditing = null;
      }

      paletteContainer = new Container();
      paletteContainer.eventMode = "static";
      paletteContainer.zIndex = 100000;

      // hide transparent option for text-related color props (text, heading, accent, etc.)
      const propKey = prop.key.toLowerCase();
      const allowTransparent = propKey.includes("bg") || propKey.includes("border");
      const palette = allowTransparent
        ? COLOR_PALETTE
        : COLOR_PALETTE.filter((c) => c !== TRANSPARENT_COLOR);

      const palettePad = 6;
      const rows = Math.ceil(palette.length / PALETTE_COLS);
      const paletteW = PALETTE_COLS * (SWATCH_SIZE + SWATCH_GAP) - SWATCH_GAP + palettePad * 2;
      const paletteH = rows * (SWATCH_SIZE + SWATCH_GAP) - SWATCH_GAP + palettePad * 2;

      // palette background
      const palBg = new Graphics();
      palBg.roundRect(0, 0, paletteW, paletteH, 6);
      palBg.fill({ color: this.theme.toolbarBg, alpha: 0.98 });
      palBg.stroke({ color: this.theme.toolbarBorder, width: 1 });
      palBg.eventMode = "static";
      palBg.on("pointerdown", (e: FederatedPointerEvent) => e.stopPropagation());
      paletteContainer.addChild(palBg);

      // color swatches
      for (let i = 0; i < palette.length; i++) {
        const col = i % PALETTE_COLS;
        const row = Math.floor(i / PALETTE_COLS);
        const color = palette[i];

        const sw = new Graphics();
        const sx = palettePad + col * (SWATCH_SIZE + SWATCH_GAP);
        const sy = palettePad + row * (SWATCH_SIZE + SWATCH_GAP);

        const drawPaletteSwatch = (g: Graphics, active: boolean) => {
          g.clear();
          if (color === TRANSPARENT_COLOR) {
            const half = Math.floor(SWATCH_SIZE / 2);
            // light squares
            g.rect(sx, sy, half, half);
            g.fill({ color: 0xcccccc });
            g.rect(sx + half, sy + half, SWATCH_SIZE - half, SWATCH_SIZE - half);
            g.fill({ color: 0xcccccc });
            // dark squares
            g.rect(sx + half, sy, SWATCH_SIZE - half, half);
            g.fill({ color: 0x888888 });
            g.rect(sx, sy + half, half, SWATCH_SIZE - half);
            g.fill({ color: 0x888888 });
            // border
            g.roundRect(sx, sy, SWATCH_SIZE, SWATCH_SIZE, 3);
            g.stroke({ color: active ? this.theme.accent : 0x555555, width: active ? 2 : 1 });
          } else {
            g.roundRect(sx, sy, SWATCH_SIZE, SWATCH_SIZE, 3);
            g.fill({ color });
            if (active) {
              g.stroke({ color: this.theme.accent, width: 2 });
            } else if (color >= 0xd0d0d0) {
              g.stroke({ color: 0x555555, width: 1 });
            }
          }
        };
        drawPaletteSwatch(sw, false);

        sw.eventMode = "static";
        sw.cursor = "pointer";

        // highlight on hover
        sw.on("pointerover", () => drawPaletteSwatch(sw, true));
        sw.on("pointerout", () => drawPaletteSwatch(sw, false));

        sw.on("pointerdown", (e: FederatedPointerEvent) => {
          e.stopPropagation();
          currentColor = color;
          hexText.text = formatHex(currentColor);
          drawSwatch();
          onChange(currentColor);
          closePalette();
        });

        paletteContainer.addChild(sw);
      }

      // position below the field, accounting for the control's offset in the tray
      paletteContainer.x = TRAY_PAD_H;
      paletteContainer.y = container.y + this.contentContainer.y + fieldY + FIELD_HEIGHT + 4;

      this.root.addChild(paletteContainer);
      this.activePopupClose = closePalette;
    };

    // toggle palette on click
    fieldBg.eventMode = "static";
    fieldBg.cursor = "pointer";
    fieldBg.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (paletteContainer) {
        closePalette();
      } else {
        openPalette();
      }
    });

    const totalHeight = fieldY + FIELD_HEIGHT;

    return {
      key: prop.key,
      height: totalHeight,
      container,
      update(value: unknown) {
        currentColor = Number(value) || 0;
        hexText.text = formatHex(currentColor);
        drawSwatch();
      },
      setWidth(fw: number) {
        currentFieldWidth = fw;
        drawFieldLayout();
      },
      destroy() {
        closePalette();
        container.destroy({ children: true });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // select control
  // ---------------------------------------------------------------------------

  private createSelectControl(
    prop: WidgetPropDef,
    initialValue: string,
    onChange: (value: string) => void,
    fieldWidth: number
  ): PropControl {
    const container = new Container();
    container.eventMode = "static";
    const options = prop.options ?? [];

    const label = this.createLabel(prop.label);
    container.addChild(label);

    const fieldY = Math.round(label.height + LABEL_FIELD_GAP);
    let currentFieldWidth = fieldWidth;
    let currentValue = initialValue;

    // field background
    const fieldBg = new Graphics();
    container.addChild(fieldBg);

    // text mask for clipping
    const fieldTextMask = new Graphics();
    container.addChild(fieldTextMask);

    // display the current value (truncated to show just the primary font name)
    const displayText = new Text({
      text: formatSelectLabel(currentValue),
      resolution: this.theme.textResolution,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSizeSmall,
        fill: this.theme.frameHeaderText,
      },
    });
    displayText.x = 6;
    displayText.y = fieldY + Math.round((FIELD_HEIGHT - displayText.height) / 2);
    displayText.mask = fieldTextMask;
    displayText.eventMode = "none";
    container.addChild(displayText);

    // dropdown arrow
    const arrow = new Text({
      text: "\u25BE",
      resolution: this.theme.textResolution,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSizeSmall - 1,
        fill: 0x808080,
      },
    });
    arrow.eventMode = "none";
    container.addChild(arrow);

    let dropdownContainer: Container | null = null;

    const drawFieldLayout = () => {
      this.drawFieldBg(fieldBg, fieldY, currentFieldWidth, false);
      fieldTextMask.clear();
      fieldTextMask.rect(4, fieldY + 1, currentFieldWidth - 24, FIELD_HEIGHT - 2);
      fieldTextMask.fill({ color: 0xffffff });
      arrow.x = currentFieldWidth - 16;
      arrow.y = fieldY + Math.round((FIELD_HEIGHT - arrow.height) / 2);
    };
    drawFieldLayout();

    const closeDropdown = () => {
      if (dropdownContainer) {
        if (dropdownContainer.parent) {
          dropdownContainer.parent.removeChild(dropdownContainer);
        }
        dropdownContainer.destroy({ children: true });
        dropdownContainer = null;
      }
      if (this.activePopupClose === closeDropdown) {
        this.activePopupClose = null;
      }
    };

    const openDropdown = () => {
      this.closeActivePopup();
      if (this.activeStopEditing) {
        this.activeStopEditing();
        this.activeStopEditing = null;
      }

      dropdownContainer = new Container();
      dropdownContainer.eventMode = "static";
      dropdownContainer.zIndex = 100000;

      const itemHeight = FIELD_HEIGHT;
      const itemPadH = 6;
      const ddPad = 4;
      const ddWidth = currentFieldWidth;
      const ddHeight = options.length * itemHeight + ddPad * 2;

      // dropdown background
      const ddBg = new Graphics();
      ddBg.roundRect(0, 0, ddWidth, ddHeight, 4);
      ddBg.fill({ color: this.theme.toolbarBg, alpha: 0.98 });
      ddBg.stroke({ color: this.theme.toolbarBorder, width: 1 });
      ddBg.eventMode = "static";
      ddBg.on("pointerdown", (e: FederatedPointerEvent) => e.stopPropagation());
      dropdownContainer.addChild(ddBg);

      // option items
      for (let i = 0; i < options.length; i++) {
        const option = options[i];
        const itemY = ddPad + i * itemHeight;

        const itemBg = new Graphics();
        const isSelected = option === currentValue;
        itemBg.roundRect(ddPad, itemY, ddWidth - ddPad * 2, itemHeight, 3);
        itemBg.fill({
          color: isSelected ? this.theme.accent : 0x000000,
          alpha: isSelected ? 0.15 : 0,
        });
        itemBg.eventMode = "static";
        itemBg.cursor = "pointer";
        dropdownContainer.addChild(itemBg);

        const itemText = new Text({
          text: formatSelectLabel(option),
          resolution: this.theme.textResolution,
          style: {
            fontFamily: this.theme.fontFamily,
            fontSize: this.theme.fontSizeSmall,
            fill: isSelected ? this.theme.accent : this.theme.frameHeaderText,
          },
        });
        itemText.x = ddPad + itemPadH;
        itemText.y = itemY + Math.round((itemHeight - itemText.height) / 2);
        itemText.eventMode = "none";
        dropdownContainer.addChild(itemText);

        itemBg.on("pointerover", () => {
          itemBg.clear();
          itemBg.roundRect(ddPad, itemY, ddWidth - ddPad * 2, itemHeight, 3);
          itemBg.fill({ color: this.theme.accent, alpha: 0.15 });
        });
        itemBg.on("pointerout", () => {
          itemBg.clear();
          itemBg.roundRect(ddPad, itemY, ddWidth - ddPad * 2, itemHeight, 3);
          const sel = option === currentValue;
          itemBg.fill({ color: sel ? this.theme.accent : 0x000000, alpha: sel ? 0.15 : 0 });
        });

        itemBg.on("pointerdown", (e: FederatedPointerEvent) => {
          e.stopPropagation();
          currentValue = option;
          displayText.text = formatSelectLabel(currentValue);
          onChange(currentValue);
          closeDropdown();
        });
      }

      // position below the field, accounting for the control's offset in the tray
      dropdownContainer.x = TRAY_PAD_H;
      dropdownContainer.y = container.y + this.contentContainer.y + fieldY + FIELD_HEIGHT + 4;

      this.root.addChild(dropdownContainer);
      this.activePopupClose = closeDropdown;
    };

    // toggle dropdown on click
    fieldBg.eventMode = "static";
    fieldBg.cursor = "pointer";
    fieldBg.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (dropdownContainer) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    const totalHeight = fieldY + FIELD_HEIGHT;

    return {
      key: prop.key,
      height: totalHeight,
      container,
      update(value: unknown) {
        currentValue = String(value ?? "");
        displayText.text = formatSelectLabel(currentValue);
      },
      setWidth(fw: number) {
        currentFieldWidth = fw;
        drawFieldLayout();
      },
      destroy() {
        closeDropdown();
        container.destroy({ children: true });
      },
    };
  }

  // ---------------------------------------------------------------------------
  // image control
  // ---------------------------------------------------------------------------

  private createImageControl(
    prop: WidgetPropDef,
    initialValue: string,
    onChange: (value: string) => void,
    fieldWidth: number
  ): PropControl {
    const container = new Container();
    container.eventMode = "static";

    const label = this.createLabel(prop.label);
    container.addChild(label);

    const fieldY = Math.round(label.height + LABEL_FIELD_GAP);

    // preview area — shows the current image or a placeholder
    const PREVIEW_HEIGHT = 60;
    const previewBg = new Graphics();
    container.addChild(previewBg);

    let previewSprite: Sprite | null = null;
    let currentDataUrl = initialValue;

    const drawPreview = (fw: number) => {
      previewBg.clear();
      previewBg.roundRect(0, fieldY, fw, PREVIEW_HEIGHT, 4);
      previewBg.fill({ color: 0x141414 });
      previewBg.stroke({ color: this.theme.frameBorder, width: 1 });

      if (previewSprite) {
        // fit the sprite within the preview area with padding
        const pad = 4;
        const maxW = fw - pad * 2;
        const maxH = PREVIEW_HEIGHT - pad * 2;
        const scale = Math.min(
          maxW / previewSprite.texture.width,
          maxH / previewSprite.texture.height,
          1
        );
        previewSprite.width = previewSprite.texture.width * scale;
        previewSprite.height = previewSprite.texture.height * scale;
        previewSprite.x = pad + (maxW - previewSprite.width) / 2;
        previewSprite.y = fieldY + pad + (maxH - previewSprite.height) / 2;
      }
    };

    const updateSprite = async (dataUrl: string) => {
      if (previewSprite) {
        container.removeChild(previewSprite);
        previewSprite.destroy();
        previewSprite = null;
      }
      // NOTE: do NOT call Assets.unload() here. the property tray is a consumer
      // of textures, not an owner. the widget that loaded this texture still
      // references it — unloading here would destroy a shared asset and crash
      // the renderer (alphaMode null error in StencilMaskPipe).
      if (!dataUrl) {
        drawPreview(fieldWidth);
        return;
      }
      try {
        const texture = await Assets.load<Texture>(dataUrl);
        // race check: if another load started while we were loading, bail out
        if (currentDataUrl !== dataUrl) return;
        previewSprite = new Sprite(texture);
        previewSprite.eventMode = "none";
        container.addChild(previewSprite);
        drawPreview(fieldWidth);
      } catch {
        // silently ignore load failures
      }
    };

    if (initialValue) {
      updateSprite(initialValue);
    }

    // buttons row below the preview
    const BTN_HEIGHT = 22;
    const BTN_GAP = 4;
    const btnY = fieldY + PREVIEW_HEIGHT + BTN_GAP;

    const uploadBtn = new Container();
    uploadBtn.eventMode = "static";
    uploadBtn.cursor = "pointer";
    const uploadBg = new Graphics();
    uploadBtn.addChild(uploadBg);
    const uploadText = new Text({
      text: currentDataUrl ? "change" : "upload",
      resolution: this.theme.textResolution,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSizeSmall - 1,
        fill: 0xffffff,
      },
    });
    uploadText.eventMode = "none";
    uploadBtn.addChild(uploadText);
    container.addChild(uploadBtn);

    // optional clear button (only shown when there's an image)
    const clearBtn = new Container();
    clearBtn.eventMode = "static";
    clearBtn.cursor = "pointer";
    const clearBg = new Graphics();
    clearBtn.addChild(clearBg);
    const clearText = new Text({
      text: "clear",
      resolution: this.theme.textResolution,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSizeSmall - 1,
        fill: 0xef4444,
      },
    });
    clearText.eventMode = "none";
    clearBtn.addChild(clearText);
    container.addChild(clearBtn);

    const layoutButtons = (fw: number) => {
      const hasImage = !!currentDataUrl;
      clearBtn.visible = hasImage;
      uploadText.text = hasImage ? "change" : "upload";

      // upload button
      const uploadW = hasImage ? Math.floor((fw - BTN_GAP) / 2) : fw;
      uploadBg.clear();
      uploadBg.roundRect(0, 0, uploadW, BTN_HEIGHT, 3);
      uploadBg.fill({ color: 0x1a1a2e });
      uploadBg.stroke({ color: this.theme.frameBorder, width: 1 });
      uploadText.x = Math.round((uploadW - uploadText.width) / 2);
      uploadText.y = Math.round((BTN_HEIGHT - uploadText.height) / 2);
      uploadBtn.x = 0;
      uploadBtn.y = btnY;

      // clear button
      if (hasImage) {
        const clearW = fw - uploadW - BTN_GAP;
        clearBg.clear();
        clearBg.roundRect(0, 0, clearW, BTN_HEIGHT, 3);
        clearBg.fill({ color: 0x1a1a2e });
        clearBg.stroke({ color: 0x4a2020, width: 1 });
        clearText.x = Math.round((clearW - clearText.width) / 2);
        clearText.y = Math.round((BTN_HEIGHT - clearText.height) / 2);
        clearBtn.x = uploadW + BTN_GAP;
        clearBtn.y = btnY;
      }
    };

    layoutButtons(fieldWidth);
    drawPreview(fieldWidth);

    // upload click handler
    uploadBtn.on("pointertap", async (e: any) => {
      e.stopPropagation();
      this.closeActivePopup();
      const dataUrl = await pickImageAsDataUrl({
        maxWidth: prop.imageMaxWidth ?? 320,
        maxHeight: prop.imageMaxHeight ?? 200,
        quality: 0.8,
        cropSquare: prop.imageCropSquare ?? false,
      });
      if (dataUrl) {
        currentDataUrl = dataUrl;
        onChange(dataUrl);
        updateSprite(dataUrl);
        layoutButtons(fieldWidth);
      }
    });

    // clear click handler
    clearBtn.on("pointertap", (e: any) => {
      e.stopPropagation();
      this.closeActivePopup();
      currentDataUrl = "";
      onChange("");
      updateSprite("");
      layoutButtons(fieldWidth);
    });

    const totalHeight = btnY + BTN_HEIGHT;

    return {
      key: prop.key,
      height: totalHeight,
      container,
      update(value: unknown) {
        const v = String(value ?? "");
        if (v !== currentDataUrl) {
          currentDataUrl = v;
          updateSprite(v);
          layoutButtons(fieldWidth);
        }
      },
      setWidth(fw: number) {
        fieldWidth = fw;
        drawPreview(fw);
        layoutButtons(fw);
      },
      destroy() {
        if (previewSprite) {
          container.removeChild(previewSprite);
          previewSprite.destroy();
          previewSprite = null;
        }
        // NOTE: do NOT call Assets.unload() here. the property tray is a consumer
        // of textures, not an owner. the widget that loaded this texture still
        // references it — unloading here would destroy a shared asset and crash
        // the renderer (alphaMode null error in StencilMaskPipe).
        container.destroy({ children: true });
      },
    };
  }
}

// ---------------------------------------------------------------------------
// utilities
// ---------------------------------------------------------------------------

/**
 * format a number as a hex color string: #rrggbb
 */
function formatHex(color: number): string {
  if (color === TRANSPARENT_COLOR) return "none";
  return "#" + (color & 0xffffff).toString(16).padStart(6, "0");
}

/**
 * format a select option value for display. for CSS font stacks like
 * "system-ui, sans-serif", show just the first family name.
 */
function formatSelectLabel(value: string): string {
  const first = value.split(",")[0].trim();
  return first || value;
}

import { ButtonContainer } from "@pixi/ui";
import { Container, Graphics, Text, type Application } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { WidgetRegistry } from "../widgets/widget-registry";
import type { CanvasStore } from "./canvas-store";
import type { CanvasMode, InputRouter } from "./input-router";

/**
 * pure PixiJS toolbar rendered at the top-center of the stage.
 *
 * provides:
 * - mode toggle (view/edit)
 * - widget palette (add widgets by type, visible in edit mode)
 * - delete button (remove selected widget, visible when selection exists in edit mode)
 *
 * no DOM elements are used. everything is rendered with pixi containers,
 * graphics, text, and @pixi/ui ButtonContainer for interactivity.
 */
export class Toolbar {
  readonly root: Container;

  private readonly app: Application;
  private readonly inputRouter: InputRouter;
  private readonly store: CanvasStore;
  private readonly registry: WidgetRegistry;
  private readonly theme: SkeinTheme;

  private readonly background: Graphics;
  private readonly modeBtn: ButtonContainer;
  private readonly modeBtnBg: Graphics;
  private readonly modeBtnText: Text;
  private readonly separator: Graphics;
  private readonly paletteButtons: ButtonContainer[] = [];
  private readonly deleteBtn: ButtonContainer;

  private unsubs: (() => void)[] = [];
  private widgetCounter = 0;

  constructor(
    app: Application,
    inputRouter: InputRouter,
    store: CanvasStore,
    registry: WidgetRegistry,
    theme: SkeinTheme
  ) {
    this.app = app;
    this.inputRouter = inputRouter;
    this.store = store;
    this.registry = registry;
    this.theme = theme;

    // root container lives on the stage at a high zIndex
    this.root = new Container();
    this.root.zIndex = 10000;
    this.root.eventMode = "static";

    // background drawn behind all buttons
    this.background = new Graphics();
    this.root.addChild(this.background);

    // mode toggle button
    const mode = this.createButton(inputRouter.mode);
    this.modeBtn = mode.btn;
    this.modeBtnBg = mode.bg;
    this.modeBtnText = mode.text;
    this.modeBtn.onPress.connect(() => {
      this.inputRouter.toggleMode();
    });
    this.root.addChild(this.modeBtn);

    // thin vertical separator
    this.separator = new Graphics();
    this.separator.rect(0, 0, 1, 16);
    this.separator.fill({ color: theme.frameBorder });
    this.root.addChild(this.separator);

    // widget palette buttons — one per registered factory
    for (const factory of this.registry.all()) {
      const palette = this.createButton(`+ ${factory.metadata.name}`);
      palette.btn.onPress.connect(() => {
        this.addWidget(factory.type);
      });
      palette.btn.visible = false;
      this.paletteButtons.push(palette.btn);
      this.root.addChild(palette.btn);
    }

    // delete button (red-tinted, hidden by default)
    const del = this.createButton("delete", {
      color: 0x3a1a1a,
      textColor: theme.error,
    });
    this.deleteBtn = del.btn;
    this.deleteBtn.visible = false;
    this.deleteBtn.onPress.connect(() => {
      const id = this.inputRouter.selectedWidgetId;
      if (id) {
        this.inputRouter.selectWidget(null);
        this.store.removeWidget(id);
      }
    });
    this.root.addChild(this.deleteBtn);

    // add root to stage
    app.stage.addChild(this.root);

    // subscribe to mode and selection changes
    this.unsubs.push(this.inputRouter.onModeChange((m) => this.updateMode(m)));
    this.unsubs.push(this.inputRouter.onSelectionChange((id) => this.updateSelection(id)));

    // set initial state then lay out
    this.updateMode(this.inputRouter.mode);
    this.updateSelection(this.inputRouter.selectedWidgetId);
    this.layout();
  }

  // -- button factory -------------------------------------------------------

  private createButton(
    label: string,
    options?: { color?: number; textColor?: number }
  ): { btn: ButtonContainer; bg: Graphics; text: Text } {
    const padding = { h: 8, v: 3 };

    const text = new Text({
      text: label,
      style: {
        fontFamily: this.theme.fontFamily,
        fontSize: this.theme.fontSizeSmall,
        fill: options?.textColor ?? this.theme.frameHeaderText,
      },
    });

    const bg = new Graphics();
    const width = text.width + padding.h * 2;
    const height = text.height + padding.v * 2;
    bg.roundRect(0, 0, width, height, 4);
    bg.fill({ color: options?.color ?? this.theme.frameBorder });

    const view = new Container();
    view.addChild(bg);
    text.x = padding.h;
    text.y = padding.v;
    view.addChild(text);

    const btn = new ButtonContainer(view);
    btn.cursor = "pointer";

    return { btn, bg, text };
  }

  // -- layout ----------------------------------------------------------------

  /** position all visible buttons horizontally and redraw the toolbar background. */
  private layout(): void {
    const gap = 6;
    const pad = { h: 8, v: 4 };
    let x = pad.h;

    // mode button is always visible
    this.modeBtn.x = x;
    this.modeBtn.y = pad.v;
    x += this.modeBtn.width + gap;

    // separator is always visible
    this.separator.x = x;
    this.separator.y = pad.v + (this.modeBtn.height - 16) / 2;
    x += this.separator.width + gap;

    // palette buttons (visible only in edit mode)
    for (const btn of this.paletteButtons) {
      if (!btn.visible) continue;
      btn.x = x;
      btn.y = pad.v;
      x += btn.width + gap;
    }

    // delete button (visible only when selected in edit mode)
    if (this.deleteBtn.visible) {
      this.deleteBtn.x = x;
      this.deleteBtn.y = pad.v;
      x += this.deleteBtn.width + gap;
    }

    // total toolbar size
    const totalWidth = x - gap + pad.h;
    const totalHeight = this.modeBtn.height + pad.v * 2;

    // redraw the toolbar background
    this.background.clear();
    this.background.roundRect(0, 0, totalWidth, totalHeight, 6);
    this.background.fill({ color: this.theme.frameHeaderBg, alpha: 0.92 });
    this.background.stroke({ color: this.theme.frameBorder, width: 1 });

    // center the toolbar horizontally, pin near top
    this.root.x = Math.round(this.app.screen.width / 2 - totalWidth / 2);
    this.root.y = 8;
  }

  // -- state updates ---------------------------------------------------------

  private updateMode(mode: CanvasMode): void {
    // update mode button label and resize its background
    this.modeBtnText.text = mode;

    const padding = { h: 8, v: 3 };
    const width = this.modeBtnText.width + padding.h * 2;
    const height = this.modeBtnText.height + padding.v * 2;
    this.modeBtnBg.clear();
    this.modeBtnBg.roundRect(0, 0, width, height, 4);
    this.modeBtnBg.fill({ color: this.theme.frameBorder });

    // toggle palette visibility
    const showPalette = mode === "edit";
    for (const btn of this.paletteButtons) {
      btn.visible = showPalette;
    }

    // hide delete when leaving edit mode
    if (mode !== "edit") {
      this.deleteBtn.visible = false;
    }

    this.layout();
  }

  private updateSelection(id: string | null): void {
    this.deleteBtn.visible = id !== null && this.inputRouter.isEditMode;
    this.layout();
  }

  // -- widget creation -------------------------------------------------------

  /** add a widget of the given type at a default staggered position. */
  private addWidget(type: string): void {
    this.widgetCounter++;
    const id = `widget-${Date.now()}-${this.widgetCounter}`;
    this.store.addWidget({
      id,
      type,
      x: 100 + this.widgetCounter * 20,
      y: 100 + this.widgetCounter * 20,
      width: 200,
      height: 150,
      zIndex: this.widgetCounter,
      props: {},
      collapsed: false,
      docId: null,
    });
  }

  // -- cleanup ---------------------------------------------------------------

  /** unsubscribe from all listeners and remove the toolbar from the stage. */
  destroy(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.root.destroy({ children: true });
  }
}

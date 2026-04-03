import { ButtonContainer } from "@pixi/ui";
import { Container, Graphics, Text, type Application } from "pixi.js";
import type { SkeinTheme } from "../theme/skein-theme";
import type { WidgetRegistry } from "../widgets/widget-registry";
import type { CanvasStore } from "./canvas-store";
import type { CanvasMode, InputRouter } from "./input-router";

/**
 * pure PixiJS toolbar rendered at the top-right of the stage.
 *
 * provides:
 * - mode toggle (view/edit)
 * - "+" button that opens a flyout menu of widget types (visible in edit mode)
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
  private readonly addBtn: ButtonContainer;
  private readonly deleteBtn: ButtonContainer;

  // flyout menu state
  private readonly flyout: Container;
  private readonly flyoutBg: Graphics;
  private flyoutOpen = false;
  private stageDismissHandler: ((e: any) => void) | null = null;

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

    // mode toggle button — shows the action (opposite of current mode)
    const modeLabel = inputRouter.mode === "view" ? "edit" : "view";
    const mode = this.createButton(modeLabel);
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

    // "+" button to open the widget flyout
    const add = this.createButton("+", { color: theme.accent });
    this.addBtn = add.btn;
    this.addBtn.visible = false;
    this.addBtn.onPress.connect(() => {
      this.toggleFlyout();
    });
    this.root.addChild(this.addBtn);

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

    // flyout menu container (hidden by default)
    this.flyout = new Container();
    this.flyout.visible = false;
    this.flyout.eventMode = "static";
    this.flyout.zIndex = 10001;

    this.flyoutBg = new Graphics();
    this.flyout.addChild(this.flyoutBg);

    this.buildFlyoutItems();
    this.root.addChild(this.flyout);

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
      resolution: this.theme.textResolution,
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

  // -- flyout ----------------------------------------------------------------

  /** build the vertical list of widget type entries inside the flyout. */
  private buildFlyoutItems(): void {
    const factories = this.registry.all();
    const itemPadH = 10;
    const itemPadV = 6;
    const itemGap = 2;
    let maxItemWidth = 0;
    let y = itemPadV;

    const items: Container[] = [];

    for (const factory of factories) {
      const item = new Container();
      item.eventMode = "static";
      item.cursor = "pointer";

      // name text
      const nameText = new Text({
        text: factory.metadata.name,
        style: {
          fontFamily: this.theme.fontFamily,
          fontSize: this.theme.fontSizeSmall,
          fill: this.theme.frameHeaderText,
        },
        resolution: this.theme.textResolution,
      });
      nameText.x = Math.round(itemPadH);
      nameText.y = Math.round(itemPadV);

      let itemHeight = nameText.height + itemPadV * 2;

      // optional description text
      let descText: Text | null = null;
      if (factory.metadata.description) {
        descText = new Text({
          text: factory.metadata.description,
          style: {
            fontFamily: this.theme.fontFamily,
            fontSize: this.theme.fontSizeSmall - 1,
            fill: 0x808080,
          },
          resolution: this.theme.textResolution,
        });
        descText.x = Math.round(itemPadH);
        descText.y = Math.round(nameText.y + nameText.height + 2);
        itemHeight = descText.y + descText.height + itemPadV;
      }

      const textWidth = Math.max(nameText.width, descText ? descText.width : 0);
      const itemWidth = textWidth + itemPadH * 2;
      if (itemWidth > maxItemWidth) {
        maxItemWidth = itemWidth;
      }

      // hover background (drawn later once we know the max width)
      const hoverBg = new Graphics();
      item.addChild(hoverBg);
      item.addChild(nameText);
      if (descText) {
        item.addChild(descText);
      }

      // store dimensions for later background drawing
      (item as any)._itemHeight = itemHeight;
      (item as any)._hoverBg = hoverBg;

      item.y = Math.round(y);
      y += itemHeight + itemGap;

      // click handler: add widget and close flyout
      const widgetType = factory.type;
      item.on("pointerdown", (e: any) => {
        e.stopPropagation();
        this.addWidget(widgetType);
        this.closeFlyout();
      });

      // hover effects
      item.on("pointerover", () => {
        hoverBg.clear();
        hoverBg.roundRect(0, 0, maxItemWidth, (item as any)._itemHeight, 4);
        hoverBg.fill({ color: this.theme.accent, alpha: 0.15 });
      });
      item.on("pointerout", () => {
        hoverBg.clear();
      });

      items.push(item);
      this.flyout.addChild(item);
    }

    // now draw all hover backgrounds at the correct max width and draw the flyout bg
    const flyoutPad = 4;
    const flyoutWidth = maxItemWidth + flyoutPad * 2;
    const flyoutHeight = y - itemGap + itemPadV + flyoutPad;

    // offset items horizontally for flyout padding
    for (const item of items) {
      item.x = flyoutPad;
      // update the stored maxItemWidth for hover bg drawing
      const hoverBg = (item as any)._hoverBg as Graphics;
      const h = (item as any)._itemHeight as number;
      // pre-draw transparent so the hit area is correct
      hoverBg.roundRect(0, 0, maxItemWidth, h, 4);
      hoverBg.fill({ color: 0x000000, alpha: 0 });
    }

    this.flyoutBg.clear();
    this.flyoutBg.roundRect(0, 0, flyoutWidth, flyoutHeight, 6);
    this.flyoutBg.fill({ color: this.theme.toolbarBg, alpha: 0.96 });
    this.flyoutBg.stroke({ color: this.theme.toolbarBorder, width: 1 });
  }

  /** position the flyout so it stays fully within the visible viewport. */
  private positionFlyout(): void {
    const margin = 8;
    const vv = window.visualViewport;
    const screenW = vv ? vv.width : window.innerWidth;
    const screenH = vv ? vv.height : window.innerHeight;
    const flyoutW = this.flyoutBg.width;
    const flyoutH = this.flyoutBg.height;

    // preferred position: below the "+" button, right-aligned to its right edge
    const addBtnRight = this.addBtn.x + this.addBtn.width;
    let x = addBtnRight - flyoutW;
    let y = this.addBtn.y + this.addBtn.height + 4;

    // clamp so the flyout stays within screen bounds.
    // convert local coords to screen coords, clamp, convert back.
    // screen position = root position + local position.

    // right edge: root.x + x + flyoutW <= screenW - margin
    const maxX = screenW - margin - this.root.x - flyoutW;
    // left edge: root.x + x >= margin
    const minX = margin - this.root.x;
    x = Math.max(minX, Math.min(maxX, x));

    // bottom edge: root.y + y + flyoutH <= screenH - margin
    const maxY = screenH - margin - this.root.y - flyoutH;
    if (y > maxY) {
      // try flipping above the toolbar instead of below
      const aboveY = -flyoutH - 4;
      if (this.root.y + aboveY >= margin) {
        y = aboveY;
      } else {
        // just clamp to the max
        y = Math.max(0, maxY);
      }
    }

    this.flyout.x = Math.round(x);
    this.flyout.y = Math.round(y);
  }

  /** toggle the flyout open or closed. */
  private toggleFlyout(): void {
    if (this.flyoutOpen) {
      this.closeFlyout();
    } else {
      this.openFlyout();
    }
  }

  /** open the flyout and attach a stage dismiss listener. */
  private openFlyout(): void {
    if (this.flyoutOpen) return;
    this.flyoutOpen = true;
    this.flyout.visible = true;

    this.positionFlyout();

    // dismiss when clicking outside — use a one-shot pointerdown on the stage.
    // delay attachment by a frame so the current press event doesn't immediately
    // trigger the dismiss handler.
    requestAnimationFrame(() => {
      this.stageDismissHandler = (e: any) => {
        // don't close if the click landed inside the flyout itself
        // (item handlers will close it after adding a widget)
        let target = e.target;
        while (target) {
          if (target === this.flyout || target === this.addBtn) return;
          target = target.parent;
        }
        this.closeFlyout();
      };
      this.app.stage.on("pointerdown", this.stageDismissHandler);
    });
  }

  /** close the flyout and remove the stage dismiss listener. */
  private closeFlyout(): void {
    if (!this.flyoutOpen) return;
    this.flyoutOpen = false;
    this.flyout.visible = false;

    if (this.stageDismissHandler) {
      this.app.stage.off("pointerdown", this.stageDismissHandler);
      this.stageDismissHandler = null;
    }
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

    // separator: only show when there are visible buttons after it
    const hasButtonsAfterSeparator = this.addBtn.visible || this.deleteBtn.visible;
    this.separator.visible = hasButtonsAfterSeparator;
    if (hasButtonsAfterSeparator) {
      this.separator.x = x;
      this.separator.y = pad.v + (this.modeBtn.height - 16) / 2;
      x += this.separator.width + gap;
    }

    // "+" button (visible only in edit mode)
    if (this.addBtn.visible) {
      this.addBtn.x = x;
      this.addBtn.y = pad.v;
      x += this.addBtn.width + gap;
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
    this.background.fill({ color: this.theme.toolbarBg, alpha: 0.92 });
    this.background.stroke({ color: this.theme.toolbarBorder, width: 1 });

    // pin to top-right with margin
    const margin = 8;
    this.root.x = Math.round(this.app.screen.width - totalWidth - margin);
    this.root.y = margin;

    // reposition flyout if it's open (re-run the full positioning logic)
    if (this.flyoutOpen) {
      this.positionFlyout();
    }
  }

  // -- state updates ---------------------------------------------------------

  private updateMode(mode: CanvasMode): void {
    // update mode button label — shows the action (opposite of current mode)
    this.modeBtnText.text = mode === "view" ? "edit" : "view";

    const padding = { h: 8, v: 3 };
    const width = this.modeBtnText.width + padding.h * 2;
    const height = this.modeBtnText.height + padding.v * 2;
    this.modeBtnBg.clear();
    this.modeBtnBg.roundRect(0, 0, width, height, 4);
    this.modeBtnBg.fill({ color: this.theme.frameBorder });

    // toggle add button visibility based on current mode
    const isEdit = mode === "edit";
    this.addBtn.visible = isEdit;

    // hide delete when leaving edit mode
    if (!isEdit) {
      this.deleteBtn.visible = false;
      this.closeFlyout();
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
    this.closeFlyout();
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];
    this.root.destroy({ children: true });
  }
}

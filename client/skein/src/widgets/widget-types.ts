import type { Container } from "pixi.js";
import { z } from "zod";
import type { CanvasStore } from "../canvas/canvas-store";
import type { KeyboardDriver } from "./keyboard-driver";

/**
 * sentinel value representing a transparent color in color props.
 * widgets should check for this value and use alpha: 0 when drawing.
 */
export const TRANSPARENT_COLOR = -1;

/**
 * convert a color value to a safe PixiJS-compatible number.
 * returns 0x000000 for the transparent sentinel (-1), otherwise passes through.
 * use this anywhere a color flows into PixiJS Text style `fill` or other APIs
 * that go through the Color class (which rejects -1).
 */
export function safeColor(color: number): number {
  return color === TRANSPARENT_COLOR ? 0x000000 : color;
}

/**
 * check whether a color value represents transparent.
 */
export function isTransparent(color: number): boolean {
  return color === TRANSPARENT_COLOR;
}

/**
 * an action button that a widget exposes in the property tray.
 * unlike header actions (which live in the frame header bar), widget actions
 * appear as buttons in the prop tray flyout when the widget is selected.
 */
export interface WidgetAction {
  /** unique identifier for this action */
  id: string;
  /** display label shown on the button */
  label: string;
  /** click handler */
  onClick: () => void;
}

/**
 * a button or info badge that a widget can inject into the frame header.
 * widgets return these from create() and/or update them dynamically via
 * setHeaderActions() on the mount context.
 */
export interface HeaderAction {
  /** unique identifier for this action (used for diffing / updates) */
  id: string;
  /** display label shown in the header button */
  label: string;
  /** if true, rendered as a non-clickable info badge (e.g. item count) */
  isInfo?: boolean;
  /** click handler — ignored when isInfo is true */
  onClick?: () => void;
}

/**
 * compact display info returned by a widget factory for rendering
 * inside a bin widget. used to show minimized representations of
 * widgets without mounting them.
 */
export interface CompactInfo {
  /** short display text (filename, title, widget name, etc.) */
  label: string;
  /** small image for the card face. data URL or asset URL. */
  thumbnailUrl?: string;
  /** accent color for spine/border tinting (pixi hex number) */
  accentColor?: number;
}

/**
 * a validated, Automerge-backed document facade for widget state.
 * widgets interact with their state exclusively through this interface.
 * they never see Automerge directly.
 */
export interface WidgetDoc<S extends z.ZodType> {
  /** the current validated state (Zod-parsed on every read) */
  readonly current: z.infer<S>;
  /** mutate the underlying Automerge document */
  change(fn: (draft: z.infer<S>) => void): void;
  /** subscribe to state changes. returns an unsubscribe function. */
  on(event: "change", handler: (state: z.infer<S>) => void): () => void;
}

/**
 * context passed to a widget factory's create() function.
 * contains everything a widget needs to render and interact with its state.
 */
export interface WidgetMountContext<S extends z.ZodType = z.ZodType> {
  /** the Zod-validated document facade for this widget's state */
  doc: WidgetDoc<S>;
  /** the width allocated by the canvas frame */
  width: number;
  /** the height allocated by the canvas frame */
  height: number;
  /** the keyboard driver for text input / IME. call acquire() to claim focus. */
  keyboard: KeyboardDriver;
  /** the widget's unique ID in the canvas store */
  widgetId: string;
  /** the canvas DOM element — used for positioning DOM overlays (e.g. textarea editing) */
  canvasElement: HTMLCanvasElement;
  /** the canvas store — provides read/write access to canvas-level metadata.
   *  available on regular canvases; may be undefined for headless or test contexts. */
  canvasStore?: CanvasStore;
  /** dynamically update the custom header actions shown in the widget frame.
   *  call this whenever the action labels or set of actions changes (e.g. item
   *  count updated, snatch progress). provided by the widget manager at mount time. */
  setHeaderActions?: (actions: HeaderAction[]) => void;
}

/**
 * handler for widgets that accept drop operations (e.g. bins).
 * the widget manager checks live widgets for this during frame drags
 * and forwards hover/drop events.
 */
export interface DropTargetHandler {
  /** test if a world-space point falls inside this widget's drop zone */
  hitTest(worldX: number, worldY: number): boolean;
  /** called each frame while a dragged widget hovers over this target */
  onHover(worldX: number, worldY: number, draggedWidgetId: string): void;
  /** called when the dragged widget leaves this target's zone */
  onLeave(): void;
  /** called when a widget is dropped on this target. return true if the
   *  drop was consumed (widget will be nested). return false to let the
   *  normal drop flow proceed. */
  onDrop(widgetId: string, worldX: number, worldY: number): boolean;
}

/**
 * the object returned by a widget factory's create() function.
 * the canvas uses this to manage the widget's lifecycle.
 */
export interface WidgetController {
  /** the PixiJS container to add to the stage */
  container: Container;
  /** called when the widget is removed from the canvas */
  destroy: () => void;
  /** called when the canvas frame resizes. optional. */
  resize?: (width: number, height: number) => void;
  /** declare input/output ports for dataflow wiring between widgets (future) */
  ports?: () => WidgetPortDeclaration;
  /** optional drop target handler — when present, the widget manager will
   *  check this widget for drop overlap during frame drags. used by bins
   *  to accept widgets being dragged onto them. */
  dropTarget?: DropTargetHandler;
  /** optional: called when the widget enters or leaves maximized (full-viewport) mode.
   *  widgets can use this to render richer UI when they have more space. */
  setMaximized?: (maximized: boolean) => void;
  /** optional initial header actions to inject into the frame header bar.
   *  these are set once at mount time; use ctx.setHeaderActions() for dynamic updates. */
  headerActions?: HeaderAction[];
  /** optional action buttons shown in the property tray when this widget is selected.
   *  used for widget-specific operations like "tidy" in the bin widget. */
  widgetActions?: WidgetAction[];
}

/**
 * metadata about a widget type, used for the palette and registry.
 */
export interface WidgetMetadata {
  name: string;
  description?: string;
  version: string;
  icon?: string;
  category?: string;
  /** hide this widget from the palette (e.g. programmatically-spawned widgets) */
  hidden?: boolean;
  /** singleton widgets have a well-known ID and cannot be deleted via the
   *  frame close button. the flyout hides them when already on the canvas.
   *  use for persistent narthex widgets like profile and friends. */
  singleton?: boolean;
  /** well-known widget ID used when `singleton` is true. the toolbar uses
   *  this instead of a random UUID so the per-widget automerge doc persists
   *  across close/reopen cycles. */
  singletonId?: string;
  /** unique widgets are hidden from the flyout when one is already on the canvas,
   *  but unlike singletons they can still be deleted. use for widgets where only
   *  one instance makes sense (e.g. trash can) but the user may remove and re-add. */
  unique?: boolean;
  /** when true, closing this widget un-parents its children back to the canvas
   *  instead of cascade-deleting them. use for container widgets whose contents
   *  should survive the container being removed (e.g. trash can — cards spill
   *  out onto the narthex instead of being permanently deleted). */
  preserveChildren?: boolean;
  /** default width when placing the widget on the canvas */
  defaultWidth?: number;
  /** default height when placing the widget on the canvas */
  defaultHeight?: number;
  /** whether this widget can be maximized via the frame header button.
   *  defaults to true when omitted. set to false for widgets that should
   *  never fill the canvas (e.g. canvas cards). */
  maximizable?: boolean;
}

/**
 * a widget factory defines a type of widget that can be placed on the canvas.
 * stateless widgets omit the schema field.
 * stateful widgets provide a Zod schema for their internal state.
 */
export interface WidgetFactory<S extends z.ZodType = z.ZodType> {
  /** unique type identifier (e.g., "counter", "hello-world") */
  type: string;
  /** metadata for display in the widget palette */
  metadata: WidgetMetadata;
  /** Zod schema for the widget's internal state. omit for stateless widgets. */
  schema?: S;
  /** editable properties shown in the property editor panel when this widget is selected in edit mode */
  editableProps?: WidgetPropDef[];
  /**
   * extract compact display info from the widget's state.
   * used by bin widgets to render children in minimized form.
   * does not require the widget to be mounted — pure function of state.
   */
  getCompactInfo?: (state: z.infer<S>) => CompactInfo;
  /**
   * called when a compact card for this widget is tapped inside a bin.
   * pure function of state — the widget is not mounted when this fires.
   * use for navigation or other side-effects (e.g., canvas-card opens the canvas).
   * if omitted, tapping a compact card does nothing.
   */
  onCompactActivate?: (state: z.infer<S>) => void;
  /**
   * called before a widget is closed via the property tray delete button or
   * frame close. if provided and returns true, the default close behavior
   * (cascade-delete descendants + remove) is skipped — the factory handles
   * the close itself.
   *
   * use for widgets that need custom close semantics, e.g. canvas-card
   * redirects close to soft-delete + move to trash instead of hard-deleting
   * the linked canvas document.
   */
  onBeforeClose?: (widgetId: string, store: CanvasStore) => boolean;
  /** create a widget instance given a mount context */
  create(ctx: WidgetMountContext<S>): WidgetController;
}

/**
 * definition for a single editable property shown in the property editor.
 */
export interface WidgetPropDef {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "color" | "select" | "image";
  options?: string[];
  default?: unknown;
  /** for image props: maximum output width in pixels */
  imageMaxWidth?: number;
  /** for image props: maximum output height in pixels */
  imageMaxHeight?: number;
  /** for image props: center-crop to square before resizing */
  imageCropSquare?: boolean;
  /** only show this prop when another prop has a specific value */
  visibleWhen?: { key: string; value: unknown };
}

/**
 * declares the input and output ports for a widget.
 * ports enable dataflow connections between widgets on the canvas.
 */
export interface WidgetPortDeclaration {
  inputs?: PortDef[];
  outputs?: PortDef[];
}

/**
 * definition of a single port on a widget.
 */
export interface PortDef {
  /** unique name within the widget (e.g., "album_list", "query_result") */
  name: string;
  /** human-readable label shown in the UI */
  label: string;
  /** type tag for compatibility checking between connected ports */
  dataType: string;
}

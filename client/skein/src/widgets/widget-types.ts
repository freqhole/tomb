import type { Container } from "pixi.js";
import { z } from "zod";
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
  /** default width when placing the widget on the canvas */
  defaultWidth?: number;
  /** default height when placing the widget on the canvas */
  defaultHeight?: number;
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

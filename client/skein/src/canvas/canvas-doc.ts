/**
 * a single widget's entry in the canvas document.
 * this describes the widget's position, size, type, and props
 * as seen by the canvas layout system.
 *
 * the widget's internal state lives in a separate per-widget document
 * (referenced by docId).
 */
export interface WidgetEntry {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  props: Record<string, unknown>;
  collapsed: boolean;
  /** automerge document id for the widget's internal state. null if stateless. */
  docId: string | null;
}

/**
 * the top-level canvas document stored in Automerge.
 * contains the layout of all widgets on the canvas.
 */
export interface CanvasDocument {
  version: number;
  widgets: Record<string, WidgetEntry>;
}

/**
 * create an empty canvas document with default values.
 */
export function emptyCanvasDoc(): CanvasDocument {
  return {
    version: 1,
    widgets: {},
  };
}

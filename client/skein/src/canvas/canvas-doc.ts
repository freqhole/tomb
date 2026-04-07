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
  /** user-editable display title shown in the frame header.
   *  when empty or undefined, the frame falls back to the factory metadata name. */
  title?: string;
  /** automerge document id for the widget's internal state. null if stateless. */
  docId: string | null;
  /** if set, this widget is nested inside another widget (e.g. a bin).
   *  the parent widget handles rendering; the widget manager skips mounting. */
  parentId?: string | null;
}

/** a peer that has connected to this canvas via P2P. */
export interface CanvasPeer {
  nodeId: string;
  joinedAt: string;
}

/**
 * the top-level canvas document stored in Automerge.
 * contains the layout of all widgets on the canvas.
 */
export interface CanvasDocument {
  version: number;
  widgets: Record<string, WidgetEntry>;
  /** display title of the canvas */
  title: string;
  /** short description of the canvas */
  description: string;
  /** ISO date string when the canvas was created */
  createdAt: string;
  /** ISO date string when the canvas was last modified */
  lastModified: string;
  /** tag color for the canvas (used for visual theming on narthex cards). 0 means no color set. */
  color: number;
  /** data URL for a preview/thumbnail image */
  previewUrl: string;
  /** peers that have connected to this canvas — used to re-establish P2P on reload */
  peers: Record<string, CanvasPeer>;
}

/**
 * create an empty canvas document with default values.
 */
export function emptyCanvasDoc(): CanvasDocument {
  return {
    version: 1,
    widgets: {},
    title: "",
    description: "",
    createdAt: "",
    lastModified: "",
    color: 0,
    previewUrl: "",
    peers: {},
  };
}

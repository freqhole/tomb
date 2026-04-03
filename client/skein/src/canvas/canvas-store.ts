import type { DocHandle, DocumentId, PeerId, Repo } from "@automerge/automerge-repo";
import type { CanvasDocument, WidgetEntry } from "./canvas-doc";
import { emptyCanvasDoc } from "./canvas-doc";

/** handler signature for ephemeral message listeners */
export type EphemeralHandler = (senderId: string, data: Uint8Array) => void;

/**
 * wraps the canvas automerge document with typed mutation methods.
 * this is the primary interface for reading and modifying the canvas layout.
 */
export class CanvasStore {
  /** the underlying automerge document handle. exposed for initCanvas and sync. */
  readonly handle: DocHandle<CanvasDocument>;

  private constructor(handle: DocHandle<CanvasDocument>) {
    this.handle = handle;
  }

  /**
   * create a new canvas with an empty document.
   */
  static create(repo: Repo): CanvasStore {
    const handle = repo.create<CanvasDocument>(emptyCanvasDoc());
    return new CanvasStore(handle);
  }

  /**
   * open an existing canvas document by ID.
   */
  static async open(repo: Repo, docId: DocumentId): Promise<CanvasStore> {
    const handle = await repo.find<CanvasDocument>(docId);
    return new CanvasStore(handle);
  }

  /** get the current document state. */
  doc(): CanvasDocument {
    return this.handle.doc() ?? emptyCanvasDoc();
  }

  /** get a widget entry by ID. returns null if not found. */
  getWidget(id: string): WidgetEntry | null {
    return this.doc().widgets[id] ?? null;
  }

  /** return the number of widgets in the document. */
  widgetCount(): number {
    return Object.keys(this.doc().widgets).length;
  }

  /** return all widget entries. */
  allWidgets(): WidgetEntry[] {
    return Object.values(this.doc().widgets);
  }

  /**
   * add a widget to the canvas. returns the widget's ID.
   * the entry must include an `id` field.
   */
  addWidget(entry: WidgetEntry): string {
    this.handle.change((doc) => {
      doc.widgets[entry.id] = { ...entry };
    });
    return entry.id;
  }

  /** remove a widget by ID. no-op if the widget doesn't exist. */
  removeWidget(id: string): void {
    this.handle.change((doc) => {
      delete doc.widgets[id];
    });
  }

  /** move a widget to a new position. */
  moveWidget(id: string, x: number, y: number): void {
    this.handle.change((doc) => {
      const widget = doc.widgets[id];
      if (widget) {
        widget.x = x;
        widget.y = y;
      }
    });
  }

  /** resize a widget. */
  resizeWidget(id: string, width: number, height: number): void {
    this.handle.change((doc) => {
      const widget = doc.widgets[id];
      if (widget) {
        widget.width = width;
        widget.height = height;
      }
    });
  }

  /** update the z-index of a widget. */
  setZIndex(id: string, zIndex: number): void {
    this.handle.change((doc) => {
      const widget = doc.widgets[id];
      if (widget) {
        widget.zIndex = zIndex;
      }
    });
  }

  /** toggle the collapsed state of a widget. */
  setCollapsed(id: string, collapsed: boolean): void {
    this.handle.change((doc) => {
      const widget = doc.widgets[id];
      if (widget) {
        widget.collapsed = collapsed;
      }
    });
  }

  /** set the docId for a widget's per-widget automerge document. */
  setDocId(widgetId: string, docId: string): void {
    this.handle.change((doc) => {
      const widget = doc.widgets[widgetId];
      if (widget) {
        widget.docId = docId;
      }
    });
  }

  /** subscribe to document changes. returns an unsubscribe function. */
  onChange(handler: (doc: CanvasDocument) => void): () => void {
    const listener = () => {
      handler(this.doc());
    };
    this.handle.on("change", listener);
    return () => {
      this.handle.off("change", listener);
    };
  }

  /**
   * broadcast an ephemeral message to all connected peers.
   * used by the presence manager for cursors, locks, and online status.
   * ephemeral messages are not persisted — they exist only in transit.
   */
  broadcastEphemeral(data: Uint8Array): void {
    this.handle.broadcast(data);
  }

  /**
   * subscribe to ephemeral messages from other peers.
   * the senderId is the automerge-repo peerId of the sender.
   * returns an unsubscribe function.
   */
  onEphemeral(handler: EphemeralHandler): () => void {
    const listener = (event: { senderId: PeerId; message: unknown }) => {
      handler(event.senderId as string, event.message as Uint8Array);
    };
    this.handle.on("ephemeral-message", listener);
    return () => {
      this.handle.off("ephemeral-message", listener);
    };
  }
}

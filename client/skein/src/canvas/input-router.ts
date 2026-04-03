/**
 * the two modes the canvas operates in.
 *
 * view mode: widgets receive pointer events, frames are minimal.
 * edit mode: canvas intercepts pointer events for drag/resize/select, frames show full chrome.
 */
export type CanvasMode = "view" | "edit";

type ModeListener = (mode: CanvasMode) => void;
type SelectionListener = (widgetId: string | null) => void;

/**
 * routes input events and manages canvas mode state.
 *
 * the input router is the central coordinator for:
 * - edit/view mode switching
 * - widget selection tracking
 * - keyboard shortcut handling
 *
 * other components subscribe to mode/selection changes
 * and update their visual state accordingly.
 */
export class InputRouter {
  private _mode: CanvasMode = "view";
  private _selectedWidgetId: string | null = null;
  private modeListeners: ModeListener[] = [];
  private selectionListeners: SelectionListener[] = [];
  private onDeleteWidget: ((id: string) => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.keydownHandler = this.handleKeyDown.bind(this);
    document.addEventListener("keydown", this.keydownHandler);
  }

  /** current canvas mode */
  get mode(): CanvasMode {
    return this._mode;
  }

  /** the currently selected widget id, or null if nothing selected */
  get selectedWidgetId(): string | null {
    return this._selectedWidgetId;
  }

  /** whether the canvas is in edit mode */
  get isEditMode(): boolean {
    return this._mode === "edit";
  }

  /** set the callback for when a widget should be deleted */
  setDeleteHandler(handler: (id: string) => void): void {
    this.onDeleteWidget = handler;
  }

  /** toggle between view and edit mode */
  toggleMode(): void {
    this.setMode(this._mode === "view" ? "edit" : "view");
  }

  /** set the canvas mode explicitly */
  setMode(mode: CanvasMode): void {
    if (this._mode === mode) return;
    this._mode = mode;

    // clear selection when switching to view mode
    if (mode === "view" && this._selectedWidgetId !== null) {
      this.selectWidget(null);
    }

    for (const listener of this.modeListeners) {
      listener(mode);
    }
  }

  /** select a widget by id, or null to deselect */
  selectWidget(id: string | null): void {
    if (this._selectedWidgetId === id) return;
    this._selectedWidgetId = id;

    for (const listener of this.selectionListeners) {
      listener(id);
    }
  }

  /** subscribe to mode changes. returns an unsubscribe function. */
  onModeChange(listener: ModeListener): () => void {
    this.modeListeners.push(listener);
    return () => {
      this.modeListeners = this.modeListeners.filter((l) => l !== listener);
    };
  }

  /** subscribe to selection changes. returns an unsubscribe function. */
  onSelectionChange(listener: SelectionListener): () => void {
    this.selectionListeners.push(listener);
    return () => {
      this.selectionListeners = this.selectionListeners.filter((l) => l !== listener);
    };
  }

  /** handle keyboard shortcuts */
  private handleKeyDown(e: KeyboardEvent): void {
    // ignore if focus is in an input/textarea
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    // 'e' key toggles edit mode
    if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.toggleMode();
      e.preventDefault();
      return;
    }

    // delete/backspace removes selected widget in edit mode
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      this._mode === "edit" &&
      this._selectedWidgetId !== null
    ) {
      const id = this._selectedWidgetId;
      this.selectWidget(null);
      if (this.onDeleteWidget) {
        this.onDeleteWidget(id);
      }
      e.preventDefault();
      return;
    }

    // escape deselects in edit mode
    if (e.key === "Escape" && this._mode === "edit") {
      this.selectWidget(null);
      e.preventDefault();
      return;
    }
  }

  /** clean up event listeners */
  destroy(): void {
    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
    this.modeListeners = [];
    this.selectionListeners = [];
    this.onDeleteWidget = null;
  }
}

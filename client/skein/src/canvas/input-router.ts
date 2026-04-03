/**
 * the two modes the canvas operates in.
 *
 * view mode: widgets receive pointer events, frames are minimal.
 * edit mode: canvas intercepts pointer events for drag/resize/select, frames show full chrome.
 */
export type CanvasMode = "view" | "edit";

type ModeListener = (mode: CanvasMode) => void;
type SelectionListener = (widgetId: string | null) => void;
type MultiSelectionListener = (ids: ReadonlySet<string>) => void;

/**
 * routes input events and manages canvas mode state.
 *
 * the input router is the central coordinator for:
 * - edit/view mode switching
 * - widget selection tracking (single and multi)
 * - keyboard shortcut handling
 *
 * other components subscribe to mode/selection changes
 * and update their visual state accordingly.
 *
 * multi-selection notes:
 * - `selectedWidgetId` returns the single selected widget (null if 0 or 2+).
 *   this is used by property tray and other single-widget-focused UI.
 * - `selectedWidgetIds` returns the full set of selected widgets.
 *   this is used by lasso, batch delete, batch drag, frame highlighting.
 * - `selectWidget(id)` does a single-select (clears any multi-select).
 * - `selectWidgets(ids)` does a multi-select (lasso result).
 * - `toggleWidgetInSelection(id)` adds/removes from multi-select (shift-click).
 */
export class InputRouter {
  private _mode: CanvasMode = "view";
  private _selectedWidgetId: string | null = null;
  private _selectedWidgetIds: Set<string> = new Set();

  private modeListeners: ModeListener[] = [];
  private selectionListeners: SelectionListener[] = [];
  private multiSelectionListeners: MultiSelectionListener[] = [];
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

  /**
   * the currently selected widget id, or null if nothing selected
   * (or if multiple widgets are selected — use selectedWidgetIds for multi).
   */
  get selectedWidgetId(): string | null {
    return this._selectedWidgetId;
  }

  /**
   * the full set of selected widget ids.
   * may contain 0, 1, or many entries.
   */
  get selectedWidgetIds(): ReadonlySet<string> {
    return this._selectedWidgetIds;
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

    // clear all selection when switching to view mode
    if (mode === "view" && this._selectedWidgetIds.size > 0) {
      this.selectWidget(null);
    }

    for (const listener of this.modeListeners) {
      listener(mode);
    }
  }

  /**
   * single-select a widget by id, or null to deselect everything.
   * clears any multi-selection.
   */
  selectWidget(id: string | null): void {
    const oldPrimary = this._selectedWidgetId;
    const hadMulti = this._selectedWidgetIds.size > 0;

    this._selectedWidgetIds.clear();
    if (id) {
      this._selectedWidgetIds.add(id);
    }
    this._selectedWidgetId = id;

    // notify single-selection listeners if the primary changed
    if (oldPrimary !== id) {
      for (const listener of this.selectionListeners) {
        listener(id);
      }
    }

    // notify multi-selection listeners if anything changed
    if (hadMulti || id !== null) {
      this.notifyMultiSelection();
    }
  }

  /**
   * multi-select a set of widgets (e.g. from lasso).
   * when exactly one widget is in the set, it also becomes the primary
   * selection (property tray will show). otherwise primary is null.
   */
  selectWidgets(ids: string[]): void {
    const oldPrimary = this._selectedWidgetId;

    this._selectedWidgetIds = new Set(ids);
    const primary = ids.length === 1 ? ids[0] : null;
    this._selectedWidgetId = primary;

    if (oldPrimary !== primary) {
      for (const listener of this.selectionListeners) {
        listener(primary);
      }
    }

    this.notifyMultiSelection();
  }

  /**
   * toggle a widget in/out of the multi-selection (shift-click).
   * when one widget remains, it becomes the primary selection.
   */
  toggleWidgetInSelection(id: string): void {
    const oldPrimary = this._selectedWidgetId;

    if (this._selectedWidgetIds.has(id)) {
      this._selectedWidgetIds.delete(id);
    } else {
      this._selectedWidgetIds.add(id);
    }

    // derive primary: only when exactly one is selected
    const primary = this._selectedWidgetIds.size === 1 ? [...this._selectedWidgetIds][0] : null;
    this._selectedWidgetId = primary;

    if (oldPrimary !== primary) {
      for (const listener of this.selectionListeners) {
        listener(primary);
      }
    }

    this.notifyMultiSelection();
  }

  /** subscribe to mode changes. returns an unsubscribe function. */
  onModeChange(listener: ModeListener): () => void {
    this.modeListeners.push(listener);
    return () => {
      this.modeListeners = this.modeListeners.filter((l) => l !== listener);
    };
  }

  /** subscribe to single-selection changes. returns an unsubscribe function. */
  onSelectionChange(listener: SelectionListener): () => void {
    this.selectionListeners.push(listener);
    return () => {
      this.selectionListeners = this.selectionListeners.filter((l) => l !== listener);
    };
  }

  /**
   * subscribe to multi-selection changes. returns an unsubscribe function.
   * the listener receives the full set of selected widget ids (may be empty).
   */
  onMultiSelectionChange(listener: MultiSelectionListener): () => void {
    this.multiSelectionListeners.push(listener);
    return () => {
      this.multiSelectionListeners = this.multiSelectionListeners.filter((l) => l !== listener);
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

    // delete/backspace removes selected widget(s) in edit mode
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      this._mode === "edit" &&
      this._selectedWidgetIds.size > 0
    ) {
      // snapshot ids before clearing selection
      const ids = [...this._selectedWidgetIds];
      this.selectWidget(null);
      if (this.onDeleteWidget) {
        for (const id of ids) {
          this.onDeleteWidget(id);
        }
      }
      e.preventDefault();
      return;
    }

    // escape deselects in edit mode
    if (e.key === "Escape" && this._mode === "edit") {
      if (this._selectedWidgetIds.size > 0) {
        this.selectWidget(null);
        e.preventDefault();
      }
      return;
    }
  }

  /** notify all multi-selection listeners */
  private notifyMultiSelection(): void {
    for (const listener of this.multiSelectionListeners) {
      listener(this._selectedWidgetIds);
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
    this.multiSelectionListeners = [];
    this.onDeleteWidget = null;
  }
}

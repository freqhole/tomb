type SelectionListener = (widgetId: string | null) => void;
type MultiSelectionListener = (ids: ReadonlySet<string>) => void;

/**
 * routes input events and manages selection state.
 *
 * the input router is the central coordinator for:
 * - widget selection tracking (single and multi)
 * - keyboard shortcut handling
 *
 * other components subscribe to selection changes
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
  private _selectedWidgetId: string | null = null;
  private _selectedWidgetIds: Set<string> = new Set();

  private selectionListeners: SelectionListener[] = [];
  private multiSelectionListeners: MultiSelectionListener[] = [];
  private onDeleteWidget: ((id: string) => void) | null = null;
  private bringForwardHandler: ((id: string) => void) | null = null;
  private sendBackwardHandler: ((id: string) => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    this.keydownHandler = this.handleKeyDown.bind(this);
    document.addEventListener("keydown", this.keydownHandler);
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

  /** set the callback for when a widget should be deleted */
  setDeleteHandler(handler: (id: string) => void): void {
    this.onDeleteWidget = handler;
  }

  /** set the callback for bringing a widget forward in z-order */
  setBringForwardHandler(handler: (id: string) => void): void {
    this.bringForwardHandler = handler;
  }

  /** set the callback for sending a widget backward in z-order */
  setSendBackwardHandler(handler: (id: string) => void): void {
    this.sendBackwardHandler = handler;
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

    // delete/backspace removes selected widget(s)
    if ((e.key === "Delete" || e.key === "Backspace") && this._selectedWidgetIds.size > 0) {
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

    // ] brings selected widget(s) forward in z-order
    if (e.key === "]" && this._selectedWidgetIds.size > 0 && this.bringForwardHandler) {
      for (const id of this._selectedWidgetIds) {
        this.bringForwardHandler(id);
      }
      e.preventDefault();
      return;
    }

    // [ sends selected widget(s) backward in z-order
    if (e.key === "[" && this._selectedWidgetIds.size > 0 && this.sendBackwardHandler) {
      for (const id of this._selectedWidgetIds) {
        this.sendBackwardHandler(id);
      }
      e.preventDefault();
      return;
    }

    // escape deselects all
    if (e.key === "Escape") {
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
    this.selectionListeners = [];
    this.multiSelectionListeners = [];
    this.onDeleteWidget = null;
    this.bringForwardHandler = null;
    this.sendBackwardHandler = null;
  }
}

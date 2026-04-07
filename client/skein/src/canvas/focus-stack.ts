/**
 * a single entry in the focus stack. captures the viewport state
 * at the moment a widget was maximized so we can restore it later.
 */
export interface FocusEntry {
  widgetId: string;
  /** viewport state before maximizing */
  savedViewport: { x: number; y: number; zoom: number };
  /** the widget's original frame size so we can restore on pop */
  savedSize: { width: number; height: number };
}

/**
 * manages a LIFO stack of maximized widgets.
 *
 * each maximize pushes a FocusEntry, each restore pops one.
 * the stack is purely a presentation concern — no data model changes.
 */
export class FocusStack {
  private readonly stack: FocusEntry[] = [];

  /** push a new entry onto the stack */
  push(entry: FocusEntry): void {
    this.stack.push(entry);
  }

  /** pop the top entry. returns undefined if the stack is empty. */
  pop(): FocusEntry | undefined {
    return this.stack.pop();
  }

  /** peek at the top entry without removing it */
  peek(): FocusEntry | undefined {
    return this.stack.at(-1);
  }

  /** whether the stack has any entries */
  get isEmpty(): boolean {
    return this.stack.length === 0;
  }

  /** the number of entries currently on the stack */
  get depth(): number {
    return this.stack.length;
  }

  /** return a shallow copy of all entries, bottom-to-top (oldest first). */
  get entries(): ReadonlyArray<FocusEntry> {
    return [...this.stack];
  }

  /** check if a specific widget is currently maximized (anywhere in the stack) */
  hasWidget(widgetId: string): boolean {
    return this.stack.some((e) => e.widgetId === widgetId);
  }

  /** clear the entire stack (used during teardown) */
  clear(): void {
    this.stack.length = 0;
  }
}

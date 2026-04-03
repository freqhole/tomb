import type { CanvasDocument, WidgetEntry } from "../canvas/canvas-doc";

let _entryCounter = 0;

/**
 * create a valid WidgetEntry with sensible defaults.
 * override any field via the overrides parameter.
 */
export function widgetEntry(overrides: Partial<WidgetEntry> = {}): WidgetEntry {
  _entryCounter++;
  return {
    id: `test-widget-${_entryCounter}`,
    type: "hello-world",
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    zIndex: 1,
    props: {},
    collapsed: false,
    docId: null,
    ...overrides,
  };
}

/**
 * reset the entry counter between tests.
 * call this in beforeEach if you need deterministic ids.
 */
export function resetEntryCounter(): void {
  _entryCounter = 0;
}

/**
 * create a canvas document with N widgets pre-populated.
 */
export function canvasDoc(
  widgetCount: number = 0,
  widgetOverrides?: (index: number) => Partial<WidgetEntry>,
): CanvasDocument {
  const widgets: Record<string, WidgetEntry> = {};
  for (let i = 0; i < widgetCount; i++) {
    const entry = widgetEntry({
      zIndex: i + 1,
      x: 100 + i * 220,
      ...widgetOverrides?.(i),
    });
    widgets[entry.id] = entry;
  }
  return {
    version: 1,
    widgets,
  };
}

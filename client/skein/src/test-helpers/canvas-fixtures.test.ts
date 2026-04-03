import { beforeEach, describe, expect, it } from "vitest";
import { canvasDoc, resetEntryCounter, widgetEntry } from "./canvas-fixtures";

describe("widgetEntry", () => {
  beforeEach(() => {
    resetEntryCounter();
  });

  it("creates an entry with sensible defaults", () => {
    const entry = widgetEntry();
    expect(entry.type).toBe("hello-world");
    expect(entry.x).toBe(100);
    expect(entry.y).toBe(100);
    expect(entry.width).toBe(200);
    expect(entry.height).toBe(150);
    expect(entry.zIndex).toBe(1);
    expect(entry.collapsed).toBe(false);
    expect(entry.docId).toBeNull();
    expect(entry.props).toEqual({});
  });

  it("generates unique ids", () => {
    const a = widgetEntry();
    const b = widgetEntry();
    expect(a.id).not.toBe(b.id);
  });

  it("accepts overrides", () => {
    const entry = widgetEntry({ type: "counter", x: 500, y: 300 });
    expect(entry.type).toBe("counter");
    expect(entry.x).toBe(500);
    expect(entry.y).toBe(300);
    expect(entry.height).toBe(150); // default preserved
  });

  it("resetEntryCounter resets ids", () => {
    const a = widgetEntry();
    resetEntryCounter();
    const b = widgetEntry();
    expect(a.id).toBe(b.id);
  });
});

describe("canvasDoc", () => {
  beforeEach(() => {
    resetEntryCounter();
  });

  it("creates empty doc by default", () => {
    const doc = canvasDoc();
    expect(doc.version).toBe(1);
    expect(Object.keys(doc.widgets)).toHaveLength(0);
  });

  it("creates doc with N widgets", () => {
    const doc = canvasDoc(3);
    expect(Object.keys(doc.widgets)).toHaveLength(3);
  });

  it("assigns incrementing zIndex", () => {
    const doc = canvasDoc(3);
    const widgets = Object.values(doc.widgets);
    expect(widgets.map((w) => w.zIndex)).toEqual([1, 2, 3]);
  });

  it("spaces widgets horizontally", () => {
    const doc = canvasDoc(3);
    const widgets = Object.values(doc.widgets);
    const xs = widgets.map((w) => w.x);
    // each widget is 220px apart
    expect(xs[1] - xs[0]).toBe(220);
    expect(xs[2] - xs[1]).toBe(220);
  });

  it("accepts per-widget overrides", () => {
    const doc = canvasDoc(2, (i) => ({ type: i === 0 ? "counter" : "hello-world" }));
    const widgets = Object.values(doc.widgets);
    expect(widgets[0].type).toBe("counter");
    expect(widgets[1].type).toBe("hello-world");
  });
});

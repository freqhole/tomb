import { describe, expect, it } from "vitest";
import { emptyCanvasDoc } from "./canvas-doc";

describe("emptyCanvasDoc", () => {
  it("returns a version 1 document", () => {
    const doc = emptyCanvasDoc();
    expect(doc.version).toBe(1);
  });

  it("returns an empty widgets record", () => {
    const doc = emptyCanvasDoc();
    expect(doc.widgets).toEqual({});
    expect(Object.keys(doc.widgets)).toHaveLength(0);
  });

  it("returns a new object each time", () => {
    const a = emptyCanvasDoc();
    const b = emptyCanvasDoc();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("returns empty metadata strings", () => {
    const doc = emptyCanvasDoc();
    expect(doc.title).toBe("");
    expect(doc.description).toBe("");
    expect(doc.createdAt).toBe("");
    expect(doc.lastModified).toBe("");
  });
});

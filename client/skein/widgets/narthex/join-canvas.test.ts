import { describe, expect, it } from "vitest";
import { joinCanvasSchema, joinCanvasWidget } from "./join-canvas";

describe("joinCanvasSchema", () => {
  it("parses empty object with defaults", () => {
    const result = joinCanvasSchema.parse({});
    expect(result).toEqual({ shareString: "" });
  });

  it("preserves share string when provided", () => {
    const result = joinCanvasSchema.parse({ shareString: "abc123" });
    expect(result.shareString).toBe("abc123");
  });
});

describe("joinCanvasWidget", () => {
  it("has correct type", () => {
    expect(joinCanvasWidget.type).toBe("join-canvas");
  });

  it("has correct metadata name", () => {
    expect(joinCanvasWidget.metadata.name).toBe("join canvas");
  });

  it("has correct category", () => {
    expect(joinCanvasWidget.metadata.category).toBe("narthex");
  });

  it("has correct default dimensions", () => {
    expect(joinCanvasWidget.metadata.defaultWidth).toBe(320);
    expect(joinCanvasWidget.metadata.defaultHeight).toBe(200);
  });

  it("has a schema", () => {
    expect(joinCanvasWidget.schema).toBe(joinCanvasSchema);
  });

  it("has empty editableProps", () => {
    expect(joinCanvasWidget.editableProps).toEqual([]);
  });
});

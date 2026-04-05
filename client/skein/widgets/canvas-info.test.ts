import { describe, expect, it } from "vitest";
import { canvasInfoSchema, canvasInfoWidget } from "./canvas-info";

describe("canvasInfoSchema", () => {
  it("parses empty object with defaults", () => {
    const result = canvasInfoSchema.parse({});
    expect(result).toEqual({ activeTab: "details" });
  });

  it("accepts 'history' tab", () => {
    const result = canvasInfoSchema.parse({ activeTab: "history" });
    expect(result.activeTab).toBe("history");
  });

  it("rejects invalid tab values", () => {
    expect(() => canvasInfoSchema.parse({ activeTab: "settings" })).toThrow();
  });

  it("rejects non-string tab", () => {
    expect(() => canvasInfoSchema.parse({ activeTab: 42 })).toThrow();
  });

  it("defaults tab to 'details' when omitted", () => {
    const result = canvasInfoSchema.parse({});
    expect(result.activeTab).toBe("details");
  });
});

describe("canvasInfoWidget metadata", () => {
  it("has correct type", () => {
    expect(canvasInfoWidget.type).toBe("canvas-info");
  });

  it("is a singleton", () => {
    expect(canvasInfoWidget.metadata.singleton).toBe(true);
  });

  it("is not hidden from palette", () => {
    expect(canvasInfoWidget.metadata.hidden).toBeFalsy();
  });

  it("has default dimensions", () => {
    expect(canvasInfoWidget.metadata.defaultWidth).toBe(280);
    expect(canvasInfoWidget.metadata.defaultHeight).toBe(340);
  });

  it("has a schema", () => {
    expect(canvasInfoWidget.schema).toBe(canvasInfoSchema);
  });

  it("has no editableProps", () => {
    expect(canvasInfoWidget.editableProps).toBeUndefined();
  });

  it("category is 'canvas'", () => {
    expect(canvasInfoWidget.metadata.category).toBe("canvas");
  });
});

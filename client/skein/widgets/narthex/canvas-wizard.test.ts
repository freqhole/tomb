import { describe, expect, it } from "vitest";
import { canvasWizardSchema, canvasWizardWidget } from "./canvas-wizard";

describe("canvasWizardSchema", () => {
  it("parses empty object with defaults", () => {
    const result = canvasWizardSchema.parse({});
    expect(result).toEqual({
      title: "untitled canvas",
      description: "",
      color: 0xd946ef,
      previewUrl: "",
    });
  });

  it("accepts valid overrides", () => {
    const result = canvasWizardSchema.parse({
      title: "my canvas",
      color: 0x06b6d4,
    });
    expect(result).toEqual({
      title: "my canvas",
      description: "",
      color: 0x06b6d4,
      previewUrl: "",
    });
  });

  it("fills in missing fields with defaults", () => {
    const result = canvasWizardSchema.parse({ title: "test" });
    expect(result.title).toBe("test");
    expect(result.description).toBe("");
    expect(result.color).toBe(0xd946ef);
    expect(result.previewUrl).toBe("");
  });

  it("rejects non-string title", () => {
    expect(() => canvasWizardSchema.parse({ title: 123 })).toThrow();
  });

  it("rejects non-string description", () => {
    expect(() => canvasWizardSchema.parse({ description: true })).toThrow();
  });

  it("rejects non-number color", () => {
    expect(() => canvasWizardSchema.parse({ color: "red" })).toThrow();
  });
});

describe("canvasWizardWidget", () => {
  it("has correct type", () => {
    expect(canvasWizardWidget.type).toBe("canvas-wizard");
  });

  it("has default dimensions", () => {
    expect(canvasWizardWidget.metadata.defaultWidth).toBe(320);
    expect(canvasWizardWidget.metadata.defaultHeight).toBe(340);
  });

  it("is not hidden from palette", () => {
    expect(canvasWizardWidget.metadata.hidden).toBeFalsy();
  });

  it("has no editableProps", () => {
    expect(canvasWizardWidget.editableProps).toBeUndefined();
  });

  it("has a schema", () => {
    expect(canvasWizardWidget.schema).toBe(canvasWizardSchema);
  });
});

import { describe, expect, it } from "vitest";
import { profileSchema, profileWidget } from "./profile-widget";

describe("profileSchema", () => {
  it("parses empty object with defaults", () => {
    const result = profileSchema.parse({});
    expect(result).toEqual({
      username: "",
      bio: "",
      avatarDataUrl: "",
      accentColor: 0x6366f1,
      nodeId: "",
    });
  });

  it("parses full object with all fields", () => {
    const result = profileSchema.parse({
      username: "alice",
      bio: "hello world",
      avatarDataUrl: "data:image/png;base64,abc123",
      accentColor: 0xd946ef,
      nodeId: "abc123",
    });
    expect(result).toEqual({
      username: "alice",
      bio: "hello world",
      avatarDataUrl: "data:image/png;base64,abc123",
      accentColor: 0xd946ef,
      nodeId: "abc123",
    });
  });

  it("preserves username when provided", () => {
    const result = profileSchema.parse({ username: "bob" });
    expect(result.username).toBe("bob");
  });

  it("preserves bio when provided", () => {
    const result = profileSchema.parse({ bio: "rust enthusiast" });
    expect(result.bio).toBe("rust enthusiast");
  });

  it("preserves avatarDataUrl when provided", () => {
    const result = profileSchema.parse({
      avatarDataUrl: "data:image/jpeg;base64,xyz",
    });
    expect(result.avatarDataUrl).toBe("data:image/jpeg;base64,xyz");
  });

  it("preserves accentColor when provided", () => {
    const result = profileSchema.parse({ accentColor: 0xef4444 });
    expect(result.accentColor).toBe(0xef4444);
  });

  it("uses default accentColor (0x6366f1) when not provided", () => {
    const result = profileSchema.parse({});
    expect(result.accentColor).toBe(0x6366f1);
  });

  it("includes nodeId in schema with empty default", () => {
    const result = profileSchema.parse({});
    expect(result.nodeId).toBe("");
  });

  it("preserves nodeId when provided", () => {
    const result = profileSchema.parse({ nodeId: "abc123def456" });
    expect(result.nodeId).toBe("abc123def456");
  });
});

describe("profileWidget", () => {
  it("has correct type", () => {
    expect(profileWidget.type).toBe("profile");
  });

  it("has correct metadata name", () => {
    expect(profileWidget.metadata.name).toBe("profile");
  });

  it("has correct metadata category", () => {
    expect(profileWidget.metadata.category).toBe("narthex");
  });

  it("is a singleton widget", () => {
    expect(profileWidget.metadata.singleton).toBe(true);
    expect(profileWidget.metadata.singletonId).toBe("skein-profile");
  });

  it("has correct defaultWidth", () => {
    expect(profileWidget.metadata.defaultWidth).toBe(280);
  });

  it("has correct defaultHeight", () => {
    expect(profileWidget.metadata.defaultHeight).toBe(420);
  });

  it("has a schema", () => {
    expect(profileWidget.schema).toBeDefined();
  });

  it("has empty editableProps (widget IS the editor)", () => {
    expect(profileWidget.editableProps).toEqual([]);
  });
});

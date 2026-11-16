import { describe, expect, it } from "vitest";
import { mergeEditorData } from "./editorData";

describe("editor data refresh", () => {
  it("updates enrichment fields while preserving unsaved edits", () => {
    const initial = { title: "old title", artist: "old artist", album_type: "album" };
    const current = { ...initial, title: "my title" };
    const latest = { title: "MB title", artist: "MB artist", album_type: "single" };
    expect(mergeEditorData(current, initial, latest)).toEqual({
      ...latest,
      title: "my title",
    });
    expect(current).toEqual({ ...initial, title: "my title" });
  });

  it("uses fresh data when changing entities, even if the previous entity was dirty", () => {
    expect(mergeEditorData({ title: "unsaved" }, null, { title: "next album" })).toEqual({
      title: "next album",
    });
  });

  it("clears persisted fields that were removed externally", () => {
    const initial = { bio: "old bio", artist_id: "artist" as string | undefined };
    expect(mergeEditorData(initial, initial, { bio: "", artist_id: undefined })).toEqual({
      bio: "",
      artist_id: undefined,
    });
  });
});

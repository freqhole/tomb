// unit tests for the pure "is this queue row the real up-next item"
// decision (see upNextRow.ts's own doc comment for the live bug this
// guards against - a permanently-spinning loading overlay on whatever
// row happened to be first in the queue).

import { describe, expect, it } from "vitest";
import { isUpNextRow } from "./upNextRow";

describe("isUpNextRow", () => {
  it("is false when nothing is pending, even for the first row", () => {
    expect(isUpNextRow("song-1", null)).toBe(false);
  });

  it("is true only for the row whose key matches the pending up-next key", () => {
    expect(isUpNextRow("song-2", "song-2")).toBe(true);
    expect(isUpNextRow("song-1", "song-2")).toBe(false);
  });

  it("does not fall back to treating row 0 as up-next just because it's first", () => {
    // regression guard for the actual bug: a caller must never derive this
    // from "index === 0" - a queue's first row is often NOT the one
    // currently being downloaded/prepared (e.g. it's already fully local,
    // or a totally different, later item is the one still resolving).
    expect(isUpNextRow("whatever-is-first", null)).toBe(false);
    expect(isUpNextRow("whatever-is-first", "some-other-item-entirely")).toBe(false);
  });
});

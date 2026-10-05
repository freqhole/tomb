// regression tests for shortenUrlForLabel - the display label for a
// url-fetch job row used to drop the query string entirely (hostname +
// pathname only), which made every youtube.com/watch job in the add-media
// modal's job list look identical and impossible to tell apart when one
// of several failed - see docs/backlog3.md.
import { describe, expect, it } from "vitest";
import { shortenUrlForLabel } from "./humanizeJobError";

describe("shortenUrlForLabel", () => {
  it("keeps the query string for a short url instead of dropping it", () => {
    const label = shortenUrlForLabel("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(label).toBe("www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("distinguishes two different youtube videos (the actual reported bug)", () => {
    const a = shortenUrlForLabel("https://www.youtube.com/watch?v=aaaaaaaaaaa");
    const b = shortenUrlForLabel("https://www.youtube.com/watch?v=bbbbbbbbbbb");
    expect(a).not.toBe(b);
  });

  it("truncates a very long path+query, keeping the tail (where ids usually are)", () => {
    const longQuery = "x".repeat(80);
    const label = shortenUrlForLabel(`https://example.com/watch?v=${longQuery}`);
    expect(label.startsWith("example.com...")).toBe(true);
    expect(label.endsWith(longQuery.slice(-10))).toBe(true);
  });

  it("falls back to plain truncation for an unparseable string", () => {
    const notAUrl = "not a url " + "x".repeat(80);
    const label = shortenUrlForLabel(notAUrl);
    expect(label.endsWith("...")).toBe(true);
    expect(label.length).toBeLessThan(notAUrl.length);
  });
});

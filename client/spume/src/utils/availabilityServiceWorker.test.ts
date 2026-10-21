import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("availability service worker policy", () => {
  it("never serves live same-origin availability revisions from its asset cache", () => {
    let onFetch: ((event: { request: Request; respondWith: ReturnType<typeof vi.fn> }) => void) | undefined;
    runInNewContext(
      readFileSync(new URL("../sw-template.js", import.meta.url), "utf8"),
      {
        URL,
        self: {
          location: { origin: "https://library.test" },
          addEventListener: (type: string, listener: typeof onFetch) => {
            if (type === "fetch") onFetch = listener;
          },
        },
      }
    );
    expect(onFetch).toBeDefined();
    const respondWith = vi.fn();
    onFetch?.({
      request: new Request("https://library.test/api/library/availability-revision"),
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  });
});

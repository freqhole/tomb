// @vitest-environment jsdom
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVisualViewportStyle } from "./visualViewport";

afterEach(() => vi.unstubAllGlobals());

describe("visual viewport modal bounds", () => {
  it("tracks keyboard resize and zoom pan, then removes listeners on unmount", () => {
    const viewport = Object.assign(new EventTarget(), {
      width: 320,
      height: 600,
      offsetLeft: 0,
      offsetTop: 0,
    });
    vi.stubGlobal("visualViewport", viewport);
    const remove = vi.spyOn(viewport, "removeEventListener");
    let dispose!: () => void;
    const style = createRoot((cleanup) => {
      dispose = cleanup;
      return useVisualViewportStyle();
    });
    expect(style()).toMatchObject({ width: "320px", height: "600px" });
    Object.assign(viewport, { width: 240, height: 220, offsetLeft: 30, offsetTop: 100 });
    viewport.dispatchEvent(new Event("resize"));
    expect(style()).toMatchObject({
      left: "30px",
      top: "100px",
      width: "240px",
      height: "220px",
    });
    viewport.offsetTop = 150;
    viewport.dispatchEvent(new Event("scroll"));
    expect(style().top).toBe("150px");
    dispose();
    expect(remove.mock.calls.map(([event]) => event)).toEqual(["resize", "scroll"]);
  });

  it("falls back to window dimensions when visualViewport is unavailable", () => {
    vi.stubGlobal("visualViewport", undefined);
    let dispose!: () => void;
    const style = createRoot((cleanup) => {
      dispose = cleanup;
      return useVisualViewportStyle();
    });
    expect(style()).toMatchObject({
      left: "0px",
      top: "0px",
      width: `${window.innerWidth}px`,
      height: `${window.innerHeight}px`,
    });
    dispose();
  });
});

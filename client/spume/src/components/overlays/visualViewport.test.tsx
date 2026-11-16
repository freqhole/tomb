// @vitest-environment jsdom
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { constrainToVisualViewport, useVisualViewportStyle } from "./visualViewport";

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

describe("flyout viewport observers", () => {
  it.each([false, true])(
    "keeps viewport updates and cleanup working with ResizeObserver available=%s",
    (available) => {
      const observe = vi.fn();
      const disconnect = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        available
          ? class {
              observe = observe;
              disconnect = disconnect;
            }
          : undefined
      );
      const viewport = Object.assign(new EventTarget(), {
        width: 320,
        height: 200,
        offsetLeft: 0,
        offsetTop: 0,
      });
      vi.stubGlobal("visualViewport", viewport);
      const remove = vi.spyOn(viewport, "removeEventListener");
      const parent = document.createElement("div");
      const element = document.createElement("div");
      element.style.cssText = "min-width: 200px; max-width: none; max-height: none";
      parent.append(element);
      document.body.append(parent);
      let dispose!: () => void;
      try {
        createRoot((cleanup) => {
          dispose = cleanup;
          constrainToVisualViewport(element);
        });
        expect(element.style.maxWidth).toBe("304px");
        expect(element.style.maxHeight).toBe("184px");
        viewport.width = 240;
        viewport.height = 160;
        viewport.dispatchEvent(new Event("resize"));
        expect(element.style.maxWidth).toBe("224px");
        expect(element.style.maxHeight).toBe("144px");
        viewport.offsetLeft = 20;
        viewport.offsetTop = 50;
        viewport.dispatchEvent(new Event("scroll"));
        expect(element.style.left).toBe("28px");
        expect(element.style.top).toBe("58px");
        expect(observe.mock.calls).toEqual(available ? [[element], [parent]] : []);
      } finally {
        dispose?.();
        parent.remove();
      }
      expect(disconnect).toHaveBeenCalledTimes(available ? 1 : 0);
      expect(remove.mock.calls.map(([event]) => event)).toEqual(["resize", "scroll"]);
    }
  );
});

// @vitest-environment jsdom
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import { CometBorderRing } from "./CometBorderRing";

let resize: ResizeObserverCallback;
let dispose: (() => void) | undefined;
let host: HTMLDivElement;

afterEach(() => {
  dispose?.();
  host?.remove();
  vi.unstubAllGlobals();
});

it.each([40, 80, 160, 240])("bounds the whole comet trail on a %dpx button", async (width) => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <CometBorderRing>
        <button>a</button>
      </CometBorderRing>
    ),
    host
  );
  await Promise.resolve();
  const contentRect = new DOMRect(0, 0, width, 28);
  resize([{ contentRect } as ResizeObserverEntry], {} as ResizeObserver);
  const bands = [...host.querySelectorAll("rect")];
  expect(bands).toHaveLength(10);
  const totalNormalizedLength = bands.reduce((sum, band) => {
    return sum + parseFloat(band.style.strokeDasharray);
  }, 0);
  const perimeter = 2 * (width - 28) + Math.PI * 28;
  expect((totalNormalizedLength * perimeter) / 100).toBeCloseTo(width * 0.3);
  expect(bands.every((band) => parseFloat(band.style.animationDelay) < 0)).toBe(true);
});

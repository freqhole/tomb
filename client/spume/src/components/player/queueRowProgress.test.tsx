// guards the queue-row download-progress bar against a solid reactivity trap.
//
// the bar previously computed its width inside a wrapper that returned JSX,
// which solid evaluates once - the width froze at its first value while real
// progress kept streaming in. reading the value inside the `style` object
// instead compiles to an effect that re-runs. this test pins that difference.
//
// @vitest-environment jsdom

import { render } from "solid-js/web";
import { createSignal, Show } from "solid-js";
import { describe, it, expect, afterEach } from "vitest";

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

function mount(component: () => unknown) {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(component as never, host);
  return host;
}

describe("queue row progress bar reactivity", () => {
  it("updates width as progress changes (value read inside the style object)", () => {
    const [progress, setProgress] = createSignal(0);

    const el = mount(() => (
      <Show when={true}>
        <div data-testid="bar" style={{ width: `${progress() * 100}%` }} />
      </Show>
    ));

    const bar = () => el.querySelector<HTMLElement>('[data-testid="bar"]')!;
    expect(bar().style.width).toBe("0%");

    setProgress(0.42);
    expect(bar().style.width).toBe("42%");

    setProgress(1);
    expect(bar().style.width).toBe("100%");
  });

  it("also updates when the width is computed in a jsx-returning wrapper", () => {
    // solid re-evaluates <Show>'s children getter whenever a signal read
    // during that evaluation changes, so this shape is reactive too. kept as a
    // guard: it was once assumed to be the cause of a stuck progress bar, and
    // this pins down that it is NOT.
    const [progress, setProgress] = createSignal(0);

    const el = mount(() => (
      <Show when={true}>
        {(() => {
          const p = progress();
          return <div data-testid="wrapped" style={{ width: `${p * 100}%` }} />;
        })()}
      </Show>
    ));

    const bar = () => el.querySelector<HTMLElement>('[data-testid="wrapped"]')!;
    expect(bar().style.width).toBe("0%");

    setProgress(0.42);
    expect(bar().style.width).toBe("42%");
  });
});

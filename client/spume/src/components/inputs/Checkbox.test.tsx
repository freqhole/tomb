// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";

let dispose: (() => void) | undefined;
let host: HTMLDivElement;

afterEach(() => {
  dispose?.();
  host?.remove();
});

describe("Checkbox", () => {
  it("labels the native control and reflects changes from a checked default", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => {
      const [checked, setChecked] = createSignal(true);
      return <Checkbox checked={checked()} onChange={setChecked}>allow this player to access your library</Checkbox>;
    }, host);
    const input = host.querySelector("input")!;
    const label = host.querySelector("label")!;
    expect(input.checked).toBe(true);
    expect(label.htmlFor).toBe(input.id);
    expect(label.textContent).toContain("allow this player to access your library");
    expect(host.querySelector("svg")).not.toBeNull();
    label.click();
    expect(input.checked).toBe(false);
    expect(host.querySelector("svg")).toBeNull();
    input.click();
    expect(input.checked).toBe(true);
  });

  it("does not toggle while disabled", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const onChange = vi.fn();
    dispose = render(() => <Checkbox checked={true} disabled={true} onChange={onChange}>library access</Checkbox>, host);
    host.querySelector("label")!.click();
    host.querySelector("input")!.click();
    expect(onChange).not.toHaveBeenCalled();
    expect(host.querySelector("input")!.checked).toBe(true);
  });
});

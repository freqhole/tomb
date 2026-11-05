// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import OptionSelect, { ROLE_OPTIONS } from "./OptionSelect";

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => {
  dispose?.();
  host?.remove();
});
function mount(ui: () => ReturnType<typeof OptionSelect>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(ui, host);
  return host.querySelector("select")!;
}
function pick(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

it("shows the current value and reports changes", () => {
  const onChange = vi.fn();
  const [role] = createSignal("member");
  const select = mount(() => <OptionSelect options={ROLE_OPTIONS} value={role()} onChange={onChange} />);
  expect(select.value).toBe("member");
  expect([...select.options].map((o) => o.value)).toEqual(["admin", "member", "viewer"]);
  pick(select, "viewer");
  expect(onChange).toHaveBeenCalledWith("viewer");
});

it("acts as an action menu when given a placeholder", () => {
  const onChange = vi.fn();
  const select = mount(() => (
    <OptionSelect placeholder="do..." options={[{ value: "a", label: "a" }]} onChange={onChange} />
  ));
  expect(select.value).toBe("");
  pick(select, "a");
  expect(onChange).toHaveBeenCalledWith("a");
  expect(select.value).toBe("");
});

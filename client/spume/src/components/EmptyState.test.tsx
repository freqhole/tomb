// @vitest-environment jsdom
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";

vi.mock("./icons/registry", () => ({ Icon: () => null }));
vi.mock("../app/services/storage/sharedItems", () => {
  const [items, setItems] = createSignal<unknown[]>([]);
  return {
    sharedItems: items,
    loadSharedItems: async () => setItems([{}]),
  };
});

it("loads saved shares on the empty landing page and opens their list", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(() => <EmptyState
    onAddMedia={vi.fn()}
    onAddRemote={vi.fn()}
    onGoToRadio={vi.fn()}
    onGoToPlayer={vi.fn()}
  />, host);
  try {
    await Promise.resolve();
    const button = [...host.querySelectorAll("button")].find((el) => el.textContent === "share'd links");
    expect(button).toBeDefined();
    button!.click();
    expect(window.location.hash).toBe("#/shared");
  } finally {
    dispose();
    host.remove();
    window.location.hash = "";
  }
});

// @vitest-environment jsdom

import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import StorageMigration from "./StorageMigration";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("../../util/resolvePath", () => ({ resolvePath: async (path: string) => path }));

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.resetAllMocks();
});
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
const report = {
  operation: "move_data", source: "/old", destination: "/new", files: 2,
  bytes: 4096, identical: 0, collisions: [], blockers: [],
  destination_has_media: true, blocked_reason: null,
};
async function mount(overrides = {}, select = false) {
  mocks.open.mockResolvedValue("/new");
  mocks.invoke.mockResolvedValue({ ...report, ...overrides });
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <StorageMigration kind="data" />, host);
  pick(select ? "select_data" : "move_data");
  await settle();
}
function pick(value: string) {
  const select = host.querySelector<HTMLSelectElement>("select")!;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
}
function click(text: string) { button(text).click(); }
function confirm() {
  const input = host.querySelector<HTMLInputElement>('[aria-label="storage confirmation"]')!;
  input.value = "move my storage";
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

it("requires typed confirmation and queues before closing", async () => {
  await mount();
  expect(button("confirm and close app").disabled).toBe(true);
  click("confirm and close app");
  expect(mocks.invoke).not.toHaveBeenCalledWith("schedule_storage_change", expect.anything());
  confirm();
  click("confirm and close app");
  await settle();
  expect(mocks.invoke).toHaveBeenNthCalledWith(2, "schedule_storage_change", {
    operation: "move_data", destination: "/new", merge: false, confirmation: "move my storage",
  });
  expect(mocks.invoke).toHaveBeenNthCalledWith(3, "close_for_storage_change");
});

it("blocks metadata collisions and names the conflicting files", async () => {
  await mount({ blockers: ["/new/grimoire.db", "/new/identity.toml"] });
  expect(host.textContent).toContain("/new/grimoire.db");
  expect(host.textContent).toContain("/new/identity.toml");
  expect(button("confirm and close app")).toBeUndefined();
  expect(host.querySelector('[aria-label="storage confirmation"]')).toBeNull();
});

it("requires explicit merge as well as typed confirmation", async () => {
  await mount({ collisions: ["/new/song.flac"] });
  confirm();
  expect(button("confirm and close app").disabled).toBe(true);
  host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  expect(button("confirm and close app").disabled).toBe(false);
  click("confirm and close app");
  await settle();
  expect(mocks.invoke).toHaveBeenCalledWith("schedule_storage_change", expect.objectContaining({ merge: true }));
});

it("explains the P2P gate without allowing confirmation", async () => {
  await mount({ blocked_reason: "P2P absolute file references need relocation" });
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("absolute file references");
  expect(button("confirm and close app")).toBeUndefined();
});

it("explains select-only fresh setup without promising a file move", async () => {
  await mount({ operation: "select_data" }, true);
  expect(mocks.invoke).toHaveBeenCalledWith("preview_storage_change", { operation: "select_data", destination: "/new" });
  expect(host.textContent).toContain("no files will move or be deleted");
  expect(host.textContent).toContain("first-time setup");
});

it("does not close when backend preflight rejects the queued change", async () => {
  await mount();
  mocks.invoke.mockRejectedValueOnce(new Error("destination changed"));
  confirm();
  click("confirm and close app");
  await settle();
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("destination changed");
  expect(mocks.invoke).not.toHaveBeenCalledWith("close_for_storage_change");
});

it("offers storage changes as one action menu that resets after each pick", async () => {
  await mount();
  const select = host.querySelector<HTMLSelectElement>('[aria-label="change data directory"]')!;
  expect([...select.options].map((o) => o.textContent)).toEqual([
    "change folder...", "move existing files", "select a new folder without moving",
  ]);
  expect(select.value).toBe("");
  expect(mocks.invoke).toHaveBeenCalledWith("preview_storage_change", { operation: "move_data", destination: "/new" });
});

it("fetch menu moves files or only points future fetches at a folder", async () => {
  const onSelectFetchFolder = vi.fn();
  mocks.open.mockResolvedValue("/new");
  mocks.invoke.mockResolvedValue({ ...report, operation: "move_fetch" });
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <StorageMigration kind="fetch" onSelectFetchFolder={onSelectFetchFolder} />, host);
  const select = host.querySelector<HTMLSelectElement>('[aria-label="change fetched music folder"]')!;
  expect([...select.options].map((o) => o.textContent)).toEqual([
    "change folder...", "move existing files", "select folder for future fetches",
  ]);
  pick("select_fetch");
  await settle();
  expect(onSelectFetchFolder).toHaveBeenCalledOnce();
  expect(mocks.invoke).not.toHaveBeenCalled();
  pick("move_fetch");
  await settle();
  expect(mocks.invoke).toHaveBeenCalledWith("preview_storage_change", { operation: "move_fetch", destination: "/new" });
});

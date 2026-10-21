// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminClient,
  type AdminResponse,
  type LibrarySource,
  type RemovableVolume,
} from "@freqhole/api-client";
import { LibraryStorageSection } from "./LibraryStorageSection";

const volume: RemovableVolume = {
  device_path: "/dev/sda1",
  uuid: "disk",
  partition_uuid: "partition",
  label: "music disk",
  filesystem: "ext4",
  mount_points: ["/media/music"],
  read_only: true,
  size_bytes: 1024,
};
const source: LibrarySource = {
  id: "source",
  volume_key: '["disk","partition"]',
  volume_uuid: "disk",
  partition_uuid: "partition",
  label: "music disk",
  relative_path: "albums",
  last_known_path: "/media/music/albums",
  domain: "both",
  created_at: 0,
};
const ok = (data: unknown): AdminResponse => ({ success: true, message: "ok", data });
const failed = (detail: string): AdminResponse => ({
  success: false,
  message: detail,
  errors: [{ error_type: "validation", title: "storage error", detail }],
});
function client(send: (command: string, args: unknown) => Promise<AdminResponse>) {
  return new AdminClient({ send });
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.useRealTimers();
});
function mount(admin: () => AdminClient) {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <LibraryStorageSection client={admin()} />, host);
}
function click(label: string) {
  const button = Array.from(host!.querySelectorAll("button")).find((b) => b.textContent === label);
  expect(button, label).toBeDefined();
  button!.click();
}
function inventory(command: string): AdminResponse {
  if (command === "library_list_removable_volumes") return ok([volume]);
  if (command === "library_list_sources" || command === "library_source_availability")
    return ok([]);
  if (command === "library_scan_status")
    return ok({ pending: 0, running: 0, completed: 3, failed: 0, total: 3 });
  throw new Error(`unexpected command ${command}`);
}

describe("remote library disk picker", () => {
  it("tracks only the started scan session, reports failures, and stops after completion", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const send = vi.fn(async (command: string) => {
      if (command === "library_list_sources") return ok([source]);
      if (command === "library_scan_source")
        return ok({
          session_id: "session-one",
          files_discovered: 4,
          jobs_created: 4,
          success: true,
          message: "queued",
        });
      if (command === "library_scan_status")
        return ok(
          ++polls === 1
            ? { pending: 2, running: 1, completed: 1, failed: 0, total: 4 }
            : { pending: 0, running: 0, completed: 3, failed: 1, total: 4 }
        );
      return inventory(command);
    });
    const admin = client(send);
    mount(() => admin);
    click("browse disks");
    await settle();
    click("scan again");
    await settle();
    expect(host!.textContent).toContain("1 / 4 completed");
    expect(send).toHaveBeenCalledWith("library_scan_status", { session_id: "session-one" });
    expect(host!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(host!.textContent).toContain("1 failed");
    expect(host!.textContent).toContain("scan finished");
    await vi.advanceTimersByTimeAsync(10000);
    expect(polls).toBe(2);
  });

  it("allows retrying failed progress without scanning or registering twice", async () => {
    let fail = true;
    const send = vi.fn(async (command: string) => {
      if (command === "library_list_sources") return ok([source]);
      if (command === "library_scan_source")
        return ok({
          session_id: "scan",
          files_discovered: 1,
          jobs_created: 1,
          success: true,
          message: "queued",
        });
      if (command === "library_scan_status")
        return fail
          ? failed("connection lost")
          : ok({ pending: 0, running: 0, completed: 1, failed: 0, total: 1 });
      return inventory(command);
    });
    const admin = client(send);
    mount(() => admin);
    click("browse disks");
    await settle();
    click("scan again");
    await settle();
    expect(host!.textContent).toContain("connection lost");
    fail = false;
    click("retry progress");
    await settle();
    expect(host!.textContent).toContain("1 / 1 completed");
    expect(send.mock.calls.filter(([command]) => command === "library_scan_source")).toHaveLength(
      1
    );
  });

  it("browses host folders, goes back, then registers both domains before scanning", async () => {
    const send = vi.fn(async (command: string, args: unknown) => {
      if (command === "library_browse_volume") {
        const relative = (args as { relative_path: string }).relative_path;
        return ok(relative ? [] : [{ name: "albums", relative_path: "albums" }]);
      }
      if (command === "library_register_source") return ok(source);
      if (command === "library_scan_source")
        return ok({
          session_id: "scan",
          files_discovered: 3,
          jobs_created: 3,
          success: true,
          message: "created 3 import job(s)",
        });
      return inventory(command);
    });
    const admin = client(send);
    mount(() => admin);
    expect(send).not.toHaveBeenCalled();
    click("browse disks");
    await settle();
    click("browse /media/music");
    await settle();
    click("albums");
    await settle();
    expect(host!.textContent).toContain("/media/music / albums");
    click("parent folder");
    await settle();
    expect(host!.textContent).toContain("(whole disk)");
    click("albums");
    await settle();
    click("add and scan this folder");
    await settle();
    expect(send).toHaveBeenCalledWith("library_register_source", {
      device_path: "/dev/sda1",
      mount_path: "/media/music",
      relative_path: "albums",
      domain: "both",
    });
    expect(send).toHaveBeenCalledWith("library_scan_source", { id: "source" });
    expect(host!.textContent).toContain("created 3 import job(s)");
    expect(host!.textContent).toContain("/media/music/albums");
  });

  it("shows unmounted and unidentifiable disks without offering invalid registration", async () => {
    const admin = client(async (command) =>
      command === "library_list_removable_volumes"
        ? ok([
            { ...volume, label: "unmounted", mount_points: [] },
            { ...volume, uuid: null, partition_uuid: null },
          ])
        : inventory(command)
    );
    mount(() => admin);
    click("browse disks");
    await settle();
    expect(host!.textContent).toContain("not mounted");
    expect(host!.textContent).toContain("no stable disk identity");
    expect(host!.querySelectorAll("button:disabled")).toHaveLength(1);
  });

  it("keeps a registered source visible and retryable when its initial scan fails", async () => {
    let failScan = true;
    const send = vi.fn(async (command: string) => {
      if (command === "library_browse_volume") return ok([]);
      if (command === "library_register_source") return ok({ ...source, relative_path: "" });
      if (command === "library_scan_source")
        return failScan
          ? failed("disk disconnected")
          : ok({
              session_id: "scan",
              files_discovered: 0,
              jobs_created: 0,
              success: true,
              message: "nothing new",
            });
      return inventory(command);
    });
    const admin = client(send);
    mount(() => admin);
    click("browse disks");
    await settle();
    click("browse /media/music");
    await settle();
    click("add and scan whole disk");
    await settle();
    expect(host!.querySelector('[role="alert"]')!.textContent).toContain("disk disconnected");
    expect(host!.textContent).toContain("folder registered; scan request failed");
    failScan = false;
    click("scan again");
    await settle();
    expect(host!.querySelector('[role="alert"]')).toBeNull();
    expect(host!.textContent).toContain("nothing new");
    expect(send.mock.calls.filter(([cmd]) => cmd === "library_register_source")).toHaveLength(1);
  });

  it("does not turn unsupported inventory into a misleading empty-disk success", async () => {
    const admin = client(async (command) =>
      command === "library_list_removable_volumes"
        ? failed("removable volume inventory currently requires Linux")
        : inventory(command)
    );
    mount(() => admin);
    click("browse disks");
    await settle();
    expect(host!.querySelector('[role="alert"]')!.textContent).toContain("requires Linux");
    expect(host!.textContent).not.toContain("no removable library disks found");
  });

  it("passes the chosen domain and never scans after registration fails", async () => {
    const send = vi.fn(async (command: string, _args: unknown) => {
      if (command === "library_browse_volume") return ok([]);
      if (command === "library_register_source") return failed("volume is no longer mounted");
      return inventory(command);
    });
    const admin = client(send);
    mount(() => admin);
    click("browse disks");
    await settle();
    click("browse /media/music");
    await settle();
    const select = host!.querySelector("select")!;
    select.value = "video";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    click("add and scan whole disk");
    await settle();
    expect(send).toHaveBeenCalledWith("library_register_source", {
      device_path: "/dev/sda1",
      mount_path: "/media/music",
      relative_path: "",
      domain: "video",
    });
    expect(send.mock.calls.some(([command]) => command === "library_scan_source")).toBe(false);
    expect(host!.querySelector('[role="alert"]')!.textContent).toContain("no longer mounted");
    expect(host!.textContent).toContain("add and scan whole disk");
  });

  it("surfaces missing success payloads instead of claiming there are no disks", async () => {
    const admin = client(async (command) =>
      command === "library_list_removable_volumes"
        ? { success: true, message: "ok" }
        : inventory(command)
    );
    mount(() => admin);
    click("browse disks");
    await settle();
    expect(host!.querySelector('[role="alert"]')!.textContent).toContain("returned no data");
    expect(host!.textContent).not.toContain("no removable library disks found");
  });

  it("ignores an old host's pending folder response after switching targets", async () => {
    let finish: ((value: AdminResponse) => void) | undefined;
    const old = client(async (command) =>
      command === "library_browse_volume"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : inventory(command)
    );
    const [admin, setAdmin] = createSignal(old);
    host = document.createElement("div");
    document.body.appendChild(host);
    dispose = render(() => <LibraryStorageSection client={admin()} />, host);
    click("browse disks");
    await settle();
    click("browse /media/music");
    await settle();
    const next = client(async (command) =>
      command === "library_list_removable_volumes" ? ok([]) : inventory(command)
    );
    setAdmin(next);
    await settle();
    finish!(ok([{ name: "old host folder", relative_path: "old" }]));
    await settle();
    expect(host!.textContent).not.toContain("old host folder");
    expect(host!.textContent).toContain("no removable library disks found");
  });
});

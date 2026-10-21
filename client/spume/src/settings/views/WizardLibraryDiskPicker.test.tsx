// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminTargetInfo } from "../../../../charnel/src/admin/context";
import LibraryDiskPicker from "../../../../charnel/src/components/LibraryDiskPicker";
import LibraryView from "../../../../charnel/src/views/LibraryView";
import { dispatchOrThrow } from "../../../../charnel/src/admin/transport";

const transport = vi.hoisted(() => ({
  invoke: vi.fn(),
  dialog: vi.fn(),
  selection: vi.fn(),
  busy: vi.fn(),
}));
const scope = vi.hoisted(() => ({ current: undefined as undefined | (() => AdminTargetInfo) }));
vi.mock("../../../../charnel/src/admin/context", () => ({
  useAdminTransport: () => ({
    current: () => scope.current!(),
    isRemote: () => scope.current!().kind === "remote",
    dispatchOrThrow: (command: string, args: unknown) => {
      const target = scope.current!();
      if (target.kind === "remote") {
        if (!target.peerAddr) throw new Error("missing remote peer address");
        return dispatchOrThrow(command, args, { kind: "remote", peerAddr: target.peerAddr });
      }
      return dispatchOrThrow(command, args, { kind: "local" });
    },
  }),
}));

const volume = {
  device_path: "/dev/sda1",
  uuid: "disk",
  partition_uuid: null,
  label: "library",
  filesystem: "ext4",
  mount_points: ["/media/library"],
};
const savedSource = {
  id: "saved-source",
  label: "library",
  last_known_path: "/media/library/films",
  domain: "both",
};
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => {
  dispose?.();
  host?.remove();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.clearAllMocks();
  transport.invoke.mockReset();
  transport.dialog.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  expect(button, label).toBeDefined();
  button!.click();
}
function mount(target: AdminTargetInfo, view = false, respond?: (command: string) => unknown) {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: { invoke: transport.invoke, transformCallback: () => 1 },
  });
  const [current, setCurrent] = createSignal(target);
  scope.current = current;
  let registered = false;
  transport.invoke.mockImplementation(async (bridge, payload) => {
    if (bridge === "plugin:dialog|open") return transport.dialog(payload);
    if (!bridge.startsWith("admin_dispatch")) return null;
    const command = payload.command;
    if (command === "library_register_source") registered = true;
    const data = respond
      ? respond(command)
      : command === "library_list_removable_volumes"
        ? [volume]
        : command === "library_browse_volume"
          ? [{ name: "films", relative_path: "films" }]
          : command === "library_list_sources"
            ? registered
              ? [savedSource]
              : []
            : command === "library_register_source"
              ? savedSource
              : command === "library_scan"
                ? { success: true, message: "queued" }
                : command === "maintenance_reorganize_library_source_dirs"
                  ? { source_music_directory: "", source_video_directory: "" }
                  : [];
    return { success: true, message: "ok", data: await data };
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () =>
      view ? (
        <LibraryView />
      ) : (
        <LibraryDiskPicker onSelectionChange={transport.selection} onBusyChange={transport.busy} />
      ),
    host
  );
  return setCurrent;
}

describe("wizard disk location selection", () => {
  it("uses remote folder buttons without a second form or scan action", async () => {
    mount({ kind: "remote", label: "Pi", peerAddr: "peer" });
    await settle();
    click("browse /media/library");
    await settle();
    expect(host.textContent).not.toContain("refresh disks");
    expect(host.querySelector("select")).toBeNull();
    expect(host.textContent).not.toContain("add and scan");
    click("films");
    await settle();
    expect(transport.selection).toHaveBeenLastCalledWith({
      device_path: volume.device_path,
      mount_path: "/media/library",
      relative_path: "films",
    });
    expect(
      transport.invoke.mock.calls.every(
        ([bridge, args]) => bridge === "admin_dispatch_remote" && args.peerAddr === "peer"
      )
    ).toBe(true);
    click("change disk");
    await settle();
    expect(transport.selection).toHaveBeenLastCalledWith(undefined);
    expect(host.textContent).toContain("refresh disks");
  });

  it("opens a local folder chooser only after disk selection and rejects outside paths", async () => {
    mount({ kind: "local", label: "local" });
    await settle();
    expect(host.textContent).not.toContain("browse folder...");
    click("select /media/library");
    await settle();
    transport.dialog.mockResolvedValue("/media/library-other/films");
    click("browse folder...");
    await settle();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("selected disk");
    expect(transport.dialog).toHaveBeenCalledWith({
      options: expect.objectContaining({ defaultPath: "/media/library", directory: true }),
    });
    transport.dialog.mockResolvedValue("/media/library/films");
    click("browse folder...");
    await settle();
    expect(transport.selection).toHaveBeenLastCalledWith(
      expect.objectContaining({ relative_path: "films" })
    );
    transport.dialog.mockResolvedValue(null);
    click("browse folder...");
    await settle();
    expect(host.textContent).toContain("/media/library / films");
    expect(transport.invoke.mock.calls.some(([, p]) => p.command === "library_browse_volume")).toBe(
      false
    );
  });

  it("ignores an in-flight folder dialog after switching hosts", async () => {
    const setCurrent = mount({ kind: "local", label: "local" });
    let finish!: (path: string) => void;
    transport.dialog.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        })
    );
    await settle();
    click("select /media/library");
    await settle();
    click("browse folder...");
    await settle();
    setCurrent({ kind: "remote", label: "Pi", peerAddr: "peer" });
    await settle();
    finish("/media/library/films");
    await settle();
    expect(transport.selection).toHaveBeenLastCalledWith(undefined);
    expect(host.textContent).toContain("refresh disks");
  });

  it("accepts Windows chooser paths with extended disk path prefixes", async () => {
    mount({ kind: "local", label: "local" }, false, () => [
      { ...volume, mount_points: ["\\\\?\\E:\\"] },
    ]);
    await settle();
    click("select \\\\?\\E:\\");
    await settle();
    transport.dialog.mockResolvedValue("e:\\Films\\Drama");
    click("browse folder...");
    await settle();
    expect(transport.selection).toHaveBeenLastCalledWith(
      expect.objectContaining({ relative_path: "Films/Drama" })
    );
  });

  it("surfaces missing inventory instead of reporting no disks", async () => {
    mount({ kind: "local", label: "local" }, false, () => undefined);
    await settle();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("returned no data");
    expect(host.textContent).not.toContain("no removable library disks");
  });
});

describe("unified add-directory modal", () => {
  it("defaults the rendition option to host config and sends an explicit opt-out", async () => {
    mount({ kind: "remote", label: "Pi", peerAddr: "peer" }, true, (command) =>
      command === "library_rendition_settings"
        ? { enabled: true, directory: "/data/renditions" }
        : command === "library_list_removable_volumes"
          ? [volume]
          : command === "library_register_source"
            ? savedSource
            : command === "library_scan"
              ? { success: true, message: "queued" }
              : []
    );
    await settle();
    click("add removable disk");
    await settle();
    click("browse /media/library");
    await settle();
    const checkbox = host.querySelector<HTMLInputElement>(
      '.add-directory-modal input[type="checkbox"]'
    )!;
    expect(checkbox.checked).toBe(true);
    expect(host.textContent).toContain("/data/renditions");
    checkbox.click();
    click("add & scan");
    await settle();
    expect(
      transport.invoke.mock.calls.some(
        ([, p]) => p?.command === "library_register_source" && p.args.generate_renditions === false
      )
    ).toBe(true);
  });

  it("requires confirmation to remove a source and displays busy errors", async () => {
    mount({ kind: "remote", label: "Pi", peerAddr: "peer" }, true, (command) =>
      command === "library_list_sources" ? [savedSource] : []
    );
    await settle();
    click("remove from library");
    expect(host.textContent).toContain("no files are deleted");
    expect(
      transport.invoke.mock.calls.some(([, p]) => p?.command === "library_remove_source")
    ).toBe(false);
    const invoke = transport.invoke.getMockImplementation()!;
    transport.invoke.mockImplementation((bridge, payload) => {
      if (payload?.command === "library_remove_source") throw new Error("wait for library scans");
      return invoke(bridge, payload);
    });
    click("confirm remove");
    await settle();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("wait for library scans");
  });

  it("reconnects to multiple host scan sessions when reopened", async () => {
    vi.useFakeTimers();
    mount({ kind: "remote", label: "Pi", peerAddr: "peer" }, true, (command) =>
      command === "library_active_scans"
        ? [
            { session_id: "scan-one", path: "/disk" },
            { session_id: "scan-two", path: "/other" },
          ]
        : command === "library_scan_status"
          ? { pending: 2, running: 1, completed: 3, failed: 0, total: 6 }
          : []
    );
    await settle();
    expect(host.querySelector(".scan-progress-card")).not.toBeNull();
    expect(host.textContent).toContain("6 / 12 jobs");
    expect(
      transport.invoke.mock.calls.filter(([, p]) => p?.command === "library_scan_status")
    ).toHaveLength(2);
    dispose!();
    dispose = undefined;
    const count = transport.invoke.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(transport.invoke).toHaveBeenCalledTimes(count);
  });

  it("shows the registered disk before the scan request finishes", async () => {
    mount({ kind: "remote", label: "Pi", peerAddr: "peer" }, true);
    await settle();
    const invoke = transport.invoke.getMockImplementation()!;
    let finish!: (result: unknown) => void;
    transport.invoke.mockImplementation((bridge, payload) => {
      if (payload?.command === "library_scan")
        return new Promise((resolve) => {
          finish = resolve;
        });
      return invoke(bridge, payload);
    });
    click("add removable disk");
    await settle();
    click("browse /media/library");
    await settle();
    click("add & scan");
    await settle();
    expect(host.querySelector(".add-directory-modal")).toBeNull();
    expect(host.textContent).toContain("removable disks");
    expect(host.textContent).toContain(savedSource.last_known_path);
    expect(host.textContent).toContain("both · unknown");
    finish({ success: true, data: { success: true, message: "queued" } });
    await settle();
  });

  it("loads saved disks even without scan history and keeps offline ones visible", async () => {
    mount({ kind: "remote", label: "Pi", peerAddr: "peer" }, true, (command) =>
      command === "library_list_sources"
        ? [savedSource]
        : command === "library_source_availability"
          ? [{ source_id: savedSource.id, status: "offline" }]
          : command === "library_source_summaries"
            ? [
                {
                  source_id: savedSource.id,
                  music_count: 12,
                  video_count: 3,
                  tags: ["fatty"],
                  generate_renditions: true,
                },
              ]
            : command === "maintenance_reorganize_library_source_dirs"
              ? { source_music_directory: "", source_video_directory: "" }
              : []
    );
    await settle();
    const row = [...host.querySelectorAll(".directory-item")].find((item) =>
      item.textContent?.includes(savedSource.last_known_path)
    )!;
    expect(row.textContent).toContain("offline");
    expect(row.textContent).toContain("12 music · 3 video");
    expect(row.textContent).toContain("#fatty");
    expect(row.querySelector("button")!.disabled).toBe(true);
    expect(host.textContent).not.toContain("no directories added yet");
    click("refresh disk availability");
    await settle();
    expect(
      transport.invoke.mock.calls.some(
        ([, p]) => p?.command === "library_refresh_source_availability"
      )
    ).toBe(true);
  });

  it("keeps manual directories separate and opens disk discovery directly", async () => {
    mount({ kind: "remote", label: "Pi", peerAddr: "peer" }, true);
    await settle();
    const actions = host.querySelector(".library-add-actions")!;
    expect([...actions.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual([
      "add directory",
      "add removable disk",
    ]);
    click("add directory");
    await settle();
    expect(
      host.querySelector('.add-directory-modal input[placeholder="/absolute/path/on/remote"]')
    ).not.toBeNull();
    expect(host.textContent).not.toContain("refresh disks");
    expect(
      transport.invoke.mock.calls.some(([, p]) => p?.command === "library_list_removable_volumes")
    ).toBe(false);
    [...host.querySelectorAll<HTMLButtonElement>(".add-directory-modal button")]
      .find((button) => button.textContent?.trim() === "cancel")!
      .click();
    await settle();
    click("add removable disk");
    await settle();
    expect(
      host.querySelector('.add-directory-modal input[placeholder="/absolute/path/on/remote"]')
    ).toBeNull();
    expect(host.textContent).toContain("browse /media/library");
    expect(host.querySelector(".add-directory-modal fieldset")).toBeNull();
    expect(
      [...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "add & scan")
    ).toBe(false);
    click("browse /media/library");
    await settle();
    expect(host.querySelector(".add-directory-modal fieldset")).not.toBeNull();
    expect(host.querySelectorAll(".add-directory-modal")).toHaveLength(1);
    expect(transport.dialog).not.toHaveBeenCalled();
  });

  describe("directory scan job progress", () => {
    it.each(["local", "remote"] as const)("shows %s scan counts until completion", async (kind) => {
      vi.useFakeTimers();
      const disconnect = vi.fn();
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(private measure: () => void) {}
          observe(element: HTMLElement) {
            element.getBoundingClientRect = () => new DOMRect(0, 0, 600, 400);
            this.measure();
          }
          disconnect = disconnect;
        }
      );
      mount(
        kind === "local" ? { kind, label: "local" } : { kind, label: "Pi", peerAddr: "peer" },
        true
      );
      await settle();
      const invoke = transport.invoke.getMockImplementation()!;
      let finished = false;
      transport.invoke.mockImplementation(async (bridge, payload) => {
        if (bridge === "scan_directory")
          return { success: true, session_id: "directory-scan", message: "queued" };
        if (payload?.command === "library_scan")
          return {
            success: true,
            data: { success: true, session_id: "directory-scan", message: "queued" },
          };
        if (payload?.command === "library_validate_path")
          return {
            success: true,
            data: { path: "/media/library", exists: true, is_dir: true, is_readable: true },
          };
        if (payload?.command === "library_scan_status")
          return {
            success: true,
            data: finished
              ? { pending: 0, running: 0, completed: 4, failed: 0, total: 4 }
              : { pending: 2, running: 1, completed: 1, failed: 0, total: 4 },
          };
        return invoke(bridge, payload);
      });
      click("add removable disk");
      await settle();
      click(kind === "local" ? "select /media/library" : "browse /media/library");
      await settle();
      click("add & scan");
      await settle();
      expect(host.querySelector(".scan-progress-card")).not.toBeNull();
      expect(host.textContent).toContain("1 / 4 jobs");
      expect(host.textContent).toContain("2 pending");
      expect(host.textContent).not.toContain("backfilling missing images");
      expect(host.querySelector<HTMLElement>(".library-view")!.style.paddingBottom).toBe("448px");
      finished = true;
      await vi.advanceTimersByTimeAsync(2000);
      await settle();
      expect(host.querySelector(".scan-progress-card")).toBeNull();
      expect(host.querySelector<HTMLElement>(".library-view")!.style.paddingBottom).toBe("3rem");
      expect(disconnect).toHaveBeenCalledOnce();
      expect(host.textContent).toContain("scan complete: 4 jobs completed");
      const calls = transport.invoke.mock.calls.length;
      await vi.advanceTimersByTimeAsync(6000);
      expect(transport.invoke).toHaveBeenCalledTimes(calls);
    });

    it("stops observing on a host change and ignores old status replies", async () => {
      vi.useFakeTimers();
      const setCurrent = mount({ kind: "remote", label: "Pi", peerAddr: "peer" }, true);
      await settle();
      const invoke = transport.invoke.getMockImplementation()!;
      let finish!: (value: unknown) => void;
      transport.invoke.mockImplementation(async (bridge, payload) => {
        if (payload?.command === "library_scan")
          return {
            success: true,
            data: { success: true, session_id: "old-scan", message: "queued" },
          };
        if (payload?.command === "library_scan_status")
          return new Promise((resolve) => {
            finish = resolve;
          });
        return invoke(bridge, payload);
      });
      click("add removable disk");
      await settle();
      click("browse /media/library");
      await settle();
      click("add & scan");
      await settle();
      setCurrent({ kind: "remote", label: "other", peerAddr: "other" });
      await settle();
      finish({
        success: true,
        data: { pending: 2, running: 1, completed: 0, failed: 0, total: 3 },
      });
      await settle();
      const calls = transport.invoke.mock.calls.length;
      await vi.advanceTimersByTimeAsync(6000);
      expect(transport.invoke).toHaveBeenCalledTimes(calls);
      expect(host.querySelector(".scan-progress-card")).toBeNull();
    });
  });

  it("passes tags and media type through the existing local scan flow", async () => {
    mount({ kind: "local", label: "local" }, true);
    await settle();
    click("add removable disk");
    await settle();
    click("select /media/library");
    await settle();
    const tags = host.querySelector<HTMLInputElement>('input[placeholder="rock, jazz, 90s"]')!;
    tags.value = "fatty";
    tags.dispatchEvent(new Event("input", { bubbles: true }));
    host.querySelectorAll<HTMLInputElement>('input[name="pending-domain"]')[0].click();
    const invoke = transport.invoke.getMockImplementation()!;
    transport.invoke.mockImplementation(async (bridge, payload) => {
      if (bridge === "admin_dispatch" && payload.command === "library_validate_path")
        return {
          success: true,
          data: { path: "/media/library", exists: true, is_dir: true, is_readable: true },
        };
      return invoke(bridge, payload);
    });
    click("add & scan");
    await settle();
    expect(
      transport.invoke.mock.calls.some(
        ([bridge, p]) =>
          bridge === "scan_directory" && p.tags[0] === "fatty" && p.domain === "music"
      )
    ).toBe(true);
  });

  it("keeps registration errors in the modal and does not start a scan", async () => {
    mount({ kind: "remote", label: "Pi", peerAddr: "peer" }, true);
    await settle();
    click("add removable disk");
    await settle();
    click("browse /media/library");
    await settle();
    const invoke = transport.invoke.getMockImplementation()!;
    transport.invoke.mockImplementation((bridge, payload) => {
      if (payload?.command === "library_register_source") throw new Error("disk disconnected");
      return invoke(bridge, payload);
    });
    click("add & scan");
    await settle();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("disk disconnected");
    expect(transport.invoke.mock.calls.some(([, p]) => p?.command === "library_scan")).toBe(false);
    expect(
      host.querySelector<HTMLInputElement>('input[placeholder="rock, jazz, 90s"]')
    ).not.toBeNull();
    expect(
      [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "add & scan")!
        .disabled
    ).toBe(false);
  });

  it("does not scan after changing hosts during registration", async () => {
    const setCurrent = mount({ kind: "remote", label: "Pi", peerAddr: "old" }, true);
    await settle();
    click("add removable disk");
    await settle();
    click("browse /media/library");
    await settle();
    let finish!: (source: unknown) => void;
    const invoke = transport.invoke.getMockImplementation()!;
    transport.invoke.mockImplementation((bridge, payload) => {
      if (payload?.command === "library_register_source")
        return new Promise((resolve) => {
          finish = resolve;
        });
      return invoke(bridge, payload);
    });
    click("add & scan");
    await settle();
    setCurrent({ kind: "remote", label: "other", peerAddr: "new" });
    await settle();
    finish({ success: true, data: { last_known_path: "/media/library" } });
    await settle();
    expect(host.querySelector(".add-directory-modal")).toBeNull();
    expect(transport.invoke.mock.calls.some(([, p]) => p?.command === "library_scan")).toBe(false);
  });

  it("uses one radio/tags form and one submit action for a selected remote disk", async () => {
    mount({ kind: "remote", label: "Pi", peerAddr: "peer" }, true);
    await settle();
    click("add removable disk");
    await settle();
    click("browse /media/library");
    await settle();
    click("films");
    await settle();
    const modal = host.querySelector(".add-directory-modal")!;
    expect(modal.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(modal.querySelector("select")).toBeNull();
    expect(modal.querySelector('input[placeholder="/absolute/path/on/remote"]')).toBeNull();
    expect(
      [...modal.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "add & scan")
    ).toHaveLength(1);
    const radios = modal.querySelectorAll<HTMLInputElement>('input[name="pending-domain"]');
    radios[1].click();
    const tags = modal.querySelector<HTMLInputElement>('input[placeholder="rock, jazz, 90s"]')!;
    tags.value = "fatty, films";
    tags.dispatchEvent(new Event("input", { bubbles: true }));
    click("add & scan");
    await settle();
    expect(
      transport.invoke.mock.calls.some(
        ([, p]) =>
          p.command === "library_register_source" &&
          p.args.relative_path === "films" &&
          p.args.domain === "video"
      )
    ).toBe(true);
    expect(
      transport.invoke.mock.calls.some(
        ([, p]) =>
          p.command === "library_scan" &&
          p.args.path === "/media/library/films" &&
          p.args.domain === "video" &&
          JSON.stringify(p.args.tags) === '["fatty","films"]'
      )
    ).toBe(true);
    expect(host.querySelector(".add-directory-modal")).toBeNull();
  });
});

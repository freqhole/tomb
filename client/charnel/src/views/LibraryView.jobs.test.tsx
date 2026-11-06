// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminTargetInfo } from "../admin/context";
import LibraryView from "./LibraryView";
import { JobsProvider } from "../jobs";

interface Frame {
  kind: string;
  evt?: unknown;
  reason?: unknown;
}

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  channels: [] as { onmessage: (frame: Frame) => void }[],
}));
const scope = vi.hoisted(() => ({
  current: undefined as undefined | (() => AdminTargetInfo),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: bridge.invoke,
  Channel: class {
    onmessage = (_frame: Frame) => {};
    constructor() {
      bridge.channels.push(this);
    }
  },
}));
vi.mock("../components/BlobReferenceMaintenance", () => ({ default: () => null }));
vi.mock("../components/LibraryDiskPicker", () => ({ default: () => null }));
vi.mock("../admin/context", () => ({
  useAdminTransport: () => ({
    current: () => scope.current!(),
    isRemote: () => scope.current!().kind === "remote",
    dispatch: (command: string, args: unknown) =>
      bridge.invoke("admin_dispatch", { command, args, target: scope.current!() }),
    dispatchOrThrow: async (command: string, args: unknown) =>
      (await bridge.invoke("admin_dispatch", { command, args, target: scope.current!() })).data,
  }),
}));

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
let snapshot: Promise<unknown>;
let enqueue: Promise<unknown>;
const remote: AdminTargetInfo = { kind: "remote", label: "Pi", peerAddr: "peer" };

async function settle() {
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

afterEach(async () => {
  dispose?.();
  await settle();
  host?.remove();
  bridge.invoke.mockReset();
  bridge.channels.length = 0;
});

function mount(target = remote) {
  snapshot = Promise.resolve([{ job_id: "poster", status: "running", last_message: "starting" }]);
  enqueue = Promise.resolve({
    success: true,
    message: "queued",
    data: { id: "poster", job_type: "RegenerateVideoPosters" },
  });
  bridge.invoke.mockImplementation(async (command, payload) => {
    if (command === "jobs_events_subscribe") return "subscription";
    if (command === "jobs_events_snapshot") return payload.filter?.job_ids ? snapshot : [];
    if (command !== "admin_dispatch") return null;
    if (
      payload.command === "maintenance_regenerate_library_video_thumbnails" &&
      !payload.args?.dry_run
    ) {
      return enqueue;
    }
    const data =
      payload.command === "maintenance_reorganize_library_source_dirs"
        ? { source_music_directory: "", source_video_directory: "" }
        : payload.command.startsWith("library_list") || payload.command === "jobs_list"
          ? []
          : {};
    return { success: true, message: "ok", data };
  });
  const [current, setCurrent] = createSignal(target);
  scope.current = current;
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <JobsProvider>
        <LibraryView />
      </JobsProvider>
    ),
    host,
  );
  return setCurrent;
}

async function start() {
  await settle();
  for (const input of host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    if (input.checked) input.click();
  }
  const label = [...host.querySelectorAll("label")].find((item) =>
    item.textContent?.includes("regenerate every existing video poster"),
  );
  label!.querySelector<HTMLInputElement>("input")!.click();
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === "run maintenance tasks",
  );
  expect(button?.disabled).toBe(false);
  button!.click();
  await settle();
}

function emit(evt: unknown) {
  bridge.channels[bridge.channels.length - 1]!.onmessage({ kind: "event", evt });
}

describe("library poster job event flow", () => {
  it("keeps active job progress and waits when a large queue arrives", async () => {
    mount();
    await start();
    for (let i = 0; i < 250; i++) {
      emit({
        kind: "status_changed",
        job_id: `queued-${i}`,
        topic: "RegenerateVideoPosters",
        to: "pending",
      });
    }
    expect(host.textContent).toContain("1 running · 250 pending");
    emit({ kind: "status_changed", job_id: "poster", to: "completed" });
    await settle();
    expect(host.textContent).toContain("job complete: RegenerateVideoPosters");
  });

  it("waits and renders progress for other queued job types without command-specific logic", async () => {
    mount();
    enqueue = Promise.resolve({
      success: true,
      data: { id: "repair", job_type: "RepairLibraryImages" },
    });
    snapshot = Promise.resolve([
      {
        job_id: "repair",
        job_type: "RepairLibraryImages",
        status: "running",
        last_message: "repairing",
      },
    ]);
    await start();
    emit({
      kind: "stage",
      job_id: "repair",
      message: "repairing art",
      details: { checked: 2, total: 3 },
    });
    expect(host.textContent).toContain("2 / 3");
    expect(host.textContent).toContain("repairing art");
    emit({ kind: "status_changed", job_id: "repair", to: "completed" });
    await settle();
    expect(host.textContent).toContain("job complete: RepairLibraryImages");
  });

  it("uses the selected remote channel, streams progress, and never polls the dashboard", async () => {
    mount();
    await start();
    expect(bridge.invoke).toHaveBeenCalledWith(
      "jobs_events_subscribe",
      expect.objectContaining({ targetPeer: "peer" }),
    );
    emit({
      kind: "stage",
      job_id: "poster",
      message: "extracting frame",
      details: { checked: 4, total: 10 },
    });
    expect(host.textContent).toContain("4 / 10");
    expect(host.textContent).toContain("extracting frame");
    emit({ kind: "status_changed", job_id: "poster", to: "completed" });
    await settle();
    expect(host.textContent).toContain("job complete: RegenerateVideoPosters");
    expect(
      bridge.invoke.mock.calls.filter(([command]) => command === "jobs_events_snapshot"),
    ).toHaveLength(2);
    expect(
      bridge.invoke.mock.calls.some(([, payload]) => payload?.command === "jobs_dashboard"),
    ).toBe(false);
  });

  it("does not let a late running snapshot overwrite a newer stage", async () => {
    mount();
    let resolve!: (items: unknown) => void;
    snapshot = new Promise((done) => {
      resolve = done;
    });
    await start();
    emit({
      kind: "stage",
      job_id: "poster",
      message: "new progress",
      details: { checked: 7, total: 10 },
    });
    resolve([{ job_id: "poster", status: "running", last_message: "old progress" }]);
    await settle();
    expect(host.textContent).toContain("7 / 10");
    expect(host.textContent).toContain("new progress");
    emit({ kind: "status_changed", job_id: "poster", to: "completed" });
    await settle();
  });

  it("covers completion before the enqueue reply with one snapshot", async () => {
    mount();
    snapshot = Promise.resolve([{ job_id: "poster", status: "completed", last_message: null }]);
    await start();
    expect(host.textContent).toContain("job complete: RegenerateVideoPosters");
  });

  it("waits for the rich failure event instead of the earlier status transition", async () => {
    mount();
    await start();
    emit({ kind: "status_changed", job_id: "poster", to: "failed" });
    await settle();
    expect(host.textContent).not.toContain("failed: poster job failed");
    emit({ kind: "failed", job_id: "poster", message: "poster disk disconnected" });
    await settle();
    expect(host.textContent).toContain("failed: Error: poster disk disconnected");
  });

  it("reports a stream closure even when it precedes the enqueue reply", async () => {
    mount();
    let resolve!: (reply: unknown) => void;
    enqueue = new Promise((done) => {
      resolve = done;
    });
    await start();
    bridge.channels[bridge.channels.length - 1]!.onmessage({ kind: "closed", reason: "offline" });
    resolve({ success: true, data: { id: "poster", job_type: "RegenerateVideoPosters" } });
    await settle();
    expect(host.textContent).toContain("job progress stream closed");
    expect(host.textContent).not.toContain("job complete: RegenerateVideoPosters");
  });

  it("subscribes locally and replaces the subscription when retargeted", async () => {
    const setCurrent = mount({ kind: "local", label: "local" });
    await settle();
    expect(bridge.invoke).toHaveBeenCalledWith(
      "jobs_events_subscribe",
      expect.objectContaining({ targetPeer: null }),
    );
    setCurrent(remote);
    await start();
    expect(bridge.invoke).toHaveBeenCalledWith("jobs_events_unsubscribe", {
      sessionId: "subscription",
    });
    setCurrent({ ...remote, peerAddr: "other-peer" });
    await settle();
    expect(host.textContent).toContain("admin target changed");
    expect(bridge.invoke).toHaveBeenCalledWith(
      "jobs_events_subscribe",
      expect.objectContaining({ targetPeer: "other-peer" }),
    );
  });
});

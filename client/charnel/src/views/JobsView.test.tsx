// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { HashRouter, Route } from "@solidjs/router";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminTargetInfo } from "../admin/context";
import { JobsProvider, type Dashboard, type JobRow } from "../jobs";
import JobsView from "./JobsView";

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  current: undefined as undefined | (() => AdminTargetInfo),
  channels: [] as { onmessage: (frame: { kind: string; evt?: unknown }) => void }[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mock.invoke,
  Channel: class {
    onmessage = (_frame: { kind: string; evt?: unknown }) => {};
    constructor() {
      mock.channels.push(this);
    }
  },
}));
vi.mock("../admin/context", () => ({
  useAdminTransport: () => ({
    current: () => mock.current!(),
    dispatch: mock.dispatch,
    dispatchOrThrow: async (command: string, args: unknown) => {
      const response = await mock.dispatch(command, args);
      if (!response.success) throw new Error(response.message);
      return response.data;
    },
  }),
}));

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
let retried = false;
let closed = false;
const row = (id = "poster"): JobRow => ({
  id,
  session_id: "session",
  job_type: "RegenerateVideoPosters",
  status: retried ? "Pending" : "Running",
  started_at: 100,
  completed_at: null,
  scheduled_at: 90,
  retry_count: 0,
  max_retries: 0,
  error_message: null,
  message: "extracting frame",
  stage: "posters",
  checked: 5,
  total: 10,
  last_activity_at: 110,
  activity_source: "progress event",
});
function dashboard(args: { view: string; page: number; job_id: string | null }): Dashboard {
  return {
    stats: { running: 8, pending: 40, failed: 2, completed: 100, cancelled: 1, sessions: 5 },
    groups: [{ job_type: "RegenerateVideoPosters", status: "Running", count: 8 }],
    jobs:
      args.view === "overview" ? Array.from({ length: 8 }, (_, i) => row(`poster-${i}`)) : [row()],
    active_jobs: [row()],
    sessions: [
      {
        id: "session",
        job_type: "RegenerateVideoPosters",
        status: "Running",
        running: 1,
        pending: 2,
        completed: 4,
        failed: 1,
        cancelled: 0,
        created_at: 90,
        updated_at: 110,
      },
    ],
    total: 41,
    page: args.page,
    page_size: args.view === "overview" ? 8 : 20,
    detail: args.job_id
      ? {
          ...row(args.job_id),
          status: retried ? "Pending" : "Failed",
          error_message: retried ? null : "disk offline",
          parameters: '{"dry_run":false}',
          result: '[{"error_type":"video_poster_regeneration_failed","detail":"disk offline"}]',
        }
      : null,
    detail_summary: args.job_id ? row(args.job_id) : null,
    selected_session:
      "session_id" in args && args.session_id
        ? {
            id: "session",
            job_type: "ScanDirectory",
            status: closed ? "Completed" : "Idle",
            running: 0,
            pending: 0,
            completed: 2,
            failed: 0,
            cancelled: 0,
            created_at: 90,
            updated_at: 110,
            started_at: 100,
            ended_at: 110,
            can_close: !closed,
            closed,
          }
        : null,
  };
}
async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}
async function refreshEvents() {
  await settle();
  await vi.advanceTimersByTimeAsync(300);
  await settle();
}
function mount() {
  vi.useFakeTimers();
  retried = false;
  closed = false;
  window.location.hash = "#/jobs";
  const [current, setCurrent] = createSignal<AdminTargetInfo>({
    kind: "remote",
    label: "Pi",
    peerAddr: "peer",
  });
  mock.current = current;
  mock.invoke.mockImplementation(async (command) =>
    command === "jobs_events_subscribe"
      ? "subscription"
      : command === "jobs_events_snapshot"
        ? []
        : null,
  );
  mock.dispatch.mockImplementation(async (command, args) => {
    if (command === "jobs_retry") {
      retried = true;
      return { success: true, data: { job_id: args.job_id } };
    }
    if (command === "jobs_close_idle_session") {
      closed = true;
      return { success: true, data: { session_id: args.session_id } };
    }
    return { success: true, data: dashboard(args) };
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <HashRouter root={(props) => <JobsProvider>{props.children}</JobsProvider>}>
        <Route path="/jobs" component={JobsView} />
      </HashRouter>
    ),
    host,
  );
  return setCurrent;
}
function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
  );
  expect(button, label).toBeDefined();
  button!.click();
}
function selectView(value: string) {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="jobs view"]')!;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
afterEach(() => {
  dispose?.();
  host.remove();
  mock.invoke.mockReset();
  mock.dispatch.mockReset();
  mock.channels.length = 0;
  vi.useRealTimers();
});

describe("wizard jobs dashboard", () => {
  it("confirms bulk closure, reports the count, and refreshes the overview", async () => {
    mount();
    await refreshEvents();
    mock.dispatch.mockImplementation(async (command, args) => {
      if (command === "jobs_close_idle_sessions") {
        closed = true;
        return { success: true, data: { closed_sessions: 12 } };
      }
      const snapshot = dashboard(args);
      if (closed) snapshot.sessions = [];
      return { success: true, data: snapshot };
    });
    click("close all idle sessions");
    expect(mock.dispatch.mock.calls.some(([cmd]) => cmd === "jobs_close_idle_sessions")).toBe(
      false,
    );
    click("confirm close all");
    await settle();
    expect(mock.dispatch).toHaveBeenCalledWith("jobs_close_idle_sessions", { confirm: true });
    expect(host.textContent).toContain("closed 12 idle sessions");
    expect(host.textContent).toContain("no matching sessions");
  });

  it("keeps close errors visible after a successful background refresh", async () => {
    mount();
    await refreshEvents();
    mock.dispatch.mockImplementation(async (command, args) => {
      if (command === "jobs_close_idle_sessions")
        return { success: false, message: "remote library needs an update" };
      return { success: true, data: dashboard(args) };
    });
    click("close all idle sessions");
    click("confirm close all");
    await settle();
    expect(host.textContent).toContain("remote library needs an update");
    click("refresh jobs");
    await settle();
    expect(host.textContent).toContain("remote library needs an update");
    expect(host.textContent).toContain("close all idle sessions");
  });

  it("keeps individual close failures visible after refreshing the selected session", async () => {
    mount();
    await refreshEvents();
    selectView("sessions");
    await refreshEvents();
    host.querySelector<HTMLButtonElement>(".job-list-row")!.click();
    await refreshEvents();
    mock.dispatch.mockImplementation(async (command, args) => {
      if (command === "jobs_close_idle_session")
        return { success: false, message: "session has pending/running jobs" };
      return { success: true, data: dashboard(args) };
    });
    click("close idle session");
    click("confirm close");
    await settle();
    expect(host.textContent).toContain("session has pending/running jobs");
    click("refresh jobs");
    await settle();
    expect(host.textContent).toContain("session has pending/running jobs");
  });

  it("reacts to different job inspection links while the view remains mounted", async () => {
    mount();
    await refreshEvents();
    for (const id of ["first-job", "second-job"]) {
      window.location.hash = `#/jobs?job=${id}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      await refreshEvents();
      expect(mock.dispatch).toHaveBeenLastCalledWith(
        "jobs_dashboard",
        expect.objectContaining({ job_id: id }),
      );
    }
    expect(
      mock.invoke.mock.calls.filter(([command]) => command === "jobs_events_subscribe"),
    ).toHaveLength(1);
  });

  it("shows bounded overview and refreshes from events rather than polling", async () => {
    mount();
    await refreshEvents();
    expect(host.querySelectorAll(".job-list-row")).toHaveLength(9);
    expect(host.textContent).toContain("50%");
    const before = mock.dispatch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.dispatch.mock.calls).toHaveLength(before);
    mock.channels[0].onmessage({
      kind: "event",
      evt: { kind: "stage", job_id: "poster", topic: "RegenerateVideoPosters" },
    });
    await refreshEvents();
    expect(mock.dispatch.mock.calls).toHaveLength(before + 1);
  });

  it("filters, pages, inspects structured errors, and requires retry confirmation", async () => {
    mount();
    await refreshEvents();
    selectView("Failed");
    await refreshEvents();
    click("toggle job search");
    const input = host.querySelector<HTMLInputElement>("input")!;
    input.value = "disk";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await refreshEvents();
    expect(mock.dispatch).toHaveBeenLastCalledWith(
      "jobs_dashboard",
      expect.objectContaining({ view: "Failed", query: "disk" }),
    );
    click("next");
    await refreshEvents();
    expect(mock.dispatch).toHaveBeenLastCalledWith(
      "jobs_dashboard",
      expect.objectContaining({ page: 1 }),
    );
    host.querySelector<HTMLButtonElement>(".job-list-row")!.click();
    await refreshEvents();
    expect(host.textContent).toContain("video_poster_regeneration_failed");
    click("retry failed job");
    expect(mock.dispatch.mock.calls.some(([command]) => command === "jobs_retry")).toBe(false);
    click("confirm retry");
    await settle();
    expect(mock.dispatch).toHaveBeenCalledWith("jobs_retry", { job_id: "poster", confirm: true });
    expect(host.textContent).not.toContain("retry failed job");
  });

  it("clears session filters and rejects stale dashboard replies when retargeted", async () => {
    const setCurrent = mount();
    await refreshEvents();
    selectView("sessions");
    await refreshEvents();
    host.querySelector<HTMLButtonElement>(".job-list-row")!.click();
    await refreshEvents();
    expect(mock.dispatch).toHaveBeenLastCalledWith(
      "jobs_dashboard",
      expect.objectContaining({ session_id: "session" }),
    );
    let resolve!: (reply: unknown) => void;
    mock.dispatch.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    click("refresh jobs");
    await settle();
    setCurrent({ kind: "remote", label: "other", peerAddr: "other-peer" });
    await refreshEvents();
    resolve({
      success: true,
      data: { ...dashboard({ view: "all", page: 0, job_id: null }), jobs: [row("old-peer-job")] },
    });
    await settle();
    expect(host.textContent).not.toContain("old-peer-job");
    expect(mock.dispatch).toHaveBeenLastCalledWith(
      "jobs_dashboard",
      expect.objectContaining({ session_id: null }),
    );
  });

  it("uses compact controls, toggles styled search and filters exact work types", async () => {
    mount();
    await refreshEvents();
    expect(host.querySelector('input[aria-label="search jobs"]')).toBeNull();
    expect(host.querySelector(".jobs-tabs")).toBeNull();
    expect(host.querySelector(".jobs-stats")).toBeNull();
    click("toggle job search");
    expect(host.querySelector('input[aria-label="search jobs"]')?.className).toBe("jobs-search");
    click("toggle job search");
    host.querySelector<HTMLAnchorElement>(".scan-progress-card a")!.click();
    await refreshEvents();
    expect(mock.dispatch).toHaveBeenLastCalledWith(
      "jobs_dashboard",
      expect.objectContaining({ view: "Running", job_type: "RegenerateVideoPosters" }),
    );
    click("clear filters");
    await refreshEvents();
    expect(mock.dispatch).toHaveBeenLastCalledWith(
      "jobs_dashboard",
      expect.objectContaining({ job_type: null }),
    );
  });

  it("shows activity timestamps and run span, and closes idle sessions only after confirmation", async () => {
    mount();
    await refreshEvents();
    selectView("sessions");
    await refreshEvents();
    host.querySelector<HTMLButtonElement>(".job-list-row")!.click();
    await refreshEvents();
    expect(host.textContent).toContain("last activity:");
    expect(host.textContent).toContain("run span: 10s");
    click("close idle session");
    expect(mock.dispatch.mock.calls.some(([cmd]) => cmd === "jobs_close_idle_session")).toBe(false);
    click("confirm close");
    await settle();
    expect(mock.dispatch).toHaveBeenCalledWith("jobs_close_idle_session", {
      session_id: "session",
      confirm: true,
    });
    expect(host.textContent).not.toContain("close idle session");
    expect(host.textContent).toContain("completed (closed)");
  });

  it("labels disconnected source attempts as skipped instead of failed", async () => {
    mount();
    await refreshEvents();
    mock.dispatch.mockImplementation(
      async (command: string, args: Parameters<typeof dashboard>[0]) => {
        if (command === "jobs_dashboard") {
          const snapshot = dashboard(args);
          snapshot.jobs = [
            {
              ...row(),
              status: "Completed",
              skipped: true,
              message: "skipped: library source disconnected; scan again on reconnect",
            },
          ];
          return { success: true, data: snapshot };
        }
        return { success: true };
      },
    );
    selectView("completed");
    await refreshEvents();
    expect(host.textContent).toContain("skipped: library source disconnected");
    expect(host.textContent).toContain("skipped");
  });
});

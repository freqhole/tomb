import { Channel, invoke } from "@tauri-apps/api/core";
import {
  createContext,
  createEffect,
  createSignal,
  on,
  onCleanup,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";
import { useAdminTransport, type AdminTargetInfo } from "./admin/context";
import type { AdminResponse } from "./admin/transport";
import { formatDateTime, formatRelativeTime } from "./utils/dateTime";

export interface JobEvent {
  kind: string;
  job_id?: string;
  session_id?: string;
  topic?: string;
  to?: string;
  message?: string;
  complete?: number;
  total?: number;
  details?: Record<string, unknown>;
}

export interface TrackedJob {
  job_id: string;
  session_id: string | null;
  job_type: string;
  status: string;
  last_message: string | null;
  errors?: { detail: string }[] | null;
  checked?: number;
  total?: number;
  revision?: number;
}

export interface JobRow {
  id: string;
  session_id: string | null;
  job_type: string;
  status: string;
  started_at: number | null;
  completed_at: number | null;
  scheduled_at: number;
  retry_count: number;
  max_retries: number;
  error_message: string | null;
  message: string | null;
  stage: string | null;
  checked: number | null;
  total: number | null;
  last_activity_at?: number;
  activity_source?: string;
  skipped?: boolean;
}

export interface SessionRow {
  id: string;
  job_type: string;
  status: string;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  created_at?: number;
  updated_at?: number;
  started_at?: number | null;
  ended_at?: number | null;
  can_close?: boolean;
  closed?: boolean;
}

export interface Dashboard {
  stats: Record<"running" | "pending" | "failed" | "completed" | "cancelled" | "sessions", number>;
  groups: { job_type: string; status: string; count: number }[];
  jobs: JobRow[];
  active_jobs: JobRow[];
  sessions: SessionRow[];
  total: number;
  page: number;
  page_size: number;
  selected_session?: SessionRow | null;
  detail:
    | (Omit<JobRow, "checked" | "total" | "stage" | "message"> & {
        parameters: string;
        result: string | null;
      })
    | null;
  detail_summary: JobRow | null;
}

interface JobTracking {
  jobs: Accessor<TrackedJob[]>;
  revision: Accessor<number>;
  error: Accessor<string>;
  connected: Accessor<boolean>;
  reconnect: () => Promise<void>;
  onEvent: (listener: (event: JobEvent) => void) => () => void;
  dispatch: <T = unknown>(command: string, args?: unknown) => Promise<AdminResponse<T>>;
  dispatchAndWait: <T = unknown>(command: string, args?: unknown) => Promise<AdminResponse<T>>;
}

const JobContext = createContext<JobTracking>();
const active = (status: string) => ["pending", "running"].includes(status.toLowerCase());

export function JobsProvider(props: ParentProps) {
  const admin = useAdminTransport();
  const [jobs, setJobs] = createSignal<TrackedJob[]>([]);
  const [revision, setRevision] = createSignal(0);
  const [error, setError] = createSignal("");
  const [connected, setConnected] = createSignal(false);
  const listeners = new Set<(event: JobEvent) => void>();
  const waiters = new Set<{ id: string; resolve: () => void; reject: (error: Error) => void }>();
  let generation = 0;
  let subscription: string | null = null;
  let ready: Promise<void> = Promise.resolve();

  function rejectWaiters(reason: string) {
    for (const waiter of waiters) waiter.reject(new Error(reason));
    waiters.clear();
  }

  function settleWaiters() {
    for (const waiter of waiters) {
      const job = jobs().find((item) => item.job_id === waiter.id);
      if (!job || active(job.status)) continue;
      if (job.status === "failed" || job.status === "cancelled") {
        waiter.reject(
          new Error(
            job.errors?.map((e) => e.detail).join("; ") || job.last_message || `job ${job.status}`,
          ),
        );
      } else if (job.status === "completed") {
        waiter.resolve();
      } else continue;
      waiters.delete(waiter);
    }
  }

  function update(job: TrackedJob) {
    setJobs((items) => {
      const rest = items.filter((item) => item.job_id !== job.job_id);
      const waiting = new Set([...waiters].map((waiter) => waiter.id));
      let history = 0;
      return [job, ...rest].filter(
        (item) => active(item.status) || waiting.has(item.job_id) || history++ < 200,
      );
    });
    settleWaiters();
  }

  async function snapshot(target: AdminTargetInfo, current: number, ids?: string[]) {
    const baseline = revision();
    const rows = await invoke<TrackedJob[]>("jobs_events_snapshot", {
      filter: ids ? { job_ids: ids } : null,
      targetPeer: target.kind === "remote" ? target.peerAddr : null,
    });
    if (current !== generation) return;
    if (!Array.isArray(rows)) throw new Error("job snapshot returned an invalid reply");
    for (const row of rows) {
      const existing = jobs().find((job) => job.job_id === row.job_id);
      if ((existing?.revision ?? 0) > baseline) continue;
      update({ ...existing, ...row, revision: baseline });
    }
    if (ids?.some((id) => !rows.some((row) => row.job_id === id))) {
      throw new Error("queued job is unavailable on the selected target");
    }
    setRevision((value) => value + 1);
  }

  function receive(event: JobEvent) {
    const next = revision() + 1;
    if (event.job_id) {
      const previous = jobs().find((job) => job.job_id === event.job_id);
      // the following failed event carries the useful error message.
      const status =
        event.to === "failed"
          ? (previous?.status ?? "running")
          : (event.to ?? previous?.status ?? "running");
      update({
        ...previous,
        job_id: event.job_id,
        session_id: event.session_id ?? previous?.session_id ?? null,
        job_type: event.topic ?? previous?.job_type ?? "unknown",
        status: event.kind === "failed" ? "failed" : status,
        last_message: event.message ?? previous?.last_message ?? null,
        checked:
          typeof event.details?.checked === "number" ? event.details.checked : previous?.checked,
        total: typeof event.details?.total === "number" ? event.details.total : previous?.total,
        errors:
          event.kind === "failed" ? [{ detail: event.message ?? "job failed" }] : previous?.errors,
        revision: next,
      });
    }
    setRevision(next);
    for (const listener of listeners) listener(event);
  }

  function unsubscribe() {
    const id = subscription;
    subscription = null;
    if (id)
      void invoke("jobs_events_unsubscribe", { sessionId: id }).catch((e) =>
        console.error("could not unsubscribe from job progress:", e),
      );
  }

  async function connect(target: AdminTargetInfo) {
    const current = ++generation;
    unsubscribe();
    rejectWaiters(
      "admin target changed or job stream restarted; queued work continues on its original target",
    );
    setJobs([]);
    setConnected(false);
    setError("");
    setRevision((value) => value + 1);
    try {
      if (target.kind === "remote" && !target.peerAddr)
        throw new Error("remote job progress requires a connected peer");
      const channel = new Channel<{ kind: string; evt?: JobEvent; reason?: unknown }>();
      channel.onmessage = (frame) => {
        if (current !== generation) return;
        if (frame.kind === "event" && frame.evt) receive(frame.evt);
        else if (frame.kind === "closed") {
          const reason = "job progress stream closed; queued work continues on the server";
          setConnected(false);
          setError(reason);
          rejectWaiters(reason);
          console.error(reason, frame.reason);
        }
      };
      const id = await invoke<string>("jobs_events_subscribe", {
        filter: null,
        events: channel,
        targetPeer: target.kind === "remote" ? target.peerAddr : null,
      });
      if (current !== generation) {
        await invoke("jobs_events_unsubscribe", { sessionId: id });
        return;
      }
      subscription = id;
      if (error()) throw new Error(error());
      setConnected(true);
      await snapshot(target, current);
    } catch (e) {
      if (current === generation) {
        setConnected(false);
        const message = `job progress unavailable: ${e}`;
        setError(message);
        rejectWaiters(message);
        console.error(message);
      }
      throw e;
    }
  }

  createEffect(
    on(admin.current, (target) => {
      ready = connect(target);
      void ready.catch((e) => console.error("could not start shared job tracking:", e));
    }),
  );
  onCleanup(() => {
    generation++;
    unsubscribe();
    rejectWaiters("job tracking closed; queued work continues on the server");
  });

  async function dispatch<T>(
    command: string,
    args: unknown = {},
    wait = false,
  ): Promise<AdminResponse<T>> {
    const target = admin.current();
    const current = generation;
    await ready;
    if (current !== generation) throw new Error("admin target changed before job dispatch");
    if (!connected()) throw new Error(error() || "job progress is disconnected");
    const response = await admin.dispatch<T>(command, args);
    if (current !== generation)
      throw new Error("admin target changed; dispatched work continues on its original target");
    if (!response.success) return response;
    const data = response.data;
    if (
      typeof data !== "object" ||
      data === null ||
      !("id" in data) ||
      typeof data.id !== "string" ||
      !("job_type" in data) ||
      typeof data.job_type !== "string"
    )
      return response;
    const id = data.id;
    if (!connected()) throw new Error(error() || "job progress stream closed");
    if (!jobs().some((job) => job.job_id === id)) {
      update({
        job_id: id,
        job_type: data.job_type,
        session_id: null,
        status: "pending",
        last_message: "queued",
      });
    }
    if (!wait) {
      await snapshot(target, current, [id]);
      return response;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = { id, resolve, reject };
      waiters.add(waiter);
      settleWaiters();
      void snapshot(target, current, [id]).catch((e) => {
        waiters.delete(waiter);
        reject(new Error(`could not snapshot queued job: ${e}`));
      });
    });
    return { ...response, message: `job complete: ${data.job_type}` };
  }

  return (
    <JobContext.Provider
      value={{
        jobs,
        revision,
        error,
        connected,
        reconnect: () => {
          ready = connect(admin.current());
          return ready;
        },
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        dispatch: <T,>(command: string, args?: unknown) => dispatch<T>(command, args),
        dispatchAndWait: <T,>(command: string, args?: unknown) => dispatch<T>(command, args, true),
      }}
    >
      {props.children}
    </JobContext.Provider>
  );
}

export function useJobs() {
  const context = useContext(JobContext);
  if (!context) throw new Error("useJobs must be used inside JobsProvider");
  return context;
}

export function jobProgress(job: JobRow, now = Date.now() / 1000) {
  const seconds =
    job.started_at === null || (job.completed_at === null && job.status !== "Running")
      ? null
      : Math.max(0, (job.completed_at ?? now) - job.started_at);
  const elapsed =
    seconds === null
      ? job.started_at === null
        ? "not started"
        : "duration unknown"
      : `${job.status === "Running" ? "running for" : "ran for"} ${jobDuration(seconds)}`;
  if (job.checked === null || job.total === null || job.total <= 0)
    return `${elapsed} · progress unknown`;
  const done = Math.min(job.checked, job.total);
  const eta =
    seconds !== null && seconds >= 5 && done > 0 && done < job.total && job.status === "Running"
      ? ` · ~${Math.ceil((seconds * (job.total - done)) / done / 60)}m left`
      : "";
  return `${Math.floor((done * 100) / job.total)}% · ${elapsed}${eta}`;
}

export function jobDuration(seconds: number) {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m`;
}

export function jobTimestamp(timestamp: number | undefined, now = Date.now() / 1000) {
  if (timestamp === undefined || timestamp <= 0) return "time unknown";
  const relative = formatRelativeTime(timestamp * 1000, new Date(now * 1000))
    .replace("a moment ago", "just now")
    .replace(/(\d+) seconds?/, "$1s")
    .replace(/(\d+) minutes?/, "$1m");
  return `${relative} · ${formatDateTime(timestamp * 1000)}`;
}

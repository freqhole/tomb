// job service — waits for async server jobs (image uploads, music imports, etc.)
// by subscribing to the typed broker via `client.jobs.events.subscribe`.
//
// the public api (`JobPoller`, `pollJobUntilComplete`, `pollJobWithDetails`)
// is unchanged. internally each `waitForJob(jobId)` opens its own subscription
// filtered to that job id; subscriptions are cheap streams (iroh bistream on
// p2p remotes, tauri channel on charnel-managed remotes, http polling on http
// remotes), so the polling-era batching has been removed.

import type { JobEvent, JobStateSnapshot } from "freqhole-api-client";
import { JobEventsStreamClosed } from "freqhole-api-client";

import { getClientForRemote, type RemoteRef } from "../../api/client";
import { debug, warn, error as errorLog } from "../../../utils/logger";

/** result of polling a job to completion */
export type PollResult = "completed" | "failed" | "timeout";

/** structured error detail from a failed job (matches server ErrorDetail) */
export interface JobError {
  error_type: string;
  title: string;
  detail: string;
}

/** detailed result from polling a job */
export interface PollResultDetails {
  status: PollResult;
  /** error message from the server (if job failed) - first error's detail */
  errorMessage?: string;
  /** structured errors from the server (if job failed) */
  errors?: JobError[];
}

/** callback fired for each `Stage` event scoped to the polled job id. */
export type JobStageCallback = (stage: string, message: string | undefined) => void;

/** optional per-wait callbacks. */
export interface WaitForJobOptions {
  /** invoked on each `Stage` event for the polled job id. */
  onStage?: JobStageCallback;
}

// ============================================================================
// JobPoller - one subscription per waitForJob; stop() aborts all in-flight
// ============================================================================

/**
 * tracks in-flight job waits so callers can stop() them all at once.
 * each `waitForJob(jobId)` opens its own subscription scoped to that id.
 */
export class JobPoller {
  private remote: RemoteRef;
  private inflight = new Set<AbortController>();

  // kept for api compatibility; ignored. event streams have no client-side
  // poll interval.
  constructor(remote: RemoteRef, _pollIntervalMs: number = 3000) {
    this.remote = remote;
  }

  /**
   * wait for a single job until it completes, fails, or times out.
   */
  waitForJob(
    jobId: string,
    timeoutMs: number = 120_000,
    opts?: WaitForJobOptions,
  ): Promise<PollResultDetails> {
    const ac = new AbortController();
    this.inflight.add(ac);
    return subscribeAndWait(this.remote, jobId, timeoutMs, ac, opts).finally(() => {
      this.inflight.delete(ac);
    });
  }

  /** stop all in-flight waits; pending promises resolve as timeout. */
  stop() {
    for (const ac of this.inflight) ac.abort();
    this.inflight.clear();
  }
}

// ============================================================================
// internal: one subscription per wait
// ============================================================================

async function subscribeAndWait(
  remote: RemoteRef,
  jobId: string,
  timeoutMs: number,
  controller: AbortController,
  opts?: WaitForJobOptions,
): Promise<PollResultDetails> {
  let client;
  try {
    client = await getClientForRemote(remote);
  } catch (err) {
    errorLog("jobs", `waitForJob ${jobId}: getClientForRemote failed:`, err);
    return { status: "failed", errorMessage: String(err) };
  }

  // initial snapshot to catch jobs that finished before we could subscribe.
  // missing from snapshot = either already-completed-and-evicted, or simply
  // not yet visible; either way the live subscription handles the rest.
  try {
    const snap: JobStateSnapshot[] = await client.jobs.events.snapshot({
      job_ids: [jobId],
    });
    const cur = snap.find((s) => s.job_id === jobId);
    if (cur) {
      if (cur.status === "completed") {
        debug("jobs", `job ${jobId} already completed (snapshot)`);
        return { status: "completed" };
      }
      if (cur.status === "failed" || cur.status === "cancelled") {
        const msg = cur.last_message ?? undefined;
        debug("jobs", `job ${jobId} already terminal (snapshot): ${cur.status}`);
        return {
          status: "failed",
          errorMessage: msg,
          errors: msg
            ? [{ error_type: "unknown", title: cur.status, detail: msg }]
            : undefined,
        };
      }
    }
  } catch (err) {
    // snapshot failed — proceed to subscribe anyway
    warn("jobs", `waitForJob ${jobId}: snapshot failed (continuing):`, err);
  }

  // subscribe and wait for a terminal event for this jobId.
  return new Promise<PollResultDetails>((resolve) => {
    let settled = false;
    const finish = (r: PollResultDetails) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (idleTimerId !== undefined) clearTimeout(idleTimerId);
      if (terminalGraceTimer !== undefined) clearTimeout(terminalGraceTimer);
      controller.abort();
      resolve(r);
    };

    const timeoutId = setTimeout(() => {
      warn("jobs", `job ${jobId} timed out`);
      finish({ status: "timeout" });
    }, timeoutMs);

    // idle-watchdog: if no event arrives within IDLE_POLL_MS, fall back
    // to a one-shot snapshot. covers cases where the event stream is up
    // but a particular event was missed (broker lag, reconnect gap, etc).
    // each event resets the timer; a snapshot poll also resets it so we
    // don't hammer the server on a quiet job.
    const IDLE_POLL_MS = 30_000;
    let idleTimerId: ReturnType<typeof setTimeout> | undefined;
    const armIdleTimer = () => {
      if (idleTimerId !== undefined) clearTimeout(idleTimerId);
      idleTimerId = setTimeout(pollSnapshotOnIdle, IDLE_POLL_MS);
    };
    const pollSnapshotOnIdle = async () => {
      if (settled) return;
      try {
        const snap: JobStateSnapshot[] = await client.jobs.events.snapshot({
          job_ids: [jobId],
        });
        if (settled) return;
        const cur = snap.find((s) => s.job_id === jobId);
        if (cur) {
          if (cur.status === "completed") {
            debug("jobs", `job ${jobId} completed (idle-poll)`);
            finish({ status: "completed" });
            return;
          }
          if (cur.status === "failed" || cur.status === "cancelled") {
            const msg = cur.last_message ?? undefined;
            debug("jobs", `job ${jobId} terminal via idle-poll: ${cur.status}`);
            finish({
              status: "failed",
              errorMessage: msg,
              errors: msg
                ? [{ error_type: "unknown", title: cur.status, detail: msg }]
                : undefined,
            });
            return;
          }
        }
      } catch (err) {
        warn("jobs", `job ${jobId}: idle snapshot poll failed (continuing):`, err);
      }
      armIdleTimer();
    };
    armIdleTimer();

    // capture rich error details from a `failed` event if it arrives.
    // the runner emits `status_changed { to: failed }` FIRST, then a
    // `failed` event carrying the real error_type + message (e.g.
    // "duplicate_song"). if we resolve immediately on the status
    // transition we lose that detail, so when the transition arrives
    // without a detail in hand we wait a short grace period for the
    // `failed` event to land before giving up on structured info.
    let lastFailedDetail: { error_type: string; message: string } | null = null;
    let terminalGraceTimer: ReturnType<typeof setTimeout> | undefined;
    const TERMINAL_GRACE_MS = 2000;

    (async () => {
      try {
        for await (const evt of client.jobs.events.subscribe(
          { job_ids: [jobId] },
          controller.signal,
        )) {
          armIdleTimer();
          handleEvent(evt);
          if (settled) return;
        }
        // stream ended without a terminal event for this job
        if (!settled) {
          warn("jobs", `job ${jobId} subscription ended without terminal event`);
          finish({ status: "timeout" });
        }
      } catch (err) {
        if (err instanceof JobEventsStreamClosed) {
          warn("jobs", `job ${jobId} stream closed: ${err.reason.kind}`);
          finish({ status: "timeout" });
          return;
        }
        if (controller.signal.aborted) return;
        errorLog("jobs", `job ${jobId} subscription error:`, err);
        finish({ status: "failed", errorMessage: String(err) });
      }
    })();

    function handleEvent(evt: JobEvent) {
      if (evt.kind === "stage" && evt.job_id === jobId) {
        opts?.onStage?.(evt.stage, evt.message ?? undefined);
        return;
      }
      if (evt.kind === "failed" && evt.job_id === jobId) {
        lastFailedDetail = { error_type: evt.error_type, message: evt.message };
        finish({
          status: "failed",
          errorMessage: evt.message,
          errors: [
            { error_type: evt.error_type, title: "job failed", detail: evt.message },
          ],
        });
        return;
      }
      if (evt.kind === "status_changed" && evt.job_id === jobId) {
        if (evt.to === "completed") {
          debug("jobs", `job ${jobId} completed`);
          finish({ status: "completed" });
          return;
        }
        if (evt.to === "failed" || evt.to === "cancelled") {
          // if the `failed` event already arrived, resolve with its
          // structured detail right away. otherwise wait a short grace
          // period for it before resolving without an error_type.
          if (lastFailedDetail) {
            finishFailedFromDetail(evt.to);
            return;
          }
          if (terminalGraceTimer === undefined) {
            const toStatus = evt.to;
            terminalGraceTimer = setTimeout(() => finishFailedFromDetail(toStatus), TERMINAL_GRACE_MS);
          }
        }
      }
    }

    // resolve a failed/cancelled terminal state using whatever detail the
    // `failed` event provided (if any).
    function finishFailedFromDetail(toStatus: string) {
      const detail = lastFailedDetail?.message;
      const errType = lastFailedDetail?.error_type ?? "unknown";
      finish({
        status: "failed",
        errorMessage: detail,
        errors: detail
          ? [{ error_type: errType, title: toStatus, detail }]
          : undefined,
      });
    }
  });
}

// ============================================================================
// convenience wrappers (api preserved)
// ============================================================================

/**
 * wait for a single job until complete. creates a temporary JobPoller internally.
 */
export async function pollJobUntilComplete(
  remote: RemoteRef,
  jobId: string,
  timeoutMs: number = 10000,
  opts?: WaitForJobOptions,
): Promise<PollResult> {
  const poller = new JobPoller(remote, 0);
  const result = await poller.waitForJob(jobId, timeoutMs, opts);
  poller.stop();
  return result.status;
}

/**
 * wait for a single job with detailed result including error message.
 */
export async function pollJobWithDetails(
  remote: RemoteRef,
  jobId: string,
  timeoutMs: number = 10000,
): Promise<PollResultDetails> {
  const poller = new JobPoller(remote, 0);
  const result = await poller.waitForJob(jobId, timeoutMs);
  poller.stop();
  return result;
}
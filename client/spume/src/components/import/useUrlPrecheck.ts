// url-precheck (yt-dlp) state + orchestration, extracted from
// AddMediaModal.tsx - module-level so it survives the modal being
// closed/reopened while a precheck/job is still running (mirrors the old
// AddMusicModal/AddVideoModal's identical pattern - merged into one modal
// since both used the exact same
// client.music.createPrecheckFetchJob/getJobStatus/cancelJob calls anyway).
//
// this only owns precheck-specific state; `urlText`/`setUrlText` (the raw
// textarea contents) and `submitUrls`/`parseUrls` (which also depend on
// component props) stay in AddMediaModal.tsx and are passed in as plain
// values/callbacks where needed.
import { createSignal } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import type { CurrentRemoteInfo } from "../../music/data/currentState";
import { JobPoller } from "../../app/services/jobs/jobService";
import type { PreCheckFetchResponse } from "@freqhole/api-client";
import { toast } from "../feedback/Toast";

export type UrlPrecheckState = "idle" | "checking" | "confirm" | "error";
export type MediaDomain = "music" | "video" | "both";

const [urlPrecheckState, setUrlPrecheckState] = createSignal<UrlPrecheckState>("idle");
const [precheckResult, setPrecheckResult] = createSignal<PreCheckFetchResponse | null>(null);
const [precheckError, setPrecheckError] = createSignal<string | null>(null);
const [precheckUrls, setPrecheckUrls] = createSignal<string[]>([]);
const [precheckJobId, setPrecheckJobId] = createSignal<string | null>(null);
// running count emitted by precheck_progress stage events
const [precheckLiveCount, setPrecheckLiveCount] = createSignal<number | null>(null);
// 1-based index of the url currently being prechecked, out of
// precheckUrls().length - each pasted url gets its own precheck job (the
// backend only ever prechecks one url per job), run sequentially and
// merged into one combined result for the confirm screen.
const [precheckUrlIndex, setPrecheckUrlIndex] = createSignal(0);
// set by cancel() to stop the sequential precheck loop between (or mid-)
// url iterations - not a signal since it's only read synchronously inside
// the loop, never rendered.
let precheckAbortRequested = false;
// bulk domain choice for the currently in-flight (or about to be
// submitted) url batch. lives at module level for the same reopen-survival
// reason as the rest of the precheck state.
const [urlDomain, setUrlDomain] = createSignal<MediaDomain>("music");

// active poller instance - stopped when cancel is called
let activePoller: JobPoller | null = null;

export interface UrlPrecheckHandle {
  state: () => UrlPrecheckState;
  result: () => PreCheckFetchResponse | null;
  error: () => string | null;
  urls: () => string[];
  liveCount: () => number | null;
  urlIndex: () => number;
  domain: () => MediaDomain;
  setDomain: (d: MediaDomain) => void;
  /** kick off sequential precheck for `urls` against `remote` - no-op if
   * `remote` is null. `onReset` fires once at the start (e.g. to collapse
   * an expanded item list from a prior run). */
  start: (urls: string[], remote: CurrentRemoteInfo | null, onReset?: () => void) => Promise<void>;
  /** submit the prechecked urls via `onSubmit`, then reset back to idle. */
  confirm: (onSubmit: (urls: string[]) => void) => void;
  /** cancel an in-flight precheck against `remote` (best-effort server-side
   * job cancel too) and reset back to idle. `onReset` mirrors `start`'s param. */
  cancel: (remote: CurrentRemoteInfo | null, onReset?: () => void) => Promise<void>;
}

export function useUrlPrecheck(): UrlPrecheckHandle {
  async function start(
    urls: string[],
    remote: CurrentRemoteInfo | null,
    onReset?: () => void
  ): Promise<void> {
    if (urls.length === 0) return;
    if (!remote) return;

    setPrecheckUrls(urls);
    setPrecheckError(null);
    setPrecheckResult(null);
    setPrecheckLiveCount(null);
    setPrecheckJobId(null);
    setPrecheckUrlIndex(0);
    onReset?.();
    setUrlPrecheckState("checking");
    precheckAbortRequested = false;

    const client = await getClientForRemote(remote);
    // each pasted url gets its own precheck job (the backend only ever
    // prechecks one url per job) - run them sequentially and merge the
    // results below into one combined response for the confirm screen.
    const results: PreCheckFetchResponse[] = [];
    const failedUrls: string[] = [];
    let itemsSoFar = 0;

    for (let i = 0; i < urls.length; i++) {
      if (precheckAbortRequested) return;
      setPrecheckUrlIndex(i + 1);
      const url = urls[i];

      try {
        const result = await client.music.createPrecheckFetchJob({ url });
        if (!result.success) {
          failedUrls.push(url);
          continue;
        }

        const jobId = result.data.id;
        setPrecheckJobId(jobId);

        const poller = new JobPoller(remote, 3000);
        activePoller = poller;
        const baseCount = itemsSoFar;
        const pollResult = await poller.waitForJob(jobId, 600_000, {
          onStage: (stage, message) => {
            if (stage === "precheck_progress" && message) {
              // parse "found N item(s)..." to show a running count
              const m = message.match(/(\d+)/);
              if (m) setPrecheckLiveCount(baseCount + parseInt(m[1], 10));
            }
          },
        });
        activePoller = null;
        if (precheckAbortRequested) return;

        let parsed: PreCheckFetchResponse | null = null;
        if (pollResult.status === "completed") {
          const jobResp = await client.music.getJobStatus({ job_ids: [jobId] });
          const jobData = jobResp.success
            ? (jobResp.data as { jobs: Record<string, { result?: string | null }> })
            : null;
          const job = jobData?.jobs?.[jobId];
          if (job?.result) parsed = JSON.parse(job.result) as PreCheckFetchResponse;
        } else if (pollResult.status === "timeout") {
          // if it timed out while the modal is closed and then reopened,
          // we still want to recover the result - check job status once
          const snap = await client.music.getJobStatus({ job_ids: [jobId] });
          const snapData = snap.success
            ? (snap.data as { jobs: Record<string, { status?: string; result?: string | null }> })
            : null;
          const snapJob = snapData?.jobs?.[jobId];
          if (snapJob?.status === "Completed" && snapJob.result) {
            parsed = JSON.parse(snapJob.result) as PreCheckFetchResponse;
          }
        }

        if (parsed) {
          results.push(parsed);
          itemsSoFar += parsed.item_count;
          setPrecheckLiveCount(itemsSoFar);
        } else {
          failedUrls.push(url);
        }
      } catch {
        failedUrls.push(url);
      }
    }

    activePoller = null;
    setPrecheckJobId(null);

    if (results.length === 0) {
      setPrecheckError(
        urls.length === 1 ? "precheck failed" : `precheck failed for all ${urls.length} urls`
      );
      setUrlPrecheckState("error");
      return;
    }

    // merge per-url responses into one combined preview - playlist_title/
    // platform only make sense to surface when every url agreed on them
    // (or there's just the one url, the common case).
    const merged: PreCheckFetchResponse = {
      item_count: results.reduce((n, r) => n + r.item_count, 0),
      playlist_title: results.length === 1 ? results[0].playlist_title : null,
      platform: results.every((r) => r.platform === results[0].platform)
        ? results[0].platform
        : null,
      total_duration_seconds: results.some((r) => r.total_duration_seconds != null)
        ? results.reduce((n, r) => n + (r.total_duration_seconds ?? 0), 0)
        : null,
      items: results.flatMap((r) => r.items ?? []),
      duplicate_count: results.reduce((n, r) => n + r.duplicate_count, 0),
    };

    setPrecheckResult(merged);
    setUrlPrecheckState("confirm");

    if (failedUrls.length > 0) {
      toast.warning(
        `couldn't preview ${failedUrls.length} of ${urls.length} url${urls.length !== 1 ? "s" : ""} - they'll still be downloaded if you continue`,
        { title: "partial precheck" }
      );
    }
  }

  function confirm(onSubmit: (urls: string[]) => void): void {
    const urls = precheckUrls();
    if (urls.length > 0) onSubmit(urls);
    setUrlPrecheckState("idle");
    setPrecheckResult(null);
    setPrecheckUrls([]);
    setPrecheckJobId(null);
    setPrecheckLiveCount(null);
    setPrecheckUrlIndex(0);
  }

  async function cancel(remote: CurrentRemoteInfo | null, onReset?: () => void): Promise<void> {
    // stop the sequential precheck loop between/mid url iterations, and
    // stop the local poller subscription immediately
    precheckAbortRequested = true;
    activePoller?.stop();
    activePoller = null;

    // tell the server to cancel so it kills the yt-dlp process
    const jobId = precheckJobId();
    if (jobId) {
      if (remote) {
        try {
          const client = await getClientForRemote(remote);
          await client.music.cancelJob({ job_id: jobId });
        } catch {
          // best-effort, don't block the UI
        }
      }
    }

    setUrlPrecheckState("idle");
    setPrecheckResult(null);
    setPrecheckError(null);
    setPrecheckUrls([]);
    setPrecheckJobId(null);
    setPrecheckLiveCount(null);
    setPrecheckUrlIndex(0);
    onReset?.();
  }

  return {
    state: urlPrecheckState,
    result: precheckResult,
    error: precheckError,
    urls: precheckUrls,
    liveCount: precheckLiveCount,
    urlIndex: precheckUrlIndex,
    domain: urlDomain,
    setDomain: setUrlDomain,
    start,
    confirm,
    cancel,
  };
}

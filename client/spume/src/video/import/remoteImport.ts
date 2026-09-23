// remote import service — handles uploading video files (and P2P path-based
// transfer) to the active remote server. mirrors music/import/remoteImport.ts's
// job-tracking pattern, sharing its underlying store mechanism
// (createTrackedJobStore) but its own store INSTANCE: reusing music's
// literal instance directly would mix video jobs into the music modal's
// progress list (and vice versa) — a new instance is required, though the
// generic `UploadJobStatus` union is reused rather than redefined.
import type { FreqholeClient } from "@freqhole/api-client";
import { getClientForRemote, type RemoteLike } from "../../app/api/client";
import { JobPoller } from "../../app/services/jobs/jobService";
import { toast } from "../../components/feedback/Toast";
import { getCurrentRemote, getCurrentUser } from "../../music/data";
import type { UploadJobStatus } from "../../music/import";
import { createTrackedJobStore } from "../../app/services/transfers/trackedJobStore";
import { humanizeJobError as humanizeJobErrorShared } from "../../utils/humanizeJobError";
import { extractTransportErrorType, errorMessageFrom } from "../../utils/humanizeJobError";

export interface VideoUploadJob {
  /** unique client-side id */
  id: string;
  /** display label (filename) */
  label: string;
  /** current status */
  status: UploadJobStatus;
  /** server job id (set after upload succeeds) */
  jobId?: string;
  /** short, human-readable error if failed */
  error?: string;
  /** full server detail (for tooltip / debug) */
  errorFull?: string;
  /** latest concise stage message from the server */
  stage?: string;
  /** non-fatal warning surfaced after completion (e.g. poster/waveform
   * extraction failed but the import itself succeeded) - kept separate
   * from `stage` so it isn't overwritten by the terminal "done" text. */
  warning?: string;
  /** timestamp when job was created */
  createdAt: number;
  /** remote id this job ran against */
  remoteId?: string;
  /** job session id - set after completion; used to open import review */
  sessionId?: string;
  /** resolved video id for this job's file, once known - used by
   * checkAutoSendForCompletedVideoSessions to send a session that never
   * needed interactive review (mirrors music's `songId`/`albumId`). */
  videoId?: string;
  /** short human-readable outcome for a directory (batch) import, e.g.
   * "6 added, 2 already in library" - set when the resolved job result
   * carries per-file counts (ProcessDirectory jobs) rather than a single
   * video outcome. */
  resultSummary?: string;
  /** upload transfer progress (0..1) while status is "uploading" - only
   * populated on transports that can report real byte-level progress
   * (HttpTransport via XHR); stays undefined (indeterminate) on P2P/tauri
   * uploads, which don't stream a trackable request body. */
  progress?: number;
  /** true only for a "send to remote" job (sendReviewedVideoSessionToRemote.ts)
   * - discriminates it from a regular import job, since both set
   * `videoId`/`remoteId` but only a send job is retryable via
   * `retryFailedVideoSend`. */
  isRemoteSend?: boolean;
}

// reactive store for all tracked video upload jobs (own instance — see module note above)
const jobStore = createTrackedJobStore<VideoUploadJob>();

/** get the reactive video upload jobs list */
export function getVideoUploadJobs() {
  return jobStore.getJobs();
}

/** clear completed jobs (call when modal is closed) */
export function clearCompletedVideoJobs() {
  jobStore.clearJobsWhere((j) => j.status === "completed");
}

/** remove a single job (e.g. dismissing a failed row) */
export function removeVideoJob(id: string) {
  jobStore.removeJob(id);
}

/** clear all jobs */
export function clearAllVideoJobs() {
  jobStore.clearAllJobs();
}

// add a new tracked job and return its client-side id - exported so
// sendReviewedVideoSessionToRemote.ts can show "sending to remote" in the
// same job list instead of running invisibly (mirrors music's identical
// export for the same reason).
export function addTrackedJob(label: string, remoteId: string): string {
  const id = jobStore.nextId("video-upload");
  jobStore.addJob({
    id,
    label,
    status: "uploading",
    createdAt: Date.now(),
    remoteId,
  });
  return id;
}

export function updateJobStatus(
  id: string,
  status: UploadJobStatus,
  extra?: { jobId?: string; error?: string; errorFull?: string }
) {
  jobStore.updateJob(id, (j) => {
    j.status = status;
    if (extra?.jobId) j.jobId = extra.jobId;
    if (extra?.error) j.error = extra.error;
    if (extra?.errorFull) j.errorFull = extra.errorFull;
  });
}

// resolve a completed job's session_id/video_id/duplicate flag from its
// server-side result - mirrors music/import/remoteImport.ts's
// `parseJobResult`/`resolveJobEntities`, trimmed to what video needs.
function parseVideoJobResult(raw: string | null | undefined): {
  videoId?: string;
  isDuplicate?: boolean;
} {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return {
      videoId: typeof v["video_id"] === "string" ? (v["video_id"] as string) : undefined,
      isDuplicate:
        typeof v["is_duplicate"] === "boolean" ? (v["is_duplicate"] as boolean) : undefined,
    };
  } catch {
    return {};
  }
}

async function resolveVideoJobEntities(
  client: FreqholeClient,
  jobId: string
): Promise<{ sessionId?: string; videoId?: string; isDuplicate?: boolean }> {
  try {
    const statusResp = await client.music.getJobStatus({ job_ids: [jobId] });
    if (!statusResp.success || !statusResp.data) return {};
    const row = statusResp.data.jobs[jobId];
    if (!row) return {};
    const fromResult = parseVideoJobResult(row.result ?? null);
    return { ...fromResult, sessionId: row.session_id ?? undefined };
  } catch {
    return {};
  }
}

// merge entity ids/summary onto a tracked job once resolved from the
// server-side job result - mirrors music/import/remoteImport.ts's
// `updateJobEntities`. exported so sendReviewedVideoSessionToRemote.ts can
// attach a send job's target/video info too.
export function updateJobEntities(
  id: string,
  ids: {
    remoteId?: string;
    sessionId?: string;
    videoId?: string;
    resultSummary?: string;
    isRemoteSend?: boolean;
  }
) {
  jobStore.updateJob(id, (j) => {
    if (ids.remoteId) j.remoteId = ids.remoteId;
    if (ids.sessionId) j.sessionId = ids.sessionId;
    if (ids.videoId) j.videoId = ids.videoId;
    if (ids.resultSummary) j.resultSummary = ids.resultSummary;
    if (ids.isRemoteSend !== undefined) j.isRemoteSend = ids.isRemoteSend;
  });
}

export function updateJobStage(id: string, stage: string | undefined) {
  jobStore.updateJob(id, (j) => {
    j.stage = stage;
  });
}

// update a tracked job's upload transfer progress (0..1).
export function updateJobProgress(id: string, progress: number) {
  jobStore.updateJob(id, (j) => {
    j.progress = progress;
  });
}

// poster/waveform extraction failures are reported as "stage" events too
// (see grimoire's import_video_file), but they're soft failures that
// happen right before the job completes - if routed through the normal
// `stage` field they'd be overwritten by the terminal "done"/"failed"
// text a moment later. route these into a separate field the UI can
// still show after completion.
function isWarningStage(stage: string | undefined): boolean {
  return !!stage && stage.endsWith("_warning");
}

function updateJobWarning(id: string, message: string | undefined) {
  jobStore.updateJob(id, (j) => {
    j.warning = message;
  });
}

// turn a raw server failure into a short, user-friendly line; full detail
// stays available via errorFull for a tooltip.
function humanizeJobError(
  message: string | undefined,
  errorType: string | undefined
): { short: string; full: string } {
  return humanizeJobErrorShared(message, errorType, "video");
}

/**
 * upload video files to the active remote server.
 * fires off uploads and polls jobs in the background — returns immediately
 * after all files have been submitted (not after jobs complete).
 * @param targetRemote import against this remote instead of whatever's
 *   currently selected - see music's uploadFilesToRemote's identical param.
 */
export async function uploadVideoFilesToRemote(
  files: File[],
  onJobComplete?: () => void,
  targetRemote?: RemoteLike
): Promise<void> {
  const remote = targetRemote ?? getCurrentRemote();
  if (!remote) throw new Error("no active remote");

  const poller = new JobPoller(remote, 3000);

  for (const file of files) {
    const trackId = addTrackedJob(file.name, remote.remote_id ?? "");

    (async () => {
      try {
        const client = await getClientForRemote(remote);
        const result = await client.upload.video(file, (loaded, total) => {
          if (total > 0) updateJobProgress(trackId, loaded / total);
        });
        if (!result.success) {
          const errMsg = result.error?.issues?.[0]?.message || "upload request failed";
          updateJobStatus(trackId, "failed", { error: errMsg });
          return;
        }

        const jobId = result.data.job_id;
        updateJobStatus(trackId, "polling", { jobId });

        const pollResult = await poller.waitForJob(jobId, 120_000, {
          onStage: (stage, message) =>
            isWarningStage(stage)
              ? updateJobWarning(trackId, message)
              : updateJobStage(trackId, message),
        });
        if (pollResult.status === "completed") {
          updateJobStatus(trackId, "completed");
          void resolveVideoJobEntities(client, jobId).then((ids) =>
            updateJobEntities(trackId, ids)
          );
          onJobComplete?.();
        } else if (pollResult.status === "timeout") {
          updateJobStatus(trackId, "timeout", {
            error: "lost connection while tracking this upload",
          });
          onJobComplete?.();
          toast.info(
            `lost connection while tracking upload of ${file.name} — it may still finish`,
            {
              title: "connection lost",
            }
          );
        } else {
          const friendly = humanizeJobError(
            pollResult.errorMessage,
            pollResult.errors?.[0]?.error_type
          );
          updateJobStatus(trackId, "failed", {
            error: friendly.short,
            errorFull: friendly.full,
          });
          onJobComplete?.();
        }
      } catch (error) {
        const msg = errorMessageFrom(error);
        const friendly = humanizeJobError(msg, extractTransportErrorType(error));
        updateJobStatus(trackId, "failed", { error: friendly.short, errorFull: friendly.full });
      }
    })();
  }
}

/**
 * upload video files by filesystem path to a P2P remote.
 * uses iroh-blobs pull model, mirroring `uploadPathsToRemote` in
 * music/import/remoteImport.ts.
 */
export async function uploadVideoPathsToRemote(
  paths: string[],
  onJobComplete?: () => void,
  /** import against this remote instead of whatever's currently selected -
   * used to force local-first import (see the add-media "review before
   * sending" flow). */
  targetRemote?: RemoteLike,
  /** fired once a file's session_id is known - video has no batch-by-paths
   * endpoint, so each path resolves its session independently rather than
   * sharing one session_id like music's importPathsToLocal does. */
  onSessionResolved?: (sessionId: string) => void
): Promise<void> {
  const remote = targetRemote ?? getCurrentRemote();
  if (!remote) throw new Error("no active remote");

  const poller = new JobPoller(remote, 3000);

  for (const filePath of paths) {
    const filename = filePath.split("/").pop() || filePath.split("\\").pop() || filePath;
    const trackId = addTrackedJob(filename, remote.remote_id ?? "");

    (async () => {
      try {
        const client = await getClientForRemote(remote);
        const result = await client.upload.videoByPath(filePath);
        if (!result.success) {
          const errMsg = result.error?.issues?.[0]?.message || "upload request failed";
          updateJobStatus(trackId, "failed", { error: errMsg });
          return;
        }

        const jobId = result.data.job_id;
        updateJobStatus(trackId, "polling", { jobId });

        const pollResult = await poller.waitForJob(jobId, 120_000, {
          onStage: (stage, message) =>
            isWarningStage(stage)
              ? updateJobWarning(trackId, message)
              : updateJobStage(trackId, message),
        });
        if (pollResult.status === "completed") {
          updateJobStatus(trackId, "completed");
          void resolveVideoJobEntities(client, jobId).then((ids) => {
            updateJobEntities(trackId, ids);
            if (ids.sessionId) onSessionResolved?.(ids.sessionId);
          });
          onJobComplete?.();
        } else if (pollResult.status === "timeout") {
          updateJobStatus(trackId, "timeout", {
            error: "lost connection while tracking this upload",
          });
          onJobComplete?.();
          toast.info(`lost connection while tracking upload of ${filename} — it may still finish`, {
            title: "connection lost",
          });
        } else {
          const friendly = humanizeJobError(
            pollResult.errorMessage,
            pollResult.errors?.[0]?.error_type
          );
          updateJobStatus(trackId, "failed", {
            error: friendly.short,
            errorFull: friendly.full,
          });
          onJobComplete?.();
        }
      } catch (error) {
        const msg = errorMessageFrom(error);
        const friendly = humanizeJobError(msg, extractTransportErrorType(error));
        updateJobStatus(trackId, "failed", { error: friendly.short, errorFull: friendly.full });
      }
    })();
  }
}

// translate a server `Stage` event into a short human-readable line -
// mirrors music/import/remoteImport.ts's private `formatStage` (fetch jobs
// emit the same stage names regardless of media domain).
function formatStage(stage: string, message: string | undefined): string | undefined {
  switch (stage) {
    case "precheck_started":
      return "checking source\u2026";
    case "item_started":
      return message ? `downloading ${message}` : "downloading\u2026";
    case "item_complete":
      return message ? `downloaded ${message}` : "downloaded";
    case "postprocess":
      return message ?? "converting\u2026";
    case "reconnecting":
      return "reconnecting\u2026";
    default:
      return message;
  }
}

/**
 * import video files/folders from filesystem paths against a single batch
 * session - mirrors music/import/remoteImport.ts's `importPathsToLocal`,
 * now that video has its own batch-paths route
 * (`import_video_paths`/`client.upload.videoByPaths`, see grimoire's
 * `offal/upload/video.rs`) instead of uploading each path individually
 * with no shared session (what `uploadVideoPathsToRemote` above still does
 * for the P2P-pull case, where files aren't local to the destination).
 */
export async function importVideoPathsToLocal(
  paths: string[],
  onJobComplete?: () => void,
  onSessionComplete?: (sessionId: string) => void,
  /** import against this remote instead of whatever's currently selected -
   * used to force local-first import (see the add-media "review before
   * sending" flow). */
  targetRemote?: RemoteLike,
  /** when set, tags the created session (server-side) as destined for
   * this remote once reviewed - see uploadVideoFilesToRemote's matching param. */
  sendTarget?: { remoteId: string; remoteName: string }
): Promise<void> {
  if (paths.length === 0) return;
  const remote = targetRemote ?? getCurrentRemote();
  if (!remote) throw new Error("no active remote");

  const client = await getClientForRemote(remote);

  // submit all paths in one request - server creates a single session for the
  // batch so all files end up reviewable together
  const batchResult = await client.upload.videoByPaths(paths, {
    targetRemoteId: sendTarget?.remoteId,
    targetRemoteName: sendTarget?.remoteName,
  });
  if (!batchResult.success) {
    const errMsg = batchResult.error?.issues?.[0]?.message || "batch import request failed";
    throw new Error(errMsg);
  }

  const sessionId = batchResult.data.session_id;

  // see music/import/remoteImport.ts's importPathsToLocal identical
  // reasoning: cheap-skipped paths never get a job, so this is the only
  // way to resolve their existing entity and still forward them to a
  // remote send target.
  const existingByPath = new Map(
    (batchResult.data.existing_files ?? []).map((f) => [f.file_path, f])
  );

  // add one tracked progress row per path so the upload panel shows granular feedback
  const trackIds: string[] = paths.map((filePath) => {
    const filename = filePath.split("/").pop() || filePath.split("\\").pop() || filePath;
    const trackId = addTrackedJob(filename, remote.remote_id ?? "");
    updateJobEntities(trackId, { remoteId: remote.remote_id, sessionId });
    updateJobStatus(trackId, "polling");
    return trackId;
  });

  // the server already knows up front whether any jobs were actually
  // created (a directory scan can discover files and still create zero
  // jobs if everything's already imported and unchanged) - when that's
  // the case there's nothing to poll for, so finish immediately with an
  // honest summary instead of waiting on child jobs that will never exist.
  if (batchResult.data.jobs_created === 0) {
    for (let i = 0; i < trackIds.length; i++) {
      const trackId = trackIds[i];
      const existing = existingByPath.get(paths[i]);
      updateJobEntities(trackId, {
        resultSummary: batchResult.data.message,
        sessionId,
        videoId: existing?.video_id ?? undefined,
      });
      updateJobStatus(trackId, "completed");
    }
    // register the send target BEFORE checking for auto-send - see
    // music's importPathsToLocal identical fix/reasoning.
    onSessionComplete?.(sessionId);
    onJobComplete?.();
    return;
  }

  // poll child jobs from the session to update per-file progress
  const poller = new JobPoller(remote, 3000);
  let remaining = paths.length;

  (async () => {
    // give the server a moment to spawn child jobs before polling
    await new Promise((res) => setTimeout(res, 800));

    try {
      const listResp = await client.music.listJobs({ session_id: sessionId });
      const childJobs = listResp.success && listResp.data ? listResp.data : [];

      if (childJobs.length === 0) {
        // no child jobs found - mark all as completed and open review
        for (const trackId of trackIds) updateJobStatus(trackId, "completed");
        onSessionComplete?.(sessionId);
        return;
      }

      remaining = childJobs.length;

      // match child jobs to tracked rows deterministically by the file
      // path each ProcessFile job was given (parameters.file_path) -
      // see importPathsToLocal's matching identical logic/reasoning.
      const pathToTrackId = new Map(paths.map((p, i) => [p, trackIds[i]]));
      const jobToTrackId = new Map<string, string>();
      const usedTrackIds = new Set<string>();
      const unmatchedJobs: typeof childJobs = [];
      for (const job of childJobs) {
        let matchedPath: string | undefined;
        try {
          const params = JSON.parse(job.parameters) as Record<string, unknown>;
          if (typeof params.file_path === "string") matchedPath = params.file_path;
        } catch {
          // leave matchedPath undefined - falls through to index fallback
        }
        const trackId = matchedPath ? pathToTrackId.get(matchedPath) : undefined;
        if (trackId && !usedTrackIds.has(trackId)) {
          jobToTrackId.set(job.id, trackId);
          usedTrackIds.add(trackId);
        } else {
          unmatchedJobs.push(job);
        }
      }
      const leftoverTrackIds = trackIds.filter((id) => !usedTrackIds.has(id));
      unmatchedJobs.forEach((job, i) => {
        const trackId =
          leftoverTrackIds[i] ??
          leftoverTrackIds[leftoverTrackIds.length - 1] ??
          trackIds[trackIds.length - 1];
        jobToTrackId.set(job.id, trackId);
      });

      childJobs.forEach((job) => {
        const trackId = jobToTrackId.get(job.id) ?? trackIds[trackIds.length - 1];
        updateJobStatus(trackId, "polling", { jobId: job.id });
      });

      await Promise.all(
        childJobs.map(async (job) => {
          const trackId = jobToTrackId.get(job.id) ?? trackIds[trackIds.length - 1];
          try {
            const pollResult = await poller.waitForJob(job.id, 180_000, {
              onStage: (stage, message) =>
                isWarningStage(stage)
                  ? updateJobWarning(trackId, message)
                  : updateJobStage(trackId, message),
            });
            if (pollResult.status === "completed") {
              const ids = await resolveVideoJobEntities(client, job.id);
              updateJobEntities(trackId, { ...ids, sessionId });
              updateJobStatus(trackId, "completed");
              onJobComplete?.();
            } else if (pollResult.status === "timeout") {
              updateJobStatus(trackId, "timeout", {
                error: "lost connection while tracking this job",
              });
              onJobComplete?.();
            } else {
              const friendly = humanizeJobError(
                pollResult.errorMessage,
                pollResult.errors?.[0]?.error_type
              );
              updateJobStatus(trackId, "failed", {
                error: friendly.short,
                errorFull: friendly.full,
              });
              onJobComplete?.();
            }
          } catch (err) {
            const msg = errorMessageFrom(err);
            const friendly = humanizeJobError(msg, extractTransportErrorType(err));
            updateJobStatus(trackId, "failed", { error: friendly.short, errorFull: friendly.full });
          } finally {
            remaining -= 1;
            if (remaining === 0) onSessionComplete?.(sessionId);
          }
        })
      );

      // ensure any rows that never got a matching child job (or whose poll
      // threw before reaching a terminal status) don't stay stuck in
      // "polling" forever - see importPathsToLocal's identical reasoning.
      for (let i = 0; i < trackIds.length; i++) {
        const trackId = trackIds[i];
        const j = jobStore.getJobs().find((j) => j.id === trackId);
        if (!j) continue;
        if (j.status !== "completed" && j.status !== "failed" && j.status !== "timeout") {
          const existing = existingByPath.get(paths[i]);
          if (existing) {
            updateJobEntities(trackId, {
              resultSummary: batchResult.data.message,
              videoId: existing.video_id ?? undefined,
            });
          }
          updateJobStatus(trackId, "completed");
          onJobComplete?.();
        }
      }
    } catch (err) {
      console.warn(`importVideoPathsToLocal session poll failed: ${String(err)}`);
      for (const trackId of trackIds) updateJobStatus(trackId, "completed");
      onSessionComplete?.(sessionId);
    }
  })();
}

/**
 * fetch video urls (yt-dlp) on the active remote server. mirrors
 * `fetchUrlsOnRemote` in music/import/remoteImport.ts, but requests the
 * "video" media domain so the server keeps the full video instead of
 * extracting audio - reuses the same generic `/api/music/fetch*` job
 * routes (the backend's fetch/job infrastructure is domain-agnostic, see
 * `FetchMediaParams.domain`; only the route names are music-namespaced).
 * fires off jobs and polls them in the background - returns immediately
 * after all urls have been submitted (not after jobs complete).
 */
export async function fetchVideoUrlsOnRemote(
  urls: string[],
  onJobComplete?: () => void,
  targetRemote?: RemoteLike
): Promise<void> {
  const remote = targetRemote ?? getCurrentRemote();
  if (!remote) throw new Error("no active remote");

  const userId = getCurrentUser()?.userId;
  const poller = new JobPoller(remote, 3000);

  for (const url of urls) {
    let label: string;
    try {
      const parsed = new URL(url);
      label =
        parsed.hostname +
        (parsed.pathname.length > 30 ? "..." + parsed.pathname.slice(-27) : parsed.pathname);
    } catch {
      label = url.length > 50 ? url.slice(0, 47) + "..." : url;
    }

    const trackId = addTrackedJob(label, remote.remote_id ?? "");

    (async () => {
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.createFetchJob({
          url,
          user_id: userId ?? null,
          domain: "video",
        });
        if (!result.success) {
          const errMsg = result.error?.issues?.[0]?.message || "failed to create fetch job";
          updateJobStatus(trackId, "failed", { error: errMsg });
          return;
        }

        const jobId = result.data.id;
        updateJobStatus(trackId, "polling", { jobId });

        // register with batch poller (5 min timeout for fetches)
        const pollResult = await poller.waitForJob(jobId, 300_000, {
          onStage: (stage, message) => updateJobStage(trackId, formatStage(stage, message)),
        });
        if (pollResult.status === "completed") {
          updateJobStatus(trackId, "completed");
          void resolveVideoJobEntities(client, jobId).then((ids) =>
            updateJobEntities(trackId, ids)
          );
          onJobComplete?.();
        } else if (pollResult.status === "timeout") {
          updateJobStatus(trackId, "timeout", {
            error: "lost connection while tracking this download",
          });
          onJobComplete?.();
          toast.info(`lost connection while tracking the download — it may still finish`, {
            title: "connection lost",
          });
        } else {
          const friendly = humanizeJobError(
            pollResult.errorMessage,
            pollResult.errors?.[0]?.error_type
          );
          updateJobStatus(trackId, "failed", { error: friendly.short, errorFull: friendly.full });
          onJobComplete?.();
        }
      } catch (error) {
        const msg = errorMessageFrom(error);
        const friendly = humanizeJobError(msg, undefined);
        updateJobStatus(trackId, "failed", { error: friendly.short, errorFull: friendly.full });
      }
    })();
  }
}

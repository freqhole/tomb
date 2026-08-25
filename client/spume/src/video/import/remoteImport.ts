// remote import service — handles uploading video files (and P2P path-based
// transfer) to the active remote server. mirrors music/import/remoteImport.ts's
// job-tracking pattern, but keeps its own private store: the music module's
// `uploadJobs` store is a private singleton scoped to that file, so reusing it
// directly would mix video jobs into the music modal's progress list (and vice
// versa) — a new instance is required, though the generic `UploadJobStatus`
// union is reused rather than redefined. no url-fetch / pending-review support
// here (video doesn't have those flows yet).
import { createStore, produce } from "solid-js/store";
import { getClientForRemote } from "../../app/api/client";
import { JobPoller } from "../../app/services/jobs/jobService";
import { toast } from "../../components/feedback/Toast";
import { getCurrentRemote, getCurrentUser } from "../../music/data";
import type { UploadJobStatus } from "../../music/import";
import { humanizeJobError as humanizeJobErrorShared } from "../../utils/humanizeJobError";

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
}

// reactive store for all tracked video upload jobs (own instance — see module note above)
const [videoUploadJobs, setVideoUploadJobs] = createStore<VideoUploadJob[]>([]);

let nextVideoJobId = 1;

/** get the reactive video upload jobs list */
export function getVideoUploadJobs() {
  return videoUploadJobs;
}

/** clear completed jobs (call when modal is closed) */
export function clearCompletedVideoJobs() {
  setVideoUploadJobs((jobs) => jobs.filter((j) => j.status !== "completed"));
}

/** clear all jobs */
export function clearAllVideoJobs() {
  setVideoUploadJobs([]);
}

function addTrackedJob(label: string, remoteId: string): string {
  const id = `video-upload-${nextVideoJobId++}`;
  const job: VideoUploadJob = {
    id,
    label,
    status: "uploading",
    createdAt: Date.now(),
    remoteId,
  };
  setVideoUploadJobs((prev) => [...prev, job]);
  return id;
}

function updateJobStatus(
  id: string,
  status: UploadJobStatus,
  extra?: { jobId?: string; error?: string; errorFull?: string }
) {
  setVideoUploadJobs(
    (j) => j.id === id,
    produce((j) => {
      j.status = status;
      if (extra?.jobId) j.jobId = extra.jobId;
      if (extra?.error) j.error = extra.error;
      if (extra?.errorFull) j.errorFull = extra.errorFull;
    })
  );
}

function updateJobStage(id: string, stage: string | undefined) {
  setVideoUploadJobs(
    (j) => j.id === id,
    produce((j) => {
      j.stage = stage;
    })
  );
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
  setVideoUploadJobs(
    (j) => j.id === id,
    produce((j) => {
      j.warning = message;
    })
  );
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
 */
export async function uploadVideoFilesToRemote(
  files: File[],
  onJobComplete?: () => void
): Promise<void> {
  const remote = getCurrentRemote();
  if (!remote) throw new Error("no active remote");

  const poller = new JobPoller(remote, 3000);

  for (const file of files) {
    const trackId = addTrackedJob(file.name, remote.remote_id);

    (async () => {
      try {
        const client = await getClientForRemote(remote);
        const result = await client.upload.video(file);
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
          onJobComplete?.();
        } else if (pollResult.status === "timeout") {
          updateJobStatus(trackId, "timeout", { error: "taking a long time, check back later" });
          onJobComplete?.();
          toast.info(`upload of ${file.name} is still processing — check back later`, {
            title: "processing queued",
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
        const msg = error instanceof Error ? error.message : "unknown error";
        const friendly = humanizeJobError(msg, undefined);
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
  onJobComplete?: () => void
): Promise<void> {
  const remote = getCurrentRemote();
  if (!remote) throw new Error("no active remote");

  const poller = new JobPoller(remote, 3000);

  for (const filePath of paths) {
    const filename = filePath.split("/").pop() || filePath.split("\\").pop() || filePath;
    const trackId = addTrackedJob(filename, remote.remote_id);

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
          onJobComplete?.();
        } else if (pollResult.status === "timeout") {
          updateJobStatus(trackId, "timeout", { error: "taking a long time, check back later" });
          onJobComplete?.();
          toast.info(`upload of ${filename} is still processing — check back later`, {
            title: "processing queued",
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
        const msg = error instanceof Error ? error.message : "unknown error";
        const friendly = humanizeJobError(msg, undefined);
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
    default:
      return message;
  }
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
  onJobComplete?: () => void
): Promise<void> {
  const remote = getCurrentRemote();
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

    const trackId = addTrackedJob(label, remote.remote_id);

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
          onJobComplete?.();
        } else if (pollResult.status === "timeout") {
          updateJobStatus(trackId, "timeout", { error: "taking a long time, check back later" });
          onJobComplete?.();
          toast.info(`download is still processing — check back later`, {
            title: "processing queued",
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
        const msg = error instanceof Error ? error.message : "unknown error";
        const friendly = humanizeJobError(msg, undefined);
        updateJobStatus(trackId, "failed", { error: friendly.short, errorFull: friendly.full });
      }
    })();
  }
}

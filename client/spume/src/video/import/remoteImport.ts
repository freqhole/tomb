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
import { getCurrentRemote } from "../../music/data";
import type { UploadJobStatus } from "../../music/import";

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
function humanizeJobError(message: string | undefined): { short: string; full: string } {
  const full = message?.trim() || "failed";
  const m = full.toLowerCase();
  if (m.includes("connection") || m.includes("network") || m.includes("dns"))
    return { short: "network error", full };
  if (m.includes("permission denied") || m.includes("forbidden"))
    return { short: "permission denied", full };
  if (m.includes("timeout") || m.includes("timed out")) return { short: "timed out", full };
  if (m.includes("unsupported format") || m.includes("unknown format"))
    return { short: "unsupported video format", full };
  const cleaned = full.replace(/\s+/g, " ");
  const short = cleaned.length > 80 ? cleaned.slice(0, 77) + "\u2026" : cleaned;
  return { short, full };
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
          const friendly = humanizeJobError(pollResult.errorMessage);
          updateJobStatus(trackId, "failed", {
            error: friendly.short,
            errorFull: friendly.full,
          });
          onJobComplete?.();
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "unknown error";
        const friendly = humanizeJobError(msg);
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
          const friendly = humanizeJobError(pollResult.errorMessage);
          updateJobStatus(trackId, "failed", {
            error: friendly.short,
            errorFull: friendly.full,
          });
          onJobComplete?.();
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "unknown error";
        const friendly = humanizeJobError(msg);
        updateJobStatus(trackId, "failed", { error: friendly.short, errorFull: friendly.full });
      }
    })();
  }
}

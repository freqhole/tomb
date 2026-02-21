// remote import service - handles uploading music files and fetching urls on a remote server
// tracks upload/fetch jobs reactively so the UI can show progress
import * as apiClient from "freqhole-api-client";
import { createStore, produce } from "solid-js/store";
import { toast } from "../../components/feedback/Toast";
import { getCurrentRemote, getCurrentUser } from "../data";
import { pollJobUntilComplete } from "../../utils/jobs";

// ============================================================================
// upload job tracking
// ============================================================================

export type UploadJobStatus = "uploading" | "polling" | "completed" | "failed" | "timeout";
export type UploadJobType = "file" | "url";

export interface UploadJob {
  /** unique client-side id */
  id: string;
  /** display label (filename or url) */
  label: string;
  /** whether this was a file upload or url fetch */
  type: UploadJobType;
  /** current status */
  status: UploadJobStatus;
  /** server job id (set after upload succeeds) */
  jobId?: string;
  /** error message if failed */
  error?: string;
  /** timestamp when job was created */
  createdAt: number;
}

// reactive store for all tracked upload jobs
const [uploadJobs, setUploadJobs] = createStore<UploadJob[]>([]);

// counter for generating unique ids
let nextJobId = 1;

/** get the reactive upload jobs list */
export function getUploadJobs() {
  return uploadJobs;
}

/** clear completed jobs (call when modal is closed) */
export function clearCompletedJobs() {
  setUploadJobs((jobs) => jobs.filter((j) => j.status !== "completed"));
}

/** clear all jobs */
export function clearAllJobs() {
  setUploadJobs([]);
}

// add a new tracked job and return its client-side id
function addTrackedJob(label: string, type: UploadJobType): string {
  const id = `upload-${nextJobId++}`;
  const job: UploadJob = {
    id,
    label,
    type,
    status: "uploading",
    createdAt: Date.now(),
  };
  setUploadJobs((prev) => [...prev, job]);
  return id;
}

// update a tracked job's status
function updateJobStatus(
  id: string,
  status: UploadJobStatus,
  extra?: { jobId?: string; error?: string },
) {
  setUploadJobs(
    (j) => j.id === id,
    produce((j) => {
      j.status = status;
      if (extra?.jobId) j.jobId = extra.jobId;
      if (extra?.error) j.error = extra.error;
    }),
  );
}

// ============================================================================
// upload files
// ============================================================================

export interface RemoteUploadResult {
  successCount: number;
  failCount: number;
}

/**
 * upload music files to the active remote server.
 * fires off uploads and polls jobs in the background — returns immediately
 * after all files have been submitted (not after jobs complete).
 * @param onJobComplete optional callback when any job finishes (for query invalidation)
 */
export async function uploadFilesToRemote(
  files: FileList,
  onJobComplete?: () => void,
): Promise<void> {
  const remote = getCurrentRemote();
  if (!remote) throw new Error("no active remote");

  const fileArray = Array.from(files);

  for (const file of fileArray) {
    const trackId = addTrackedJob(file.name, "file");

    // fire off each upload + poll chain without blocking the others
    (async () => {
      try {
        const result = await apiClient.utils.uploadMusic(remote.base_url, file);
        if (!result.success) {
          updateJobStatus(trackId, "failed", { error: "upload request failed" });
          return;
        }

        const jobId = result.data.job_id;
        updateJobStatus(trackId, "polling", { jobId });

        const pollResult = await pollJobUntilComplete(remote.base_url, jobId, 120_000);
        if (pollResult === "completed") {
          updateJobStatus(trackId, "completed");
          onJobComplete?.();
        } else if (pollResult === "timeout") {
          updateJobStatus(trackId, "timeout", { error: "taking a long time, check back later" });
          toast.info(`upload of ${file.name} is still processing — check back later`, {
            title: "processing queued",
          });
        } else {
          updateJobStatus(trackId, "failed", { error: "processing failed" });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "unknown error";
        updateJobStatus(trackId, "failed", { error: msg });
      }
    })();
  }
}

// ============================================================================
// fetch urls
// ============================================================================

/**
 * submit urls to the active remote server for fetching.
 * fires off fetch jobs and polls in the background — returns immediately.
 * @param onJobComplete optional callback when any job finishes
 */
export async function fetchUrlsOnRemote(
  urls: string[],
  onJobComplete?: () => void,
): Promise<void> {
  const remote = getCurrentRemote();
  if (!remote) throw new Error("no active remote");

  const userId = getCurrentUser()?.userId;

  for (const url of urls) {
    // use a short label: hostname + path tail
    let label: string;
    try {
      const parsed = new URL(url);
      label = parsed.hostname + (parsed.pathname.length > 30
        ? "..." + parsed.pathname.slice(-27)
        : parsed.pathname);
    } catch {
      label = url.length > 50 ? url.slice(0, 47) + "..." : url;
    }

    const trackId = addTrackedJob(label, "url");

    (async () => {
      try {
        const result = await apiClient.music.createFetchJob(remote.base_url, {
          url,
          user_id: userId,
        });
        if (!result.success) {
          updateJobStatus(trackId, "failed", { error: "failed to create fetch job" });
          return;
        }

        const jobId = result.data.id;
        updateJobStatus(trackId, "polling", { jobId });

        const pollResult = await pollJobUntilComplete(remote.base_url, jobId, 300_000);
        if (pollResult === "completed") {
          updateJobStatus(trackId, "completed");
          onJobComplete?.();
        } else if (pollResult === "timeout") {
          updateJobStatus(trackId, "timeout", { error: "taking a long time, check back later" });
          toast.info(`download is still processing — check back later`, {
            title: "processing queued",
          });
        } else {
          updateJobStatus(trackId, "failed", { error: "fetch failed" });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "unknown error";
        updateJobStatus(trackId, "failed", { error: msg });
      }
    })();
  }
}

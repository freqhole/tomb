// remote import service - handles uploading music files and fetching urls on a remote server
// tracks upload/fetch jobs reactively so the UI can show progress
import { createStore, produce } from "solid-js/store";
import type { FreqholeClient } from "freqhole-api-client";
import { getClientForRemote } from "../../app/api/client";
import { JobPoller } from "../../app/services/jobs/jobService";
import { toast } from "../../components/feedback/Toast";
import { getCurrentRemote, getCurrentUser } from "../data";
import { warn as logWarn } from "../../utils/logger";

// known error types from the server for structured error handling
const ERROR_TYPE = {
  DUPLICATE_SONG: "duplicate_song",
} as const;

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
  /** short, human-readable error if failed */
  error?: string;
  /** full server detail (for tooltip / debug) */
  errorFull?: string;
  /** latest concise stage message from the server (e.g. "2/7: track title") */
  stage?: string;
  /** timestamp when job was created */
  createdAt: number;
  /** remote id this job ran against (for navigation) */
  remoteId?: string;
  /** populated after completion: ids of the entities the import produced */
  albumId?: string;
  artistId?: string;
  songId?: string;
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
  extra?: { jobId?: string; error?: string; errorFull?: string }
) {
  setUploadJobs(
    (j) => j.id === id,
    produce((j) => {
      j.status = status;
      if (extra?.jobId) j.jobId = extra.jobId;
      if (extra?.error) j.error = extra.error;
      if (extra?.errorFull) j.errorFull = extra.errorFull;
    })
  );
}

// update a tracked job's stage label (concise human-readable line).
function updateJobStage(id: string, stage: string | undefined) {
  setUploadJobs(
    (j) => j.id === id,
    produce((j) => {
      j.stage = stage;
    })
  );
}

// merge entity ids onto a tracked job once we've resolved them from the
// server-side job result.
function updateJobEntities(
  id: string,
  ids: { albumId?: string; artistId?: string; songId?: string; remoteId?: string }
) {
  setUploadJobs(
    (j) => j.id === id,
    produce((j) => {
      if (ids.albumId) j.albumId = ids.albumId;
      if (ids.artistId) j.artistId = ids.artistId;
      if (ids.songId) j.songId = ids.songId;
      if (ids.remoteId) j.remoteId = ids.remoteId;
    })
  );
}

// fetch a job's result JSON from the server and resolve its produced
// entity ids. for ImportMusic the result already contains album/artist/
// song ids. for FetchMedia (url fetch) the parent has none, so we list
// child jobs by session_id and pick the first ImportMusic with a result.
async function resolveJobEntities(
  client: FreqholeClient,
  jobId: string
): Promise<{ albumId?: string; artistId?: string; songId?: string } | null> {
  try {
    const statusResp = await client.music.getJobStatus({ job_ids: [jobId] });
    if (!statusResp.success || !statusResp.data) return null;
    const row = statusResp.data.jobs[jobId];
    if (!row) return null;
    const fromResult = parseJobResult(row.result ?? null);
    if (fromResult.albumId || fromResult.songId || fromResult.artistId) {
      return fromResult;
    }
    // FetchMedia parent path: walk children via session_id
    if (row.session_id) {
      try {
        const listResp = await client.music.listJobs({
          session_id: row.session_id,
          status: "Completed",
        });
        if (listResp.success && listResp.data) {
          for (const child of listResp.data) {
            if (child.id === jobId) continue;
            const childIds = parseJobResult(child.result ?? null);
            if (childIds.albumId || childIds.songId) return childIds;
          }
        }
      } catch (e) {
        logWarn("remoteImport", `list_jobs for session ${row.session_id} failed: ${String(e)}`);
      }
    }
    return null;
  } catch (e) {
    logWarn("remoteImport", `resolveJobEntities(${jobId}) failed: ${String(e)}`);
    return null;
  }
}

function parseJobResult(
  raw: string | null | undefined
): { albumId?: string; artistId?: string; songId?: string } {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const get = (k: string) =>
      typeof v[k] === "string" ? (v[k] as string) : undefined;
    return {
      albumId: get("album_id"),
      artistId: get("artist_id"),
      songId: get("song_id"),
    };
  } catch {
    return {};
  }
}

// translate a server `Stage` event into a short human-readable line.
// returns undefined for stages we don't want to surface.
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

// turn a raw server failure into a short, user-friendly line. the full
// detail is kept available via the `fullError` field for tooltip / debug.
export interface FriendlyError {
  short: string;
  full: string;
}
function humanizeJobError(
  message: string | undefined,
  errorType: string | undefined
): FriendlyError {
  const full = message?.trim() || errorType || "failed";
  if (errorType === ERROR_TYPE.DUPLICATE_SONG) {
    return { short: "song already exists", full };
  }
  const m = (message ?? "").toLowerCase();
  if (m.startsWith("file does not exist") || m.includes("downloaded file"))
    return { short: "downloaded file vanished before processing", full };
  if (m.includes("no files were downloaded") || m.includes("nothing downloaded"))
    return { short: "source returned no files", full };
  if (m.includes("invalid url") || m.includes("unsupported url"))
    return { short: "unsupported or invalid URL", full };
  if (m.includes("connection") || m.includes("network") || m.includes("dns"))
    return { short: "network error", full };
  if (m.includes("permission denied") || m.includes("forbidden"))
    return { short: "permission denied", full };
  if (m.includes("timeout") || m.includes("timed out"))
    return { short: "timed out", full };
  if (m.includes("unsupported format") || m.includes("unknown format"))
    return { short: "unsupported audio format", full };
  // short message: keep as-is. long message: truncate.
  const cleaned = full.replace(/\s+/g, " ");
  const short = cleaned.length > 80 ? cleaned.slice(0, 77) + "\u2026" : cleaned;
  return { short, full };
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
 * uses batched polling to reduce HTTP overhead when uploading multiple files.
 * @param onJobComplete optional callback when any job finishes (for query invalidation)
 */
export async function uploadFilesToRemote(
  files: FileList,
  onJobComplete?: () => void
): Promise<void> {
  const remote = getCurrentRemote();
  if (!remote) throw new Error("no active remote");

  const fileArray = Array.from(files);

  // shared poller for all uploads in this batch - polls every 3s
  const poller = new JobPoller(remote, 3000);

  for (const file of fileArray) {
    const trackId = addTrackedJob(file.name, "file");
    updateJobEntities(trackId, { remoteId: remote.remote_id });

    // fire off each upload + poll chain without blocking the others
    (async () => {
      try {
        const client = await getClientForRemote(remote);
        const result = await client.upload.music(file);
        if (!result.success) {
          // extract error message from the ZodError
          const errMsg = result.error?.issues?.[0]?.message || "upload request failed";
          updateJobStatus(trackId, "failed", { error: errMsg });
          return;
        }

        const jobId = result.data.job_id;
        updateJobStatus(trackId, "polling", { jobId });

        // register with batch poller (120s timeout)
        const pollResult = await poller.waitForJob(jobId, 120_000, {
          onStage: (stage, message) => updateJobStage(trackId, formatStage(stage, message)),
        });
        if (pollResult.status === "completed") {
          const ids = await resolveJobEntities(client, jobId);
          if (ids) updateJobEntities(trackId, ids);
          updateJobStatus(trackId, "completed");
          onJobComplete?.();
        } else if (pollResult.status === "timeout") {
          updateJobStatus(trackId, "timeout", { error: "taking a long time, check back later" });
          // partial work may have landed server-side; refresh queries.
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
          // a failed import can still create partial entities; refresh.
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
 * upload music files by filesystem path to a P2P remote.
 * uses iroh-blobs pull model: imports each file into local blobs store,
 * then tells the remote peer to pull it via verified streaming.
 * tracks jobs reactively like uploadFilesToRemote.
 * @param paths filesystem paths (from tauri dialog)
 * @param onJobComplete optional callback when any job finishes (for query invalidation)
 */
export async function uploadPathsToRemote(
  paths: string[],
  onJobComplete?: () => void
): Promise<void> {
  const remote = getCurrentRemote();
  if (!remote) throw new Error("no active remote");

  // shared poller for all uploads in this batch - polls every 3s
  const poller = new JobPoller(remote, 3000);

  for (const filePath of paths) {
    // use filename as label
    const filename = filePath.split("/").pop() || filePath.split("\\").pop() || filePath;
    const trackId = addTrackedJob(filename, "file");
    updateJobEntities(trackId, { remoteId: remote.remote_id });

    // fire off each upload + poll chain without blocking the others
    (async () => {
      try {
        const client = await getClientForRemote(remote);
        const result = await client.upload.musicByPath(filePath);
        if (!result.success) {
          const errMsg = result.error?.issues?.[0]?.message || "upload request failed";
          updateJobStatus(trackId, "failed", { error: errMsg });
          return;
        }

        const jobId = result.data.job_id;
        updateJobStatus(trackId, "polling", { jobId });

        // register with batch poller (120s timeout)
        const pollResult = await poller.waitForJob(jobId, 120_000, {
          onStage: (stage, message) => updateJobStage(trackId, formatStage(stage, message)),
        });
        if (pollResult.status === "completed") {
          const ids = await resolveJobEntities(client, jobId);
          if (ids) updateJobEntities(trackId, ids);
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

// ============================================================================
// fetch urls
// ============================================================================

/**
 * submit urls to the active remote server for fetching.
 * fires off fetch jobs and polls in the background — returns immediately.
 * uses batched polling to reduce HTTP overhead when fetching multiple urls.
 * @param onJobComplete optional callback when any job finishes
 */
export async function fetchUrlsOnRemote(urls: string[], onJobComplete?: () => void): Promise<void> {
  const remote = getCurrentRemote();
  if (!remote) throw new Error("no active remote");

  const userId = getCurrentUser()?.userId;

  // shared poller for all fetches in this batch - polls every 3s
  const poller = new JobPoller(remote, 3000);

  for (const url of urls) {
    // use a short label: hostname + path tail
    let label: string;
    try {
      const parsed = new URL(url);
      label =
        parsed.hostname +
        (parsed.pathname.length > 30 ? "..." + parsed.pathname.slice(-27) : parsed.pathname);
    } catch {
      label = url.length > 50 ? url.slice(0, 47) + "..." : url;
    }

    const trackId = addTrackedJob(label, "url");
    updateJobEntities(trackId, { remoteId: remote.remote_id });

    (async () => {
      try {
        const client = await getClientForRemote(remote);
        const result = await client.music.createFetchJob({
          url,
          user_id: userId ?? null,
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
          const ids = await resolveJobEntities(client, jobId);
          if (ids) updateJobEntities(trackId, ids);
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

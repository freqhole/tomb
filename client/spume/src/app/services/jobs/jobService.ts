// job service — abstracts job polling from the freqhole-api-client
// used for tracking async server operations like image uploads, music imports, etc.

import * as apiClient from "freqhole-api-client";
import { debug, warn, error as errorLog } from "../../../utils/logger";

// type guard helper for SafeParseResult
function isSuccess<T>(result: {
  success: boolean;
  data?: T;
  error?: any;
}): result is { success: true; data: T } {
  return result.success === true;
}

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

// ============================================================================
// JobPoller - batches multiple job status checks into single requests
// ============================================================================

interface WatchedJob {
  jobId: string;
  timeoutAt: number;
  resolve: (result: PollResultDetails) => void;
}

/**
 * batches job polling to reduce HTTP overhead when tracking multiple jobs.
 * instead of each job polling independently, all watched jobs are checked
 * in a single batch request on a shared interval.
 */
export class JobPoller {
  private baseUrl: string;
  private apiKey?: string;
  private watchedJobs: Map<string, WatchedJob> = new Map();
  private pollInterval: number;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(baseUrl: string, apiKey?: string, pollIntervalMs: number = 3000) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.pollInterval = pollIntervalMs;
  }

  /**
   * watch a job until it completes, fails, or times out.
   * returns a promise that resolves with the final status.
   */
  waitForJob(jobId: string, timeoutMs: number = 120_000): Promise<PollResultDetails> {
    return new Promise((resolve) => {
      const timeoutAt = Date.now() + timeoutMs;
      this.watchedJobs.set(jobId, { jobId, timeoutAt, resolve });
      this.ensurePolling();
    });
  }

  /** stop polling and clean up */
  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    // resolve any remaining jobs as timeout
    for (const job of this.watchedJobs.values()) {
      job.resolve({ status: "timeout" });
    }
    this.watchedJobs.clear();
  }

  private ensurePolling() {
    if (this.timerId || this.watchedJobs.size === 0) return;
    
    // do first poll immediately
    this.poll();
    
    // then continue on interval
    this.timerId = setInterval(() => this.poll(), this.pollInterval);
  }

  private stopPollingIfEmpty() {
    if (this.watchedJobs.size === 0 && this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private async poll() {
    if (this.watchedJobs.size === 0) {
      this.stopPollingIfEmpty();
      return;
    }

    const jobIds = Array.from(this.watchedJobs.keys());
    debug("jobs", `polling ${jobIds.length} jobs`);

    try {
      const result = await apiClient.music.getJobStatus(this.baseUrl, { job_ids: jobIds }, this.apiKey);

      if (!isSuccess(result)) {
        errorLog("jobs", "batch poll failed:", result.error);
        // don't resolve jobs on network error - will retry next interval
        return;
      }

      const now = Date.now();
      const jobsMap = result.data.jobs;

      for (const [jobId, watched] of this.watchedJobs.entries()) {
        const jobData = jobsMap[jobId];

        // check timeout first
        if (now >= watched.timeoutAt) {
          warn("jobs", `job ${jobId} timed out`);
          watched.resolve({ status: "timeout" });
          this.watchedJobs.delete(jobId);
          continue;
        }

        // job not found in response (shouldn't happen, but handle it)
        if (!jobData) {
          continue;
        }

        const status = jobData.status;

        if (status === "Completed") {
          debug("jobs", `job ${jobId} completed`);
          watched.resolve({ status: "completed" });
          this.watchedJobs.delete(jobId);
        } else if (status === "Failed" || status === "Cancelled") {
          const errors = jobData.errors ?? undefined;
          const errMsg = errors?.[0]?.detail ?? jobData.error_message ?? undefined;
          errorLog("jobs", `job ${jobId} failed:`, errMsg);
          watched.resolve({ status: "failed", errorMessage: errMsg, errors });
          this.watchedJobs.delete(jobId);
        }
        // else still pending/running, continue watching
      }
    } catch (err) {
      errorLog("jobs", "poll error:", err);
      // will retry next interval
    }

    this.stopPollingIfEmpty();
  }
}

// ============================================================================
// single-job polling functions (convenience wrappers for one-off jobs)
// ============================================================================

/**
 * poll for job completion on a remote server
 * @param baseUrl - remote base URL
 * @param jobId - job ID to poll
 * @param timeoutMs - timeout in milliseconds (default: 10000)
 * @param apiKey - optional api key for auth
 * @returns "completed" if job finished, "failed" if job failed/cancelled or server error,
 *          "timeout" if polling hit its time limit (job may still be processing on server)
 */
export async function pollJobUntilComplete(
  baseUrl: string,
  jobId: string,
  timeoutMs: number = 10000,
  apiKey?: string,
): Promise<PollResult> {
  const result = await pollJobWithDetails(baseUrl, jobId, timeoutMs, apiKey);
  return result.status;
}

/**
 * poll for job completion with detailed result including error message
 * @param baseUrl - remote base URL
 * @param jobId - job ID to poll
 * @param timeoutMs - timeout in milliseconds (default: 10000)
 * @param apiKey - optional api key for auth
 * @returns detailed result with status and error message if failed
 */
export async function pollJobWithDetails(
  baseUrl: string,
  jobId: string,
  timeoutMs: number = 10000,
  apiKey?: string,
): Promise<PollResultDetails> {
  const startTime = Date.now();
  const pollInterval = 3000; // check every 3 seconds

  while (Date.now() - startTime < timeoutMs) {
    const jobResult = await apiClient.music.getJobStatus(baseUrl, {
      job_ids: [jobId],
    }, apiKey);

    if (!isSuccess(jobResult)) {
      errorLog("jobs", "failed to get job status:", jobResult.error);
      return { status: "failed", errorMessage: "failed to check job status" };
    }

    // extract job from response map
    const jobData = jobResult.data.jobs[jobId];
    if (!jobData) {
      errorLog("jobs", "job not found in response:", jobId);
      return { status: "failed", errorMessage: "job not found" };
    }

    const status = jobData.status;

    if (status === "Completed") {
      debug("jobs", `job ${jobId} completed`);
      return { status: "completed" };
    } else if (status === "Failed" || status === "Cancelled") {
      // errors are now properly typed in the response
      const errors = jobData.errors ?? undefined;
      const errMsg = errors?.[0]?.detail ?? jobData.error_message ?? undefined;
      errorLog("jobs", "job failed or was cancelled:", errMsg);
      return { status: "failed", errorMessage: errMsg, errors };
    }

    // wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  warn("jobs", "job polling timed out — job may still complete on server");
  return { status: "timeout" };
}

/**
 * get job status (single check, no polling)
 * @param baseUrl - remote base URL
 * @param jobId - job ID to check
 * @param apiKey - optional api key for auth
 * @returns job status data or null if failed to fetch
 */
export async function getJobStatus(
  baseUrl: string,
  jobId: string,
  apiKey?: string,
): Promise<{ status: string; error_message?: string | null } | null> {
  const result = await apiClient.music.getJobStatus(baseUrl, { job_ids: [jobId] }, apiKey);
  if (isSuccess(result)) {
    const jobData = result.data.jobs[jobId];
    if (jobData) {
      return { status: jobData.status, error_message: jobData.error_message };
    }
  }
  return null;
}
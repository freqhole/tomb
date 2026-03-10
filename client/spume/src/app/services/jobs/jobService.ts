// job service — abstracts job polling from the freqhole-api-client
// used for tracking async server operations like image uploads, music imports, etc.

import { getClientForRemote, type RemoteRef } from "../../api/client";
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
  private remote: RemoteRef;
  private watchedJobs: Map<string, WatchedJob> = new Map();
  private pollInterval: number;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(remote: RemoteRef, pollIntervalMs: number = 3000) {
    this.remote = remote;
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
      const client = await getClientForRemote(this.remote);
      const result = await client.music.getJobStatus({ job_ids: jobIds });

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
// convenience wrapper for single-job polling
// ============================================================================

/**
 * poll a single job until complete. creates a temporary JobPoller internally.
 * for multiple jobs, use JobPoller directly to batch requests.
 */
export async function pollJobUntilComplete(
  remote: RemoteRef,
  jobId: string,
  timeoutMs: number = 10000,
): Promise<PollResult> {
  const poller = new JobPoller(remote, 3000);
  const result = await poller.waitForJob(jobId, timeoutMs);
  poller.stop();
  return result.status;
}

/**
 * poll a single job with detailed result including error message.
 * for multiple jobs, use JobPoller directly to batch requests.
 */
export async function pollJobWithDetails(
  remote: RemoteRef,
  jobId: string,
  timeoutMs: number = 10000,
): Promise<PollResultDetails> {
  const poller = new JobPoller(remote, 3000);
  const result = await poller.waitForJob(jobId, timeoutMs);
  poller.stop();
  return result;
}
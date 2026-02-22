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

/**
 * poll for job completion on a remote server
 * @param baseUrl - remote base URL
 * @param jobId - job ID to poll
 * @param timeoutMs - timeout in milliseconds (default: 10000)
 * @returns "completed" if job finished, "failed" if job failed/cancelled or server error,
 *          "timeout" if polling hit its time limit (job may still be processing on server)
 */
export async function pollJobUntilComplete(
  baseUrl: string,
  jobId: string,
  timeoutMs: number = 10000,
): Promise<PollResult> {
  const startTime = Date.now();
  const pollInterval = 500; // check every 500ms

  while (Date.now() - startTime < timeoutMs) {
    const jobResult = await apiClient.music.getJobStatus(baseUrl, {
      job_id: jobId,
    });

    if (!isSuccess(jobResult)) {
      errorLog("jobs", "failed to get job status:", jobResult.error);
      return "failed";
    }

    // type guard ensures jobResult.data exists after success check
    const jobData = jobResult.data;
    const status = jobData.status;

    if (status === "Completed") {
      debug("jobs", `job ${jobId} completed`);
      return "completed";
    } else if (status === "Failed" || status === "Cancelled") {
      errorLog("jobs", "job failed or was cancelled:", jobData.error_message);
      return "failed";
    }

    // wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  warn("jobs", "job polling timed out — job may still complete on server");
  return "timeout";
}

/**
 * get job status (single check, no polling)
 * @param baseUrl - remote base URL
 * @param jobId - job ID to check
 * @returns job status data or null if failed to fetch
 */
export async function getJobStatus(
  baseUrl: string,
  jobId: string,
): Promise<{ status: string; error_message?: string | null } | null> {
  const result = await apiClient.music.getJobStatus(baseUrl, { job_id: jobId });
  if (isSuccess(result)) {
    return { status: result.data.status, error_message: result.data.error_message };
  }
  return null;
}

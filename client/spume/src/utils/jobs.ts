// job polling utilities
import * as apiClient from "freqhole-api-client";

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
 * poll for job completion
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
      console.error("failed to get job status:", jobResult.error);
      return "failed";
    }

    // type guard ensures jobResult.data exists after success check
    const jobData = jobResult.data;
    const status = jobData.status;

    if (status === "Completed") {
      return "completed";
    } else if (status === "Failed" || status === "Cancelled") {
      console.error("job failed or was cancelled:", jobData.error_message);
      return "failed";
    }

    // wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  console.warn("job polling timed out — job may still complete on server");
  return "timeout";
}

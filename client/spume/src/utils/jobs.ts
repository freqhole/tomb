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

/**
 * poll for job completion
 * @param baseUrl - remote base URL
 * @param jobId - job ID to poll
 * @param timeoutMs - timeout in milliseconds (default: 10000)
 * @returns true if job completed successfully, false if failed/cancelled/timeout
 */
export async function pollJobUntilComplete(
  baseUrl: string,
  jobId: string,
  timeoutMs: number = 10000,
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500; // check every 500ms

  while (Date.now() - startTime < timeoutMs) {
    const jobResult = await apiClient.music.getJobStatus(baseUrl, {
      job_id: jobId,
    });

    if (!isSuccess(jobResult)) {
      console.error("failed to get job status:", jobResult.error);
      return false;
    }

    // type guard ensures jobResult.data exists after success check
    const jobData = jobResult.data;
    const status = jobData.status;

    if (status === "Completed") {
      return true;
    } else if (status === "Failed" || status === "Cancelled") {
      console.error("job failed or was cancelled:", jobData.error_message);
      return false;
    }

    // wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  console.warn("job polling timed out");
  return false;
}

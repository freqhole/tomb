import { describe, expect, it } from "vitest";
import { jobDuration, jobProgress, jobTimestamp, type JobRow } from "./jobs";

describe("job record times", () => {
  it("uses compact relative times with absolute dates", () => {
    const now = 1793937600;
    for (const [age, text] of [
      [0, "just now"],
      [30, "30s ago"],
      [600, "10m ago"],
      [21600, "6 hours ago"],
      [172800, "2 days ago"],
      [604800, "last week"],
      [2592000, "last month"],
    ] as const) {
      expect(jobTimestamp(now - age, now)).toContain(text);
      expect(jobTimestamp(now - age, now)).toContain("2026");
    }
    expect(jobTimestamp(undefined)).toBe("time unknown");
    expect(jobDuration(3665)).toBe("1h 1m");
  });

  it("freezes finished durations and never ages an unknown finished time", () => {
    const job: JobRow = {
      id: "job",
      session_id: null,
      job_type: "ProcessFile",
      status: "Completed",
      scheduled_at: 90,
      started_at: 100,
      completed_at: 130,
      retry_count: 0,
      max_retries: 0,
      error_message: null,
      stage: null,
      message: null,
      checked: null,
      total: null,
    };
    expect(jobProgress(job, 1000)).toContain("ran for 30s");
    job.completed_at = null;
    expect(jobProgress(job, 1000)).toContain("duration unknown");
    job.status = "Running";
    expect(jobProgress(job, 160)).toContain("running for 1m 0s");
  });
});

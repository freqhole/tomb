import { For, Show } from "solid-js";
import { useJobs, type TrackedJob } from "../jobs";

export const LIBRARY_JOB_TYPES = new Set([
  "ScanDirectory",
  "RescanDirectories",
  "ProcessFile",
  "ProcessDirectory",
  "RepairLibraryImages",
  "ReorganizeLibraryFiles",
  "RegenerateVideoPosters",
  "AuditBlobReferences",
  "TranscodeVideo",
  "ImportMusic",
  "ImportVideo",
  "FetchMedia",
  "ConvertWebp",
  "SyncSongByBlake3",
  "SyncVideoByBlake3",
]);

export default function JobProgress(props: { filter?: (job: TrackedJob) => boolean }) {
  const tracker = useJobs();
  const related = () =>
    tracker
      .jobs()
      .filter(
        (job) =>
          (!props.filter || props.filter(job)) &&
          ["pending", "running", "failed"].includes(job.status),
      )
      .sort(
        (a, b) =>
          ["running", "pending", "failed"].indexOf(a.status) -
          ["running", "pending", "failed"].indexOf(b.status),
      );
  const running = () => related().filter((job) => job.status === "running").length;
  const pending = () => related().filter((job) => job.status === "pending").length;
  const failed = () => related().filter((job) => job.status === "failed").length;
  return (
    <Show when={related().length > 0 || tracker.error()}>
      <section class="scan-progress-card job-progress" aria-label="related jobs">
        <div class="job-progress-heading">
          <strong>library jobs</strong>
          <span>
            {running()} running · {pending()} pending · {failed()} failed
          </span>
          <a href="#/jobs">all jobs</a>
        </div>
        <Show when={tracker.error()}>
          <p class="scan-progress error">{tracker.error()}</p>
          <button
            class="secondary small"
            onClick={() => void tracker.reconnect().catch(console.error)}
          >
            reconnect progress
          </button>
        </Show>
        <For each={related().slice(0, 4)}>
          {(job) => (
            <div class="job-progress-row">
              <a href={`#/jobs?job=${encodeURIComponent(job.job_id)}`}>{job.job_type}</a>
              <span>{job.status}</span>
              <Show
                when={job.total !== undefined && job.total! > 0}
                fallback={
                  <Show when={job.status === "running"}>
                    <span class="spinner" aria-label="running" />
                  </Show>
                }
              >
                <progress value={job.checked ?? 0} max={job.total} />
                <span>
                  {job.checked ?? 0} / {job.total}
                </span>
              </Show>
              <p>{job.errors?.map((error) => error.detail).join("; ") || job.last_message}</p>
              <a href={`#/jobs?job=${encodeURIComponent(job.job_id)}`}>inspect job</a>
            </div>
          )}
        </For>
        <Show when={related().length > 4}>
          <p class="hint">
            {related().length - 4} more tracked jobs; open all jobs for the full queue.
          </p>
        </Show>
      </section>
    </Show>
  );
}

import { createEffect, createSignal, on, Show } from "solid-js";
import { useJobs } from "../jobs";

export default function BlobReferenceMaintenance() {
  const tracker = useJobs();
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const running = () =>
    loading() ||
    tracker
      .jobs()
      .some(
        (job) =>
          job.job_type === "AuditBlobReferences" && ["pending", "running"].includes(job.status),
      );
  createEffect(on(tracker.connected, () => setError("")));

  async function enqueue(repair: boolean) {
    setLoading(true);
    setError("");
    try {
      const response = await tracker.dispatch("maintenance_audit_blob_references", {
        repair,
      });
      if (!response.success) throw new Error(response.message);
    } catch (e) {
      setError(`could not queue reference job: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <details class="flyout flyout--accent">
      <summary>audit and repair blob references</summary>
      <div>
        <p class="hint">
          verify known music and video file paths and content hashes. repair also restores verified
          P2P references. no media is moved, overwritten, or deleted. connect your library disks
          first; a large library can take a while.
        </p>
        <div class="button-row">
          <button class="secondary" disabled={running()} onClick={() => enqueue(false)}>
            audit only
          </button>
          <button class="secondary" disabled={running()} onClick={() => enqueue(true)}>
            audit and repair
          </button>
        </div>
        <p class="hint">
          progress appears with related library jobs.{" "}
          <a href="#/jobs">inspect all jobs and results</a>; queued work continues if you leave this
          view.
        </p>
        <Show when={error()}>
          <p class="scan-progress error">{error()}</p>
        </Show>
      </div>
    </details>
  );
}

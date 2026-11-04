import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { useAdminTransport } from "../admin/context";

interface AuditJob {
  id: string;
  status: string;
  result: string | null;
  error_message: string | null;
}

interface AuditResult {
  checked?: number;
  total?: number;
  repair?: boolean;
  entries?: { error: string | null }[];
}

export default function BlobReferenceMaintenance() {
  const admin = useAdminTransport();
  const [job, setJob] = createSignal<AuditJob | null>(null);
  const [result, setResult] = createSignal<AuditResult | null>(null);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const running = () => loading() || ["Pending", "Running"].includes(job()?.status ?? "");
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function update(value: AuditJob | null) {
    const parsed: AuditResult | null =
      value?.result && value.status !== "Failed" ? JSON.parse(value.result) : null;
    setJob(value);
    setResult(parsed);
  }

  async function refresh(id: string | undefined, current = generation) {
    try {
      const value = await admin.dispatchOrThrow<AuditJob | null>(
        "maintenance_blob_reference_status",
        id ? { job_id: id } : {},
      );
      if (current !== generation) return;
      update(value);
      setError("");
      if (value && ["Pending", "Running"].includes(value.status)) {
        timer = setTimeout(() => refresh(value.id, current), 1000);
      }
    } catch (e) {
      if (current === generation) setError(`could not read reference job: ${e}`);
    }
  }

  createEffect(
    on(
      () => `${admin.current().kind}:${admin.current().peerAddr ?? ""}`,
      () => {
        generation++;
        clearTimeout(timer);
        update(null);
        setError("");
        setLoading(false);
        void refresh(undefined);
      },
    ),
  );
  onCleanup(() => {
    generation++;
    clearTimeout(timer);
  });

  async function enqueue(repair: boolean) {
    const current = ++generation;
    clearTimeout(timer);
    setLoading(true);
    setError("");
    try {
      const value = await admin.dispatchOrThrow<AuditJob>("maintenance_audit_blob_references", {
        repair,
      });
      if (current !== generation) return;
      update(value);
      await refresh(value.id, current);
    } catch (e) {
      if (current === generation) setError(`could not queue reference job: ${e}`);
    } finally {
      if (current === generation) setLoading(false);
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
        <Show when={job()}>
          {(value) => (
            <div class="scan-progress-card">
              <p>reference job: {value().status.toLowerCase()}</p>
              <Show when={result()?.checked !== undefined}>
                <p>
                  checked {result()?.checked} of {result()?.total} references
                </p>
              </Show>
              <Show when={value().status === "Completed" && result()?.entries}>
                <p>
                  {result()?.entries?.length} references{" "}
                  {result()?.repair ? "verified and repaired" : "verified"}.
                </p>
              </Show>
              <Show when={value().error_message}>
                <pre class="scan-progress error">{value().error_message}</pre>
              </Show>
              <p class="hint">job {value().id}; continues if you leave this view.</p>
            </div>
          )}
        </Show>
        <Show when={error()}>
          <p class="scan-progress error">{error()}</p>
          <button
            class="secondary small"
            onClick={() => {
              clearTimeout(timer);
              void refresh(job()?.id);
            }}
          >
            retry status
          </button>
        </Show>
      </div>
    </details>
  );
}

// shared "raw data" review surface for last.fm + theaudiodb album
// enrichment, used by both the bulk enrichment review modal (via
// LastFmReviewModal / AudioDbReviewModal) and the single-album editor
// modal (embedded directly inside the lastfm / audiodb tabs).
//
// renders, for a given (album, source) pair:
//   - status strip while a fetch job is in flight or just settled
//   - [fetch | refetch] from <source> button (enqueues a single-album
//     detail job and polls until terminal)
//   - the stored `metadata.<source>` json subtree as pretty-printed
//     read-only json
//
// nothing here mutates the album record itself — this is a peek + raw
// fetch surface. promotion of fields into structured columns happens
// elsewhere (taxon / bio / image / url review panels in the bulk flow).

import { createMemo, createSignal, Show, onCleanup } from "solid-js";
import { getClientForRemote } from "../../app/api/client";
import { queryClient } from "../../queryClient";
import type { Remote } from "../../app/services/storage/schemas/remote";

export type EnrichmentReviewSource = "lastfm" | "audiodb";

interface EnrichmentReviewPanelProps {
  source: EnrichmentReviewSource;
  albumId: string;
  /** raw `Album.metadata` json string, or null. */
  metadataRaw: string | null;
  remote: Remote;
  /** when false, the fetch/refetch button is disabled (read-only). */
  isAdmin: boolean;
  /** when true, suppresses this panel's own fetch/refetch button. used
   *  when embedding inside another surface that already exposes a
   *  refetch trigger (e.g. the per-source tab in the album editor),
   *  so we don't render two buttons doing the same thing. */
  hideFetchButton?: boolean;
}

type JobState =
  | { kind: "idle" }
  | { kind: "enqueuing" }
  | { kind: "polling"; jobId: string; status: string; ticks: number }
  | {
      kind: "done";
      jobId: string;
      status: string;
      resultJson: string | null;
      errorMessage: string | null;
    }
  | { kind: "error"; message: string };

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_TICKS = 60; // ~90s

function sourceLabel(s: EnrichmentReviewSource): string {
  return s === "lastfm" ? "last.fm" : "audiodb";
}

export function EnrichmentReviewPanel(props: EnrichmentReviewPanelProps) {
  // pull the source subtree straight from the raw json; survives schema drift.
  const rawSnapshot = createMemo<unknown>(() => {
    const raw = props.metadataRaw;
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.[props.source] ?? null;
    } catch {
      return null;
    }
  });
  const hasSnapshot = () => rawSnapshot() !== null && rawSnapshot() !== undefined;

  const [state, setState] = createSignal<JobState>({ kind: "idle" });

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
  onCleanup(stopPolling);

  const invalidateAlbums = () => {
    void queryClient.invalidateQueries({
      queryKey: ["library-albums", props.remote.remote_id],
    });
  };

  const isBusy = () => {
    const s = state();
    return s.kind === "enqueuing" || s.kind === "polling";
  };

  const startPolling = (jobId: string) => {
    stopPolling();
    setState({ kind: "polling", jobId, status: "queued", ticks: 0 });
    pollTimer = setInterval(async () => {
      try {
        const client = await getClientForRemote(props.remote);
        const resp = await client.music.getJobStatus({ job_ids: [jobId] });
        if (!resp.success) {
          stopPolling();
          setState({ kind: "error", message: resp.error.message });
          return;
        }
        const job = resp.data.jobs[jobId];
        if (!job) {
          stopPolling();
          setState({ kind: "error", message: "job not found in status response" });
          return;
        }
        const cur = state();
        const ticks = cur.kind === "polling" ? cur.ticks + 1 : 1;
        if (job.status === "Completed" || job.status === "Failed" || job.status === "Cancelled") {
          stopPolling();
          invalidateAlbums();
          setState({
            kind: "done",
            jobId,
            status: job.status,
            resultJson: job.result ?? null,
            errorMessage: job.error_message ?? null,
          });
          return;
        }
        if (ticks > POLL_MAX_TICKS) {
          stopPolling();
          setState({
            kind: "error",
            message: `timed out after ${POLL_MAX_TICKS} ticks (last status: ${job.status})`,
          });
          return;
        }
        setState({ kind: "polling", jobId, status: job.status, ticks });
      } catch (e) {
        stopPolling();
        setState({ kind: "error", message: (e as Error).message });
      }
    }, POLL_INTERVAL_MS);
  };

  const onEnqueue = async () => {
    setState({ kind: "enqueuing" });
    try {
      const client = await getClientForRemote(props.remote);
      const resp =
        props.source === "lastfm"
          ? await client.music.enqueueLastFmAlbumDetail({ album_ids: [props.albumId] })
          : await client.music.enqueueAudioDbAlbumDetail({ album_ids: [props.albumId] });
      if (!resp.success) {
        setState({ kind: "error", message: resp.error.message });
        return;
      }
      const jobId = resp.data.job_ids[0];
      if (!jobId) {
        setState({ kind: "error", message: "no job id returned (album may have been skipped)" });
        return;
      }
      startPolling(jobId);
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  };

  const prettyJson = (v: unknown) => {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  };

  const parsedResult = createMemo<unknown>(() => {
    const s = state();
    if (s.kind !== "done" || !s.resultJson) return null;
    try {
      return JSON.parse(s.resultJson);
    } catch {
      return s.resultJson;
    }
  });

  const label = sourceLabel(props.source);

  return (
    <div class="space-y-3">
      <div class="text-xs text-[var(--color-text-muted)]">
        raw <code>metadata.{props.source}</code> snapshot for review. nothing here is auto-applied —
        this surface is for humans to decide what to promote into structured fields.
        <Show when={props.source === "audiodb"}>
          {" "}
          lookup is by mbid (release-group) when known, otherwise text-search by artist + title.
        </Show>
      </div>

      {/* job status strip — shown while a job is in flight or just settled */}
      <Show when={state().kind !== "idle"}>
        <div
          class="text-xs rounded border p-2 space-y-1"
          classList={{
            "border-blue-500/30 bg-blue-500/5":
              state().kind === "enqueuing" || state().kind === "polling",
            "border-emerald-500/30 bg-emerald-500/5":
              state().kind === "done" && (state() as { status: string }).status === "Completed",
            "border-rose-500/30 bg-rose-500/5":
              state().kind === "error" ||
              (state().kind === "done" && (state() as { status: string }).status !== "Completed"),
          }}
        >
          <Show when={state().kind === "enqueuing"}>
            <div class="text-blue-300">enqueuing job…</div>
          </Show>
          <Show when={state().kind === "polling"}>
            {(() => {
              const s = state() as {
                kind: "polling";
                jobId: string;
                status: string;
                ticks: number;
              };
              return (
                <div class="flex items-center gap-2 text-blue-300">
                  <span class="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  job <code class="text-[10px]">{s.jobId.slice(0, 8)}</code> — {s.status} (tick{" "}
                  {s.ticks}/{POLL_MAX_TICKS})
                </div>
              );
            })()}
          </Show>
          <Show when={state().kind === "done"}>
            {(() => {
              const s = state() as {
                kind: "done";
                jobId: string;
                status: string;
                resultJson: string | null;
                errorMessage: string | null;
              };
              return (
                <>
                  <div
                    classList={{
                      "text-emerald-300": s.status === "Completed",
                      "text-rose-300": s.status !== "Completed",
                    }}
                  >
                    job <code class="text-[10px]">{s.jobId.slice(0, 8)}</code> — {s.status}
                  </div>
                  <Show when={s.errorMessage}>
                    <div class="text-rose-300 break-all">error: {s.errorMessage}</div>
                  </Show>
                  <Show when={parsedResult()}>
                    <details class="mt-1">
                      <summary class="cursor-pointer text-[var(--color-text-secondary)]">
                        job result
                      </summary>
                      <pre class="mt-1 text-[10px] leading-snug bg-black/40 border border-[var(--color-border-subtle)] rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                        {prettyJson(parsedResult())}
                      </pre>
                    </details>
                  </Show>
                </>
              );
            })()}
          </Show>
          <Show when={state().kind === "error"}>
            <div class="text-rose-300 break-all">
              {(state() as { kind: "error"; message: string }).message}
            </div>
          </Show>
        </div>
      </Show>

      {/* fetch / refetch button — suppressed when embedded inside a
          surface that already owns the refetch trigger. */}
      <Show when={!props.hideFetchButton}>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="text-xs px-2 py-1 rounded border border-[var(--color-accent-500)]/40 text-[var(--color-accent-400)] hover:bg-[var(--color-accent-500)]/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-transparent"
            disabled={isBusy() || !props.isAdmin}
            title={!props.isAdmin ? "admin only" : undefined}
            onClick={onEnqueue}
          >
            <Show when={hasSnapshot()} fallback={<>fetch from {label}</>}>
              refetch from {label}
            </Show>
          </button>
          <Show when={!props.isAdmin}>
            <span class="text-xs text-[var(--color-text-muted)]">admin only</span>
          </Show>
          <Show when={props.isAdmin && !hasSnapshot() && state().kind === "idle"}>
            <span class="text-xs text-[var(--color-text-muted)]">
              no {label} snapshot stored yet for this album
            </span>
          </Show>
        </div>
      </Show>

      {/* stored snapshot — collapsed by default; raw json is for
          spot-checking, not the primary action surface. */}
      <Show when={hasSnapshot()}>
        <details class="group">
          <summary class="cursor-pointer text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] select-none">
            stored snapshot
          </summary>
          <pre class="mt-2 text-[11px] leading-snug bg-black/40 border border-[var(--color-border-subtle)] rounded p-3 overflow-auto max-h-[60dvh] whitespace-pre-wrap break-all text-[var(--color-text-secondary)]">
            {prettyJson(rawSnapshot())}
          </pre>
        </details>
      </Show>
    </div>
  );
}

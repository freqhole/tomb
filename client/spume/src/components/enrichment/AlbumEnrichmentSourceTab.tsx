// per-source enrichment tab used inside AlbumEditorModal (phase 14.7).
//
// renders, for a given (album, source) pair:
//   - status badge (idle / pending / running / done / failed / cancelled)
//   - last-attempt timestamp + retry count + last error
//   - snapshot summary (best-effort; source-specific fields)
//   - [refetch] button (re-enqueue with no override)
//   - [edit query & retry] form (POST /api/music/albums/enrichment/requery
//     with `override_query`)
//
// the modal owns the polling loop so multiple tabs share one in-flight
// request; this component just receives `progress` + a refresh callback.

import { createMemo, createSignal, Show } from "solid-js";
import { toast } from "../feedback/Toast";
import { Button } from "../buttons/Button";
import { getCurrentRemote } from "../../music/data";
import { getClientForRemote } from "../../app/api/client";
import { formatDateTime } from "../../utils/dateTime";
import type { EnrichmentSource } from "../../library/hooks/useMbLookupJobs";

/** maps the lowercase client-side source key to the Rust-style server tag. */
function sourceToServerTag(s: EnrichmentSource): "Mb" | "Lastfm" | "Audiodb" {
  switch (s) {
    case "mb":
      return "Mb";
    case "lastfm":
      return "Lastfm";
    case "audiodb":
      return "Audiodb";
  }
}

function sourceLabel(s: EnrichmentSource): string {
  switch (s) {
    case "mb":
      return "musicbrainz";
    case "lastfm":
      return "last.fm";
    case "audiodb":
      return "theaudiodb";
  }
}

export interface SourceProgress {
  /** matches grimoire `EnrichmentSourceStatus.status` */
  status: string;
  last_attempt_at?: number | null;
  last_error?: string | null;
  retry_count: number;
}

interface AlbumEnrichmentSourceTabProps {
  albumId: string;
  source: EnrichmentSource;
  /** current artist/title used to seed the override-query form. */
  initialArtist: string;
  initialTitle: string;
  /** current mbid (only meaningful for source="mb"). */
  initialMbid?: string;
  /** snapshot data extracted from album metadata (source-specific shape). */
  snapshot?: unknown;
  /** progress fetched by parent's poller. undefined = not loaded yet. */
  progress?: SourceProgress;
  /** called after a successful refetch / requery so parent can re-poll. */
  onRequeried?: () => void;
}

function statusTone(status: string): string {
  const lower = status.toLowerCase();
  if (lower === "completed" || lower === "done") {
    return "bg-green-500/20 text-green-300 border-green-500/30";
  }
  if (lower === "running") {
    return "bg-blue-500/20 text-blue-300 border-blue-500/30";
  }
  if (lower === "pending") {
    return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
  }
  if (lower === "failed") {
    return "bg-red-500/20 text-red-300 border-red-500/30";
  }
  if (lower === "cancelled") {
    return "bg-gray-500/20 text-gray-300 border-gray-500/30";
  }
  return "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] border-[var(--color-border-default)]";
}

export function AlbumEnrichmentSourceTab(props: AlbumEnrichmentSourceTabProps) {
  const [editing, setEditing] = createSignal(false);
  const [overrideArtist, setOverrideArtist] = createSignal(props.initialArtist);
  const [overrideTitle, setOverrideTitle] = createSignal(props.initialTitle);
  const [overrideMbid, setOverrideMbid] = createSignal(props.initialMbid ?? "");
  const [submitting, setSubmitting] = createSignal(false);

  const status = createMemo(() => props.progress?.status ?? "idle");

  const submit = async (useOverride: boolean) => {
    const remote = getCurrentRemote();
    if (!remote) {
      toast.error("not connected to a remote");
      return;
    }
    setSubmitting(true);
    try {
      const client = await getClientForRemote(remote);
      const override = useOverride
        ? {
            artist: overrideArtist().trim() || null,
            title: overrideTitle().trim() || null,
            mbid: props.source === "mb" ? overrideMbid().trim() || null : null,
          }
        : { artist: null, title: null, mbid: null };
      const resp = await client.music.requeryEnrichment({
        album_id: props.albumId,
        source: sourceToServerTag(props.source) as any,
        override_query: override,
        priority: 10,
      });
      if (!resp.success) {
        toast.error(resp.error?.message || "requery failed");
        return;
      }
      toast.success(`${sourceLabel(props.source)} re-enqueued`);
      setEditing(false);
      props.onRequeried?.();
    } catch (err) {
      console.error("requery_enrichment failed:", err);
      toast.error(`requery failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="space-y-4">
      {/* header: source + status badge */}
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-[var(--color-text-primary)]">
            {sourceLabel(props.source)}
          </span>
          <span class={`px-2 py-0.5 text-xs rounded border ${statusTone(status())}`}>
            {status()}
          </span>
          <Show when={(props.progress?.retry_count ?? 0) > 0}>
            <span class="text-xs text-[var(--color-text-tertiary)]">
              · {props.progress!.retry_count} retr
              {props.progress!.retry_count === 1 ? "y" : "ies"}
            </span>
          </Show>
        </div>
        <Show when={props.progress?.last_attempt_at}>
          <span class="text-xs text-[var(--color-text-tertiary)]" title="last attempt">
            {formatDateTime(props.progress!.last_attempt_at!)}
          </span>
        </Show>
      </div>

      {/* last error */}
      <Show when={props.progress?.last_error}>
        <div class="px-3 py-2 text-xs bg-red-500/10 border border-red-500/30 rounded text-red-300 break-words">
          <span class="font-medium">last error: </span>
          {props.progress!.last_error}
        </div>
      </Show>

      {/* snapshot summary */}
      <SnapshotSummary source={props.source} snapshot={props.snapshot} />

      {/* actions */}
      <div class="flex items-center gap-2 pt-2">
        <Button variant="secondary" onClick={() => submit(false)} disabled={submitting()}>
          {submitting() ? "..." : "refetch"}
        </Button>
        <Button variant="secondary" onClick={() => setEditing((v) => !v)} disabled={submitting()}>
          {editing() ? "cancel edit" : "edit query & retry"}
        </Button>
      </div>

      {/* override-query form */}
      <Show when={editing()}>
        <div class="p-3 space-y-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
          <div class="space-y-1">
            <label class="block text-xs text-[var(--color-text-tertiary)]">artist</label>
            <input
              type="text"
              value={overrideArtist()}
              onInput={(e) => setOverrideArtist(e.currentTarget.value)}
              class="w-full px-2 py-1 text-sm bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)]"
            />
          </div>
          <div class="space-y-1">
            <label class="block text-xs text-[var(--color-text-tertiary)]">title</label>
            <input
              type="text"
              value={overrideTitle()}
              onInput={(e) => setOverrideTitle(e.currentTarget.value)}
              class="w-full px-2 py-1 text-sm bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)]"
            />
          </div>
          <Show when={props.source === "mb"}>
            <div class="space-y-1">
              <label class="block text-xs text-[var(--color-text-tertiary)]">
                mbid (optional — direct lookup)
              </label>
              <input
                type="text"
                value={overrideMbid()}
                onInput={(e) => setOverrideMbid(e.currentTarget.value)}
                placeholder="release-group or release id"
                class="w-full px-2 py-1 text-sm bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] font-mono"
              />
            </div>
          </Show>
          <div class="flex items-center justify-end gap-2 pt-1">
            <Button variant="primary" onClick={() => submit(true)} disabled={submitting()}>
              {submitting() ? "..." : "retry with override"}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
}

function SnapshotSummary(props: { source: EnrichmentSource; snapshot: unknown }) {
  const rows = createMemo(() => buildRows(props.source, props.snapshot));
  return (
    <Show
      when={rows().length > 0}
      fallback={
        <div class="px-3 py-2 text-xs italic text-[var(--color-text-tertiary)] bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
          no data captured yet
        </div>
      }
    >
      <div class="px-3 py-2 text-xs bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded space-y-1">
        {rows().map((r) => (
          <div class="flex gap-2">
            <span class="w-20 text-[var(--color-text-tertiary)]">{r.k}</span>
            <span class="flex-1 text-[var(--color-text-primary)] break-words">{r.v}</span>
          </div>
        ))}
      </div>
    </Show>
  );
}

function buildRows(source: EnrichmentSource, snapshot: unknown): { k: string; v: string }[] {
  if (!snapshot || typeof snapshot !== "object") return [];
  const s = snapshot as Record<string, any>;
  const rows: { k: string; v: string }[] = [];
  const push = (k: string, v: any) => {
    if (v == null || v === "") return;
    rows.push({ k, v: typeof v === "string" ? v : JSON.stringify(v) });
  };

  if (source === "mb") {
    push("mbid", s.release_group_mbid ?? s.release_mbid ?? s.mbid);
    push("title", s.title);
    push("artist", s.artist);
    push("date", s.first_release_date ?? s.release_date);
    push("country", s.country);
  } else if (source === "lastfm") {
    const album = s.album ?? s;
    push("title", album?.name);
    push("artist", album?.artist);
    push("listeners", album?.listeners);
    push("playcount", album?.playcount);
    if (Array.isArray(album?.tags) && album.tags.length > 0) {
      push(
        "tags",
        album.tags
          .slice(0, 8)
          .map((t: any) => t?.name)
          .filter(Boolean)
          .join(", ")
      );
    }
    push("wiki", album?.wiki_summary);
  } else if (source === "audiodb") {
    const album = s.album ?? s;
    push("title", album?.title);
    push("artist", album?.artist);
    push("year", album?.year_released);
    push("genre", album?.genre);
    push("style", album?.style);
    push("mood", album?.mood);
  }
  return rows;
}

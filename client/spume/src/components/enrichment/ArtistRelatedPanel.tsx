// related artists panel — phase 13h.
//
// renders the cross-source related-artist index for a single artist.
// rows arrive from /api/related-artists/list and are pre-enriched with
// `in_library: bool`. the panel groups them into:
//
//   * "in your library" — `related_artist_id` is set; clicking jumps to
//     the local artist (TODO: wire when artist detail route lands).
//   * "external" — no local match; we surface bandcamp/discogs/spotify
//     deep links from `external_urls` plus the source's own page if
//     present, and show source pills (lastfm / audiodb / mb).
//
// the panel auto-fetches on mount and on artistId change. errors are
// surfaced inline (no toast) — this is a secondary panel and we don't
// want to spam the user when artists have no related rows yet.

import { createResource, createMemo, For, Show } from "solid-js";
import { Icon } from "../icons/registry";
import { getCurrentRemote } from "../../music/data";
import { getClientForRemote } from "../../app/api/client";

interface ArtistRelatedPanelProps {
  artistId: string | undefined;
}

interface RelatedRow {
  id: string;
  related_name: string;
  related_artist_id?: string | null;
  related_mbid?: string | null;
  source: string;
  match_score?: number | null;
  bandcamp_url?: string | null;
  bandcamp_albums: { title: string; url: string }[];
  image_url?: string | null;
  external_urls: { name: string; url: string }[];
  in_library: boolean;
}

async function fetchRelated(artistId: string | undefined): Promise<RelatedRow[]> {
  if (!artistId) return [];
  const remote = getCurrentRemote();
  if (!remote) return [];
  const client = await getClientForRemote(remote);
  const resp = await client.music.listRelatedArtists({ artist_id: artistId });
  if (!resp.success) {
    throw new Error(resp.error.message || "failed to load related artists");
  }
  return (resp.data?.items ?? []) as RelatedRow[];
}

export function ArtistRelatedPanel(props: ArtistRelatedPanelProps) {
  const [data, { refetch }] = createResource(() => props.artistId, fetchRelated);

  const rows = createMemo<RelatedRow[]>(() => data() ?? []);
  const inLibrary = createMemo(() => rows().filter((r) => r.in_library));
  const external = createMemo(() => rows().filter((r) => !r.in_library));

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <label class="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          related artists ({rows().length})
        </label>
        <button
          type="button"
          class="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
          disabled={!props.artistId || data.loading}
          onClick={() => void refetch()}
        >
          {data.loading ? "loading…" : "refresh"}
        </button>
      </div>

      <Show when={data.error}>
        <div class="text-xs text-red-500 italic">
          {(data.error as Error)?.message ?? "failed to load"}
        </div>
      </Show>

      <Show when={!data.loading && rows().length === 0 && !data.error}>
        <div class="text-xs text-[var(--color-text-muted)] italic">
          no related artists yet — they get harvested as last.fm / theaudiodb enrichment jobs run
          for this artist's albums.
        </div>
      </Show>

      <Show when={inLibrary().length > 0}>
        <div class="space-y-1.5">
          <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            in your library ({inLibrary().length})
          </div>
          <ul class="flex flex-col gap-1">
            <For each={inLibrary()}>{(r) => <RelatedRowCard row={r} />}</For>
          </ul>
        </div>
      </Show>

      <Show when={external().length > 0}>
        <div class="space-y-1.5">
          <div class="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
            external ({external().length})
          </div>
          <ul class="flex flex-col gap-1">
            <For each={external()}>{(r) => <RelatedRowCard row={r} />}</For>
          </ul>
        </div>
      </Show>
    </div>
  );
}

function RelatedRowCard(props: { row: RelatedRow }) {
  const r = props.row;
  return (
    <li class="flex items-center gap-2 text-xs px-2 py-1.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)]">
      <Show when={r.in_library} fallback={<Icon name="user" size={12} />}>
        <Icon name="check" size={12} />
      </Show>
      <span class="font-medium text-[var(--color-text-primary)] truncate">{r.related_name}</span>
      <SourcePill source={r.source} />
      <Show when={typeof r.match_score === "number"}>
        <span
          class="text-[10px] text-[var(--color-text-muted)]"
          title="similarity score from source"
        >
          {(r.match_score ?? 0).toFixed(2)}
        </span>
      </Show>
      <div class="ml-auto flex items-center gap-1.5">
        <Show when={r.bandcamp_url}>
          <ExternalPill href={r.bandcamp_url!} label="bandcamp" />
        </Show>
        <For each={r.external_urls}>{(u) => <ExternalPill href={u.url} label={u.name} />}</For>
      </div>
    </li>
  );
}

function SourcePill(props: { source: string }) {
  return (
    <span
      class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
      title={`harvested from ${props.source}`}
    >
      {props.source}
    </span>
  );
}

function ExternalPill(props: { href: string; label: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
    >
      {props.label}
    </a>
  );
}

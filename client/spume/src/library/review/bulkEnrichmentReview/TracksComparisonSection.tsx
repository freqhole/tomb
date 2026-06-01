import { For, Show, type Resource } from "solid-js";
import {
  MusicBrainzTrackComparison,
  type ComparisonSong,
} from "../../../components/musicbrainz/MusicBrainzTrackComparison";
import type { MbReleaseDetail } from "../../../music/data/types";
import { parseAlbumMetadata, type MbCandidate } from "../../data/albumMetadata";
import type { Remote } from "../../../app/services/storage/schemas/remote";

export type MergedCandidate = MbCandidate & {
  via: "mb" | "lastfm" | "audiodb";
};

// merge the canonical mb candidate list with any release-group mbids
// lastfm / audiodb may have surfaced separately. each entry gets a
// `via` field so the picker can render a small badge when a candidate
// isn't already in the mb list. last.fm `mbid` on an album record is
// the release-group mbid in most cases (lastfm doesn't distinguish
// strongly).
export function buildMergedCandidates(
  metadataRaw: string | null,
  title: string,
  artistName: string
): MergedCandidate[] {
  const meta = parseAlbumMetadata(metadataRaw);
  const out: MergedCandidate[] = [];
  const seenReleaseIds = new Set<string>();
  const seenRgIds = new Set<string>();
  for (const c of meta.musicbrainz?.candidates ?? []) {
    out.push({ ...c, via: "mb" });
    if (c.release_id) seenReleaseIds.add(c.release_id);
    if (c.release_group_id) seenRgIds.add(c.release_group_id);
  }
  const lf = meta.lastfm?.album as { mbid?: string | null } | undefined;
  if (lf?.mbid && !seenRgIds.has(lf.mbid) && !seenReleaseIds.has(lf.mbid)) {
    out.push({
      release_id: null,
      release_group_id: lf.mbid,
      title,
      artist: artistName,
      secondary_types: [],
      local_confidence: null,
      first_release_date: null,
      country: null,
      media: null,
      via: "lastfm",
    } as MergedCandidate);
    seenRgIds.add(lf.mbid);
  }
  const ad = meta.audiodb?.album as { musicbrainz_release_group_id?: string | null } | undefined;
  if (ad?.musicbrainz_release_group_id && !seenRgIds.has(ad.musicbrainz_release_group_id)) {
    out.push({
      release_id: null,
      release_group_id: ad.musicbrainz_release_group_id,
      title,
      artist: artistName,
      secondary_types: [],
      local_confidence: null,
      first_release_date: null,
      country: null,
      media: null,
      via: "audiodb",
    } as MergedCandidate);
    seenRgIds.add(ad.musicbrainz_release_group_id);
  }
  return out;
}

export function TracksComparisonSection(props: {
  songs: ComparisonSong[];
  mergedCandidates: MergedCandidate[];
  compareReleaseId: string | null;
  setCompareReleaseId: (id: string | null) => void;
  compareReleaseDetail: Resource<MbReleaseDetail | null>;
  remote: Remote;
  onAlbumUpdated: () => void;
}) {
  return (
    <Show when={(props.songs ?? []).length > 0}>
      <div class="flex flex-col gap-2 p-2 rounded border border-[var(--color-border-subtle)]">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
            tracks ({(props.songs ?? []).length})
          </span>
          <Show when={props.mergedCandidates.filter((c) => !!c.release_id).length > 0}>
            <label class="flex items-center gap-2 text-xs">
              <span class="text-[var(--color-text-muted)]">compare to release</span>
              <select
                value={props.compareReleaseId ?? ""}
                onChange={(e) => props.setCompareReleaseId(e.currentTarget.value || null)}
                class="px-2 py-0.5 text-xs bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded text-[var(--color-text-primary)] max-w-[28rem] truncate"
              >
                <option value="">— none (local tracks only) —</option>
                <For each={props.mergedCandidates.filter((c) => !!c.release_id)}>
                  {(c) => (
                    <option value={c.release_id!}>
                      {(c.title || "(untitled)") +
                        (c.first_release_date ? ` · ${c.first_release_date}` : "") +
                        (c.country ? ` · ${c.country}` : "") +
                        (c.track_count != null
                          ? ` · ${c.track_count} track${c.track_count === 1 ? "" : "s"}`
                          : "") +
                        (c.via !== "mb" ? ` · via ${c.via}` : "")}
                    </option>
                  )}
                </For>
              </select>
            </label>
          </Show>
        </div>
        <Show
          when={props.compareReleaseId}
          fallback={
            <ul class="flex flex-col gap-0.5 text-xs text-[var(--color-text-secondary)] max-h-72 overflow-y-auto">
              <For each={props.songs ?? []}>
                {(s) => (
                  <li class="flex items-baseline gap-2 px-1 py-0.5">
                    <span class="text-[var(--color-text-muted)] tabular-nums w-12 flex-shrink-0">
                      {s.disc_number > 1 ? `${s.disc_number}.` : ""}
                      {s.track_number || "—"}
                    </span>
                    <span class="flex-1 min-w-0 truncate text-[var(--color-text-primary)]">
                      {s.title || "(untitled)"}
                      <Show when={s.track_artist}>
                        <span class="text-[var(--color-text-muted)]"> — {s.track_artist}</span>
                      </Show>
                    </span>
                    <Show when={s.duration_seconds > 0}>
                      <span class="text-[var(--color-text-muted)] tabular-nums flex-shrink-0">
                        {Math.floor(s.duration_seconds / 60)}:
                        {String(Math.floor(s.duration_seconds % 60)).padStart(2, "0")}
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          }
        >
          <Show
            when={!props.compareReleaseDetail.loading && props.compareReleaseDetail()}
            fallback={
              <div class="text-xs text-[var(--color-text-disabled)] italic">
                loading release details…
              </div>
            }
          >
            <MusicBrainzTrackComparison
              release={props.compareReleaseDetail()!}
              songs={props.songs ?? []}
              remote={props.remote}
              onAlbumUpdated={props.onAlbumUpdated}
            />
          </Show>
        </Show>
      </div>
    </Show>
  );
}

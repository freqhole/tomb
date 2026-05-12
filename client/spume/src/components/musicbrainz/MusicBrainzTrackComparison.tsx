// MusicBrainzTrackComparison
//
// reusable side-by-side track-comparison ui that pairs freqhole songs
// against the tracks of a single musicbrainz release detail. extracted
// from `MusicBrainzPanel` so the same ui can be embedded in other
// flows (e.g. the bulk enrichment review modal).
//
// owns its own match-mode state (position vs fuzzy) and manual
// per-song overrides, and calls `getDataSource().updateSong` directly
// for individual / bulk track updates. the parent is notified via
// `onAlbumUpdated` after any successful write.

import { createMemo, createSignal, For, Show } from "solid-js";
import type { Song } from "../../music/services/storage/types";
import { getDataSource } from "../../music/data";
import type { MbArtistCredit, MbReleaseDetail, MbTrack } from "../../music/data/types";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { getClientForRemote } from "../../app/api/client";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { formatDuration } from "../../utils/formatDuration";
import { error as errorLog } from "../../utils/logger";
import { computeFuzzyMatches, detectMismatch } from "./fuzzyTrackMatch";

export interface TrackMatch {
  discNumber: number;
  trackNumber: number;
  mbTrack: MbTrack | null;
  fhSong: Song | null;
}

export interface MusicBrainzTrackComparisonProps {
  /** the resolved mb release whose tracks we compare against. */
  release: MbReleaseDetail;
  /** local freqhole songs for the album we're reviewing. */
  songs: Song[];
  /** optional remote — when set, songs are updated against this
   *  specific remote (multi-remote views). when omitted, we fall back
   *  to `getDataSource()` (single-remote / album-editor flow). */
  remote?: Remote;
  /** invoked after any successful song update so the parent can
   *  refetch / invalidate caches. */
  onAlbumUpdated: () => void;
}

function formatArtistCredit(credits?: MbArtistCredit[]): string {
  if (!credits || credits.length === 0) return "unknown artist";
  return credits.map((c) => c.name + (c.joinphrase || "")).join("");
}

export function MusicBrainzTrackComparison(props: MusicBrainzTrackComparisonProps) {
  const [matchMode, setMatchMode] = createSignal<"position" | "fuzzy">("position");
  const [manualOverrides, setManualOverrides] = createSignal<Map<string, string>>(new Map());
  const [updatingSongId, setUpdatingSongId] = createSignal<string | null>(null);
  const [updatingAllSongs, setUpdatingAllSongs] = createSignal(false);

  // flat list of all MB tracks with disc info attached
  const allMbTracks = createMemo((): (MbTrack & { _disc: number })[] => {
    const tracks: (MbTrack & { _disc: number })[] = [];
    for (const medium of props.release.media) {
      const disc = medium.position || 1;
      for (const track of medium.tracks) {
        tracks.push({ ...track, _disc: disc });
      }
    }
    return tracks;
  });

  const mbTrackByKey = createMemo(() => {
    const map = new Map<string, MbTrack & { _disc: number }>();
    for (const t of allMbTracks()) {
      map.set(`${t._disc}:${t.position}`, t);
    }
    return map;
  });

  const positionMatches = createMemo((): TrackMatch[] => {
    const songs = props.songs;
    const songsByKey = new Map<string, Song[]>();
    for (const s of songs) {
      const key = `${s.disc_number || 1}:${s.track_number || 0}`;
      const arr = songsByKey.get(key) || [];
      arr.push(s);
      songsByKey.set(key, arr);
    }
    const mbMap = mbTrackByKey();
    const allKeys = new Set([...songsByKey.keys(), ...mbMap.keys()]);
    const matches: TrackMatch[] = [];
    for (const key of allKeys) {
      const [d, t] = key.split(":").map(Number);
      const songsForKey = songsByKey.get(key) || [];
      const mbTrack = mbMap.get(key) || null;
      if (songsForKey.length === 0) {
        matches.push({ discNumber: d, trackNumber: t, mbTrack, fhSong: null });
      } else {
        matches.push({ discNumber: d, trackNumber: t, mbTrack, fhSong: songsForKey[0] });
        for (let i = 1; i < songsForKey.length; i++) {
          matches.push({ discNumber: d, trackNumber: t, mbTrack: null, fhSong: songsForKey[i] });
        }
      }
    }
    matches.sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
    return matches;
  });

  const fuzzyMatches = createMemo((): TrackMatch[] => {
    const mbTracks = allMbTracks();
    const songs = props.songs;
    if (songs.length === 0 || mbTracks.length === 0) {
      return songs.map((s) => ({
        discNumber: s.disc_number || 1,
        trackNumber: s.track_number || 0,
        mbTrack: null,
        fhSong: s,
      }));
    }
    const localCandidates = songs.map((s) => ({
      id: s.id,
      title: s.title || "",
      durationMs: (s.duration_seconds || 0) * 1000,
    }));
    const mbCandidates = mbTracks.map((t) => ({
      id: `${t._disc}:${t.position}`,
      title: t.title || "",
      durationMs: t.length_ms || 0,
    }));
    const results = computeFuzzyMatches(localCandidates, mbCandidates);
    return results.map((r) => {
      const song = songs[r.localIndex];
      const mbTrack = r.mbIndex !== null ? mbTracks[r.mbIndex] : null;
      return {
        discNumber: song.disc_number || 1,
        trackNumber: song.track_number || 0,
        mbTrack,
        fhSong: song,
      };
    });
  });

  const shouldShowFuzzyButton = createMemo(() => {
    const posPairs = positionMatches()
      .filter((m) => m.fhSong)
      .map((m) => ({
        localId: m.fhSong!.id,
        mbId: m.mbTrack
          ? `${(m.mbTrack as any)._disc || m.discNumber}:${m.mbTrack.position}`
          : null,
      }));
    const fuzzyPairs = fuzzyMatches().map((m) => ({
      localId: m.fhSong!.id,
      mbId: m.mbTrack ? `${(m.mbTrack as any)._disc}:${m.mbTrack.position}` : null,
    }));
    return detectMismatch(posPairs, fuzzyPairs);
  });

  const applyOverrides = (base: TrackMatch[]): TrackMatch[] => {
    const overrides = manualOverrides();
    if (overrides.size === 0) return base;
    return base.map((m) => {
      if (!m.fhSong) return m;
      const overrideKey = overrides.get(m.fhSong.id);
      if (overrideKey === undefined) return m;
      if (overrideKey === "") return { ...m, mbTrack: null };
      const overriddenTrack = mbTrackByKey().get(overrideKey) || null;
      return { ...m, mbTrack: overriddenTrack };
    });
  };

  const trackMatches = createMemo((): TrackMatch[] => {
    const mode = matchMode();
    const base = mode === "fuzzy" ? fuzzyMatches() : positionMatches();
    return applyOverrides(base);
  });

  const matchedCount = createMemo(() => trackMatches().filter((m) => m.mbTrack && m.fhSong).length);

  // dispatch a single song update via either the explicit remote (when
  // provided) or the global data source. on the remote path we hit
  // `updateSongs` directly with the canonical api shape; the data
  // source path translates into its own internal call.
  const updateOneSong = async (
    songId: string,
    title: string | null,
    trackNumber: number | null,
    discNumber: number | null,
    trackArtist: string | null
  ) => {
    if (props.remote) {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.updateSongs({
        song_ids: [songId],
        title,
        track_number: trackNumber,
        disc_number: discNumber,
        track_artist: trackArtist,
      } as any);
      if (!resp.success) {
        throw new Error(resp.error?.message ?? "updateSongs failed");
      }
      return;
    }
    const dataSource = getDataSource();
    if (!dataSource.updateSong) {
      throw new Error("song update not available");
    }
    await dataSource.updateSong({
      song_ids: [songId],
      title,
      track_number: trackNumber,
      disc_number: discNumber,
      track_artist: trackArtist,
    });
  };

  const handleUpdateSong = async (match: TrackMatch) => {
    if (!match.mbTrack || !match.fhSong) return;
    setUpdatingSongId(match.fhSong.id);
    try {
      const mbTrack = match.mbTrack;
      const trackArtist = formatArtistCredit(mbTrack.artist_credit);
      const releaseArtist = formatArtistCredit(props.release.artist_credit);
      const trackArtistValue =
        trackArtist !== "unknown artist" &&
        trackArtist.toLowerCase() !== releaseArtist.toLowerCase()
          ? trackArtist
          : null;
      await updateOneSong(
        match.fhSong.id,
        mbTrack.title || null,
        mbTrack.position ?? null,
        (mbTrack as any)._disc ?? match.discNumber ?? null,
        trackArtistValue
      );
      props.onAlbumUpdated();
    } catch (err) {
      errorLog("failed to update song:", err);
      toast.error(`failed to update song: ${(err as Error).message}`);
    } finally {
      setUpdatingSongId(null);
    }
  };

  const handleUpdateAllSongs = async () => {
    const matches = trackMatches().filter((m) => m.mbTrack && m.fhSong);
    if (matches.length === 0) {
      toast.info("no matched tracks to update");
      return;
    }
    setUpdatingAllSongs(true);
    let updated = 0;
    try {
      for (const m of matches) {
        if (!m.mbTrack || !m.fhSong) continue;
        const trackArtist = formatArtistCredit(m.mbTrack.artist_credit);
        const releaseArtist = formatArtistCredit(props.release.artist_credit);
        const trackArtistValue =
          trackArtist !== "unknown artist" &&
          trackArtist.toLowerCase() !== releaseArtist.toLowerCase()
            ? trackArtist
            : null;
        try {
          await updateOneSong(
            m.fhSong.id,
            m.mbTrack.title || null,
            m.mbTrack.position ?? null,
            (m.mbTrack as any)._disc ?? m.discNumber ?? null,
            trackArtistValue
          );
          updated += 1;
        } catch (err) {
          errorLog("failed to update song", m.fhSong?.id, err);
        }
      }
      if (updated > 0) {
        toast.success(
          updated === matches.length
            ? `updated ${updated} song${updated === 1 ? "" : "s"}`
            : `updated ${updated} of ${matches.length} songs`
        );
        props.onAlbumUpdated();
      } else {
        toast.error("failed to update any songs");
      }
    } finally {
      setUpdatingAllSongs(false);
    }
  };

  return (
    <div>
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <div class="text-xs font-medium text-[var(--color-text-secondary)]">
            track comparison ({matchedCount()} of {trackMatches().length} matched)
          </div>
          <Show when={shouldShowFuzzyButton() || matchMode() === "fuzzy"}>
            <button
              onClick={() => {
                const next = matchMode() === "fuzzy" ? "position" : "fuzzy";
                setMatchMode(next);
                setManualOverrides(new Map());
              }}
              title="match tracks by title and duration similarity instead of track number position — useful when local track numbers are incorrect"
              class="text-[10px] px-2 py-0.5 rounded-full transition-colors"
              classList={{
                "bg-[var(--color-accent-500)] text-white": matchMode() === "fuzzy",
                "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]":
                  matchMode() !== "fuzzy",
              }}
            >
              smart match
            </button>
          </Show>
        </div>
        <Show when={matchedCount() > 0}>
          <Button onClick={handleUpdateAllSongs} variant="secondary" disabled={updatingAllSongs()}>
            {updatingAllSongs()
              ? "updating..."
              : matchedCount() === 1
                ? "update 1 song"
                : `update all ${matchedCount()} songs`}
          </Button>
        </Show>
      </div>

      <div class="grid grid-cols-[auto_1fr_1fr_auto] gap-x-2 text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wide mb-1 px-1">
        <span class="w-8 text-right">#</span>
        <span>freqhole</span>
        <span>musicbrainz</span>
        <span class="w-16"></span>
      </div>

      <div class="space-y-0.5">
        <For each={trackMatches()}>
          {(match) => {
            const hasBoth = () => !!match.mbTrack && !!match.fhSong;
            const titleDiffers = () =>
              hasBoth() && match.mbTrack!.title.toLowerCase() !== match.fhSong!.title.toLowerCase();
            const isUpdating = () => updatingSongId() === match.fhSong?.id;
            const isFuzzy = () => matchMode() === "fuzzy";
            const currentMbKey = () => {
              if (!match.mbTrack) return "";
              return `${(match.mbTrack as any)._disc || match.discNumber}:${match.mbTrack.position}`;
            };
            return (
              <div
                class="grid grid-cols-[auto_1fr_1fr_auto] gap-x-2 px-1 py-1 text-xs rounded"
                classList={{
                  "bg-[var(--color-bg-elevated)]": hasBoth() && !titleDiffers(),
                  "bg-yellow-500/10": titleDiffers(),
                  "bg-red-500/10": !hasBoth(),
                }}
              >
                <span class="text-[var(--color-text-tertiary)] w-8 text-right flex-shrink-0">
                  <Show when={(props.release.media?.length || 0) > 1}>
                    <span class="text-[var(--color-text-tertiary)] opacity-50">
                      {match.discNumber}.
                    </span>
                  </Show>
                  {match.trackNumber}
                </span>

                <div class="min-w-0">
                  <Show
                    when={match.fhSong}
                    fallback={
                      <span class="text-[var(--color-text-tertiary)] italic">no local song</span>
                    }
                  >
                    <div class="flex items-baseline gap-1">
                      <span
                        class="text-[var(--color-text-primary)] truncate min-w-0"
                        classList={{ "line-through opacity-50": titleDiffers() }}
                      >
                        {match.fhSong!.title}
                      </span>
                      <span class="text-[var(--color-text-tertiary)] flex-shrink-0">
                        {formatDuration(match.fhSong!.duration_seconds)}
                      </span>
                    </div>
                    <Show when={match.fhSong!.track_artist}>
                      <div class="text-[10px] text-[var(--color-text-tertiary)] truncate">
                        {match.fhSong!.track_artist}
                      </div>
                    </Show>
                  </Show>
                </div>

                <div class="min-w-0">
                  <Show
                    when={isFuzzy()}
                    fallback={
                      <div>
                        <Show
                          when={match.mbTrack}
                          fallback={
                            <span class="text-[var(--color-text-tertiary)] italic">
                              no MB track
                            </span>
                          }
                        >
                          <div class="flex items-baseline gap-1">
                            <span class="text-[var(--color-text-primary)] truncate min-w-0">
                              {match.mbTrack!.title}
                            </span>
                            <Show when={match.mbTrack!.length_ms}>
                              <span class="text-[var(--color-text-tertiary)] flex-shrink-0">
                                {formatDuration(Math.round(match.mbTrack!.length_ms! / 1000))}
                              </span>
                            </Show>
                          </div>
                          <Show when={match.mbTrack!.artist_credit?.length}>
                            <div class="text-[10px] text-[var(--color-text-tertiary)] truncate">
                              {formatArtistCredit(match.mbTrack!.artist_credit)}
                            </div>
                          </Show>
                        </Show>
                      </div>
                    }
                  >
                    <select
                      value={currentMbKey()}
                      onChange={(e) => {
                        if (!match.fhSong) return;
                        const val = e.currentTarget.value;
                        setManualOverrides((prev) => {
                          const next = new Map(prev);
                          next.set(match.fhSong!.id, val);
                          return next;
                        });
                      }}
                      class="w-full text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded px-1 py-0.5 text-[var(--color-text-primary)] outline-none truncate"
                    >
                      <option value="">— unmatched —</option>
                      <For each={allMbTracks()}>
                        {(t) => {
                          const key = `${t._disc}:${t.position}`;
                          const durStr = t.length_ms
                            ? ` (${formatDuration(Math.round(t.length_ms / 1000))})`
                            : "";
                          const discPrefix =
                            (props.release.media?.length || 0) > 1 ? `${t._disc}.` : "";
                          return (
                            <option value={key}>
                              {discPrefix}
                              {t.position}. {t.title}
                              {durStr}
                            </option>
                          );
                        }}
                      </For>
                    </select>
                  </Show>
                </div>

                <div class="w-16 flex items-center justify-end">
                  <Show when={hasBoth()}>
                    <button
                      onClick={() => handleUpdateSong(match)}
                      disabled={isUpdating() || updatingAllSongs()}
                      class="text-[10px] text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] disabled:opacity-30 disabled:cursor-default"
                    >
                      {isUpdating() ? "..." : "update"}
                    </button>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

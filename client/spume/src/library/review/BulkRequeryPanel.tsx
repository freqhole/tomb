// BulkRequeryPanel — phase 11.x.
//
// inline panel rendered at the top of `BulkEnrichmentReviewModal` so
// the user can:
//   1. see the album's artist + title (editable).
//   2. re-query musicbrainz / last.fm / audiodb individually — or all
//      three at once — with the edited values as overrides.
//   3. (collapsed by default) browse the stored MB candidate list and
//      pick a different release as the confirmed match. mirrors what
//      the album-editor MB tab does, just inline.
//
// keeps state local — parent owns nothing here. on successful requery
// or candidate-confirm we just toast + the modal's existing
// proposal/progress polling will pick up the new snapshots on the
// next tick.

import { For, Show, createMemo, createSignal } from "solid-js";
import { toast } from "../../components/feedback/Toast";
import { getClientForRemote } from "../../app/api/client";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { parseAlbumMetadata, type MbCandidate } from "../data/albumMetadata";
import {
  registerInflightJob,
  useInflightJobs,
  type EnrichmentSource,
} from "../hooks/useMbLookupJobs";

// note: edits made here are saved by the parent modal on "save & next"
// via `updateAlbum`. confirming an mb candidate also persists
// immediately on the server side.

const MB_RELEASE_BASE = "https://musicbrainz.org/release";
const MB_RELEASE_GROUP_BASE = "https://musicbrainz.org/release-group";

export interface BulkRequeryPanelProps {
  albumId: string;
  remote: Remote;
  /** raw album.metadata json string (so we can read mb candidates +
   *  the currently-confirmed release_group_id without re-fetching). */
  metadataRaw: string | null | undefined;
  /** initial values used for the dirty-tracking baseline. */
  initialArtist: string;
  initialTitle: string;
  /** controlled values: parent owns the signal so it can persist on
   *  save and pass overrides into the requery call. */
  artist: string;
  title: string;
  onArtistChange: (v: string) => void;
  onTitleChange: (v: string) => void;
  /** called after a successful confirm/requery so the parent modal can
   *  refresh proposal panels + re-fetch the album row without waiting
   *  for the next poll tick. */
  onChanged?: () => void;
}

type Source = EnrichmentSource;
const SOURCES: Source[] = ["mb", "lastfm", "audiodb"];

function sourceLabel(s: Source): string {
  switch (s) {
    case "mb":
      return "musicbrainz";
    case "lastfm":
      return "last.fm";
    case "audiodb":
      return "audiodb";
  }
}

function sourceServerTag(s: Source): "Mb" | "Lastfm" | "Audiodb" {
  switch (s) {
    case "mb":
      return "Mb";
    case "lastfm":
      return "Lastfm";
    case "audiodb":
      return "Audiodb";
  }
}

export function BulkRequeryPanel(props: BulkRequeryPanelProps) {
  const artist = () => props.artist;
  const title = () => props.title;
  const setArtist = (v: string) => props.onArtistChange(v);
  const setTitle = (v: string) => props.onTitleChange(v);
  const [busy, setBusy] = createSignal<Set<Source>>(new Set());
  const [showCandidates, setShowCandidates] = createSignal(false);
  const [confirmingKey, setConfirmingKey] = createSignal<string | null>(null);

  const meta = createMemo(() => parseAlbumMetadata(props.metadataRaw ?? null));
  const candidates = createMemo<MbCandidate[]>(() => {
    const list = meta().musicbrainz?.candidates ?? [];
    return [...list].sort((a, b) => (b.local_confidence ?? 0) - (a.local_confidence ?? 0));
  });
  // identity key for a candidate: prefer release_id (precise pressing),
  // fall back to release_group_id when the candidate predates per-release
  // tracking. mirrored on the confirmed side so siblings within the same
  // release group don't all light up as "current".
  const candKey = (c: MbCandidate): string => c.release_id ?? c.release_group_id;
  const confirmedRgId = createMemo(() => meta().musicbrainz?.release_group_id ?? null);
  const confirmedReleaseId = createMemo(() => meta().musicbrainz?.release_id ?? null);
  const confirmedKey = createMemo(() => confirmedReleaseId() ?? confirmedRgId());

  // server-side job tracker — true while the runner is processing a
  // requery for this album+source. used to disable the buttons + show
  // a "working" label so the user can't double-fire and knows progress
  // is happening even though the panel state is local.
  const inflight = useInflightJobs();
  const inflightSources = createMemo<Set<Source>>(() => {
    const out = new Set<Source>();
    for (const e of inflight().values()) {
      if (e.albumId === props.albumId) out.add(e.source);
    }
    return out;
  });
  const isSourceWorking = (s: Source) => busy().has(s) || inflightSources().has(s);
  const anyWorking = createMemo(() => busy().size > 0 || inflightSources().size > 0);

  // edits become "dirty" once they diverge from the initial values; we
  // pass them as overrides on requery whenever they differ, otherwise
  // we send nulls so the server uses the album row's current values.
  const isDirtyArtist = createMemo(() => artist().trim() !== props.initialArtist.trim());
  const isDirtyTitle = createMemo(() => title().trim() !== props.initialTitle.trim());
  const isDirty = createMemo(() => isDirtyArtist() || isDirtyTitle());

  const setBusyFor = (s: Source, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(s);
      else next.delete(s);
      return next;
    });
  };

  const requerySource = async (source: Source) => {
    setBusyFor(source, true);
    try {
      const client = await getClientForRemote(props.remote);
      const a = artist().trim();
      const t = title().trim();
      const overrideArtist = isDirtyArtist() && a.length > 0 ? a : null;
      const overrideTitle = isDirtyTitle() && t.length > 0 ? t : null;
      const resp = await client.music.requeryEnrichment({
        album_id: props.albumId,
        source: sourceServerTag(source) as any,
        override_query: {
          artist: overrideArtist,
          title: overrideTitle,
          mbid: null,
        },
        priority: 10,
      });
      if (!resp.success) {
        toast.error(`${sourceLabel(source)} requery failed: ${resp.error?.message ?? "unknown"}`);
        return;
      }
      // register the returned job_id with the inflight tracker so
      // the buttons stay disabled until the runner actually finishes,
      // not just until the enqueue http call returns.
      const jobId = resp.data?.job_id;
      if (jobId) {
        registerInflightJob(props.remote, source, props.albumId, jobId);
      }
      // no success toast — the panel polls + the row updates inline.
      props.onChanged?.();
    } catch (err) {
      toast.error(`${sourceLabel(source)} requery threw: ${(err as Error).message}`);
    } finally {
      setBusyFor(source, false);
    }
  };

  const requeryAll = async () => {
    await Promise.all(SOURCES.map((s) => requerySource(s)));
  };

  const onConfirmCandidate = async (cand: MbCandidate) => {
    setConfirmingKey(candKey(cand));
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.confirmMbMatch({
        album_id: props.albumId,
        release_group_id: cand.release_group_id,
        release_id: cand.release_id ?? null,
      });
      if (!resp.success) {
        toast.error(`confirm failed: ${resp.error?.message ?? "unknown"}`);
        return;
      }
      // pull the chosen candidate's title + artist into the editable
      // fields so the user gets the mb-canonical names; on save these
      // get persisted via updateAlbum.
      if (cand.title) setTitle(cand.title);
      if (cand.artist) setArtist(cand.artist);
      toast.success("mb match confirmed — detail re-fetch enqueued");
      props.onChanged?.();
    } catch (err) {
      toast.error(`confirm threw: ${(err as Error).message}`);
    } finally {
      setConfirmingKey(null);
    }
  };

  return (
    <div class="flex flex-col gap-2 p-2 rounded border border-[var(--color-border-subtle)]">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
          re-query sources
        </span>
        <Show when={isDirty()}>
          <span class="text-[10px] text-amber-400 italic">
            edited — overrides will be used on requery
          </span>
        </Show>
      </div>

      {/* editable artist + title */}
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-0.5 text-xs">
          <span class="text-[10px] uppercase text-[var(--color-text-disabled)]">artist</span>
          <input
            type="text"
            value={artist()}
            onInput={(e) => setArtist(e.currentTarget.value)}
            class="px-2 py-1 text-sm bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded text-[var(--color-text-primary)]"
            disabled={anyWorking()}
          />
        </label>
        <label class="flex flex-col gap-0.5 text-xs">
          <span class="text-[10px] uppercase text-[var(--color-text-disabled)]">album title</span>
          <input
            type="text"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            class="px-2 py-1 text-sm bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded text-[var(--color-text-primary)]"
            disabled={anyWorking()}
          />
        </label>
      </div>

      {/* requery buttons: per-source + all-at-once */}
      <div class="flex flex-wrap items-center gap-1.5">
        <For each={SOURCES}>
          {(s) => (
            <button
              type="button"
              onClick={() => void requerySource(s)}
              disabled={isSourceWorking(s)}
              class="px-2 py-0.5 text-xs rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
              title={`re-fetch ${sourceLabel(s)} for this album`}
            >
              <Show when={isSourceWorking(s)}>
                <span
                  class="inline-block w-2 h-2 rounded-full bg-[var(--color-accent-500)] animate-pulse"
                  aria-hidden="true"
                />
              </Show>
              <span>
                {isSourceWorking(s) ? `${sourceLabel(s)} working…` : `re-query ${sourceLabel(s)}`}
              </span>
            </button>
          )}
        </For>
        <button
          type="button"
          onClick={() => void requeryAll()}
          disabled={anyWorking()}
          class="px-2 py-0.5 text-xs rounded border border-[var(--color-accent-500)]/40 bg-[var(--color-accent-500)]/10 hover:bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
          title="re-fetch all three sources in parallel"
        >
          {anyWorking() ? "re-querying…" : "re-query all"}
        </button>
      </div>

      {/* mb candidates picker — collapsed by default. */}
      <div class="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setShowCandidates((v) => !v)}
          class="self-start text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer flex items-center gap-1"
        >
          <span>{showCandidates() ? "▾" : "▸"}</span>
          <span>
            musicbrainz candidates ({candidates().length})
            <Show when={confirmedRgId()}>
              {" — current: "}
              <span class="font-mono text-[10px] text-[var(--color-text-disabled)]">
                {confirmedRgId()!.slice(0, 8)}…
              </span>
            </Show>
          </span>
        </button>
        <Show when={showCandidates()}>
          <Show
            when={candidates().length > 0}
            fallback={
              <div class="text-xs text-[var(--color-text-disabled)] italic px-1 py-1">
                no stored candidates — re-query musicbrainz to fetch matches
              </div>
            }
          >
            <ul class="flex flex-col gap-1 max-h-64 overflow-y-auto">
              <For each={candidates()}>
                {(cand, i) => {
                  const isTopRanked = () => i() === 0;
                  const isConfirmed = () => {
                    const ck = confirmedKey();
                    return ck != null && candKey(cand) === ck;
                  };
                  const isSelected = () =>
                    isConfirmed() || (confirmedKey() == null && isTopRanked());
                  const isThisConfirming = () => confirmingKey() === candKey(cand);
                  const mbHref = () =>
                    cand.release_id
                      ? `${MB_RELEASE_BASE}/${cand.release_id}`
                      : `${MB_RELEASE_GROUP_BASE}/${cand.release_group_id}`;
                  const coverCount = () => cand.cover_art_count ?? 0;
                  return (
                    <li
                      onClick={() => {
                        if (isConfirmed() || confirmingKey() != null) return;
                        void onConfirmCandidate(cand);
                      }}
                      class="flex items-start gap-2 px-2 py-1 rounded text-xs border cursor-pointer transition-colors"
                      classList={{
                        // confirmed (server says this is the chosen
                        // pressing): green tint.
                        "bg-emerald-500/10 border-emerald-500/40": isConfirmed(),
                        // top-ranked but not yet confirmed: subtle accent
                        // tint so the user can see the recommended pick.
                        "bg-[var(--color-accent-500)]/5 border-[var(--color-accent-500)]/30":
                          !isConfirmed() && isSelected(),
                        // everything else: plain row.
                        "bg-[var(--color-bg-base)] border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)]":
                          !isSelected(),
                      }}
                      title={
                        isConfirmed()
                          ? "currently confirmed pressing"
                          : "click to use this pressing"
                      }
                    >
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="font-medium truncate">{cand.title ?? "(untitled)"}</span>
                          <Show when={cand.local_confidence != null}>
                            <span
                              class="text-[10px] px-1 rounded font-mono"
                              classList={{
                                "bg-emerald-500/20 text-emerald-300":
                                  (cand.local_confidence ?? 0) >= 0.9,
                                "bg-amber-500/15 text-amber-300":
                                  (cand.local_confidence ?? 0) >= 0.7 &&
                                  (cand.local_confidence ?? 0) < 0.9,
                                "bg-[var(--color-bg-hover)] text-[var(--color-text-disabled)]":
                                  (cand.local_confidence ?? 0) < 0.7,
                              }}
                              title={`local rank score (mb lucene: ${cand.mb_score ?? "?"})`}
                            >
                              {(cand.local_confidence! * 100).toFixed(0)}%
                            </span>
                          </Show>
                          <Show when={isTopRanked()}>
                            <span class="text-[9px] uppercase tracking-wide text-[var(--color-accent-500)]">
                              top rank
                            </span>
                          </Show>
                          <Show when={isConfirmed()}>
                            <span class="text-[9px] uppercase tracking-wide text-emerald-400">
                              confirmed
                            </span>
                          </Show>
                        </div>
                        <div class="text-[11px] text-[var(--color-text-secondary)] truncate">
                          {cand.artist ?? ""}
                          <Show when={cand.first_release_date}>
                            {" · "}
                            {cand.first_release_date}
                          </Show>
                          <Show when={cand.country}>
                            {" · "}
                            {cand.country}
                          </Show>
                          <Show when={cand.media}>
                            {" · "}
                            {cand.media}
                          </Show>
                          <Show when={cand.track_count != null}>
                            {" · "}
                            {cand.track_count}t
                          </Show>
                        </div>
                        <div class="text-[10px] text-[var(--color-text-disabled)] flex items-center gap-2 mt-0.5">
                          <span
                            title={`${coverCount()} cover image${coverCount() === 1 ? "" : "s"} on the mb cover-art archive`}
                          >
                            🖼 {coverCount()}
                            <Show when={cand.has_front_cover}>
                              <span class="ml-0.5 text-emerald-400">·front</span>
                            </Show>
                          </span>
                          <Show when={cand.mb_score != null}>
                            <span title="musicbrainz lucene score (0-100)">mb {cand.mb_score}</span>
                          </Show>
                          <Show when={cand.primary_type}>
                            <span>{cand.primary_type}</span>
                          </Show>
                        </div>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <a
                          href={mbHref()}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          class="text-[10px] text-[var(--color-text-secondary)] hover:underline"
                          title="open in musicbrainz"
                        >
                          mb↗
                        </a>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onConfirmCandidate(cand);
                          }}
                          disabled={isConfirmed() || confirmingKey() != null}
                          class="px-1.5 py-0.5 text-[10px] rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          title={
                            isConfirmed()
                              ? "already confirmed"
                              : "set this as the confirmed mb match (re-fetches detail)"
                          }
                        >
                          {isThisConfirming()
                            ? "confirming…"
                            : isConfirmed()
                              ? "confirmed"
                              : "use this"}
                        </button>
                      </div>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </Show>
      </div>
    </div>
  );
}

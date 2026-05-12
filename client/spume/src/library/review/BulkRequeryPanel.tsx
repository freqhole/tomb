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

type Source = "mb" | "lastfm" | "audiodb";
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
  const [confirmingRgId, setConfirmingRgId] = createSignal<string | null>(null);

  const meta = createMemo(() => parseAlbumMetadata(props.metadataRaw ?? null));
  const candidates = createMemo<MbCandidate[]>(() => {
    const list = meta().musicbrainz?.candidates ?? [];
    return [...list].sort((a, b) => (b.local_confidence ?? 0) - (a.local_confidence ?? 0));
  });
  const confirmedRgId = createMemo(() => meta().musicbrainz?.release_group_id ?? null);

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
    setConfirmingRgId(cand.release_group_id);
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
      setConfirmingRgId(null);
    }
  };

  const anyBusy = createMemo(() => busy().size > 0);

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
            disabled={anyBusy()}
          />
        </label>
        <label class="flex flex-col gap-0.5 text-xs">
          <span class="text-[10px] uppercase text-[var(--color-text-disabled)]">album title</span>
          <input
            type="text"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            class="px-2 py-1 text-sm bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)] rounded text-[var(--color-text-primary)]"
            disabled={anyBusy()}
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
              disabled={busy().has(s)}
              class="px-2 py-0.5 text-xs rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title={`re-fetch ${sourceLabel(s)} for this album`}
            >
              {busy().has(s) ? `${sourceLabel(s)}…` : `re-query ${sourceLabel(s)}`}
            </button>
          )}
        </For>
        <button
          type="button"
          onClick={() => void requeryAll()}
          disabled={anyBusy()}
          class="px-2 py-0.5 text-xs rounded border border-[var(--color-accent-500)]/40 bg-[var(--color-accent-500)]/10 hover:bg-[var(--color-accent-500)]/20 text-[var(--color-text-primary)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
          title="re-fetch all three sources in parallel"
        >
          {anyBusy() ? "re-querying…" : "re-query all"}
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
                {(cand) => {
                  const isConfirmed = () => confirmedRgId() === cand.release_group_id;
                  const isThisConfirming = () => confirmingRgId() === cand.release_group_id;
                  const mbHref = () =>
                    cand.release_id
                      ? `${MB_RELEASE_BASE}/${cand.release_id}`
                      : `${MB_RELEASE_GROUP_BASE}/${cand.release_group_id}`;
                  return (
                    <li
                      class="flex items-start gap-2 px-2 py-1 rounded text-xs border"
                      classList={{
                        "bg-emerald-500/10 border-emerald-500/30": isConfirmed(),
                        "bg-[var(--color-bg-base)] border-[var(--color-border-subtle)]":
                          !isConfirmed(),
                      }}
                    >
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="font-medium truncate">{cand.title ?? "(untitled)"}</span>
                          <Show when={cand.local_confidence != null}>
                            <span class="text-[10px] text-[var(--color-text-disabled)]">
                              {(cand.local_confidence! * 100).toFixed(0)}%
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
                        </div>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <a
                          href={mbHref()}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="text-[10px] text-[var(--color-text-secondary)] hover:underline"
                          title="open in musicbrainz"
                        >
                          mb↗
                        </a>
                        <button
                          type="button"
                          onClick={() => void onConfirmCandidate(cand)}
                          disabled={isConfirmed() || confirmingRgId() != null}
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

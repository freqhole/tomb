// infinite-scrolling track history list for the radio detail panel.
//
// reads pages of `RadioHistoryEntry` from IDB via `radioHistory`. uses
// an intersection-observer sentinel at the bottom to load the next
// page when it scrolls into view. capped at MAX_RADIO_HISTORY rows
// (radioHistory module trims older rows on every write).

import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  clearHistory,
  countHistory,
  getHistoryPage,
  MAX_RADIO_HISTORY,
  radioHistoryVersion,
} from "../../app/services/radio/radioHistory";
import { getClientForRemote } from "../../app/api/client";
import { getRemoteByPeerAddr } from "../../app/services/remotes/remoteManager";
import type { RadioHistoryEntry } from "../../app/services/storage/types";
import { setHighlightedSongId } from "../state/highlightedSong";
import { debug } from "../../utils/logger";

const PAGE_SIZE = 50;

interface RadioHistoryListProps {
  /** optional station filter; pass `null` to show all stations. */
  stationId?: string | null;
}

export function RadioHistoryList(props: RadioHistoryListProps) {
  const navigate = useNavigate();
  const [entries, setEntries] = createSignal<RadioHistoryEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [exhausted, setExhausted] = createSignal(false);
  const [total, setTotal] = createSignal(0);
  const [confirmingClear, setConfirmingClear] = createSignal(false);
  // cache of inline-thumb blob URLs keyed by entry id; revoked on cleanup.
  const thumbUrls = new Map<string, string>();

  const buildThumbUrl = (e: RadioHistoryEntry): string | null => {
    if (!e.art_thumb_b64 || !e.art_thumb_mime) return null;
    const cached = thumbUrls.get(e.id);
    if (cached) return cached;
    try {
      const bin = atob(e.art_thumb_b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes as BlobPart], { type: e.art_thumb_mime });
      const url = URL.createObjectURL(blob);
      thumbUrls.set(e.id, url);
      return url;
    } catch {
      return null;
    }
  };

  const loadFirstPage = async () => {
    setLoading(true);
    try {
      const page = await getHistoryPage({ limit: PAGE_SIZE, stationId: props.stationId });
      setEntries(page);
      setExhausted(page.length < PAGE_SIZE);
      setTotal(await countHistory());
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (loading() || exhausted()) return;
    const tail = entries()[entries().length - 1];
    if (!tail) return;
    setLoading(true);
    try {
      const page = await getHistoryPage({
        before: tail.played_at,
        limit: PAGE_SIZE,
        stationId: props.stationId,
      });
      setEntries((prev) => [...prev, ...page]);
      if (page.length < PAGE_SIZE) setExhausted(true);
    } finally {
      setLoading(false);
    }
  };

  let sentinel: HTMLDivElement | undefined;
  let observer: IntersectionObserver | undefined;
  let hasLoadedFirstPage = false;

  const refreshHeadPage = async () => {
    if (loading()) return;
    setLoading(true);
    try {
      const page = await getHistoryPage({ limit: PAGE_SIZE, stationId: props.stationId });
      setEntries((prev) => {
        if (page.length === 0) return [];
        const merged = [...page];
        const seen = new Set(page.map((row) => row.id));
        for (const row of prev) {
          if (!seen.has(row.id)) merged.push(row);
        }
        return merged;
      });
      setTotal(await countHistory());
      if (page.length === 0) {
        setExhausted(true);
      }
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void loadFirstPage();
    hasLoadedFirstPage = true;
    if (sentinel) {
      observer = new IntersectionObserver(
        (ents) => {
          for (const ent of ents) {
            if (ent.isIntersecting) {
              void loadMore();
            }
          }
        },
        { rootMargin: "200px" }
      );
      observer.observe(sentinel);
    }
  });

  createEffect(() => {
    radioHistoryVersion();
    if (!hasLoadedFirstPage) return;
    void refreshHeadPage();
  });

  onCleanup(() => {
    observer?.disconnect();
    for (const url of thumbUrls.values()) URL.revokeObjectURL(url);
    thumbUrls.clear();
  });

  const handleClear = async () => {
    if (!confirmingClear()) {
      setConfirmingClear(true);
      // reset confirmation after a few seconds.
      setTimeout(() => setConfirmingClear(false), 4000);
      return;
    }
    await clearHistory();
    setConfirmingClear(false);
    setEntries([]);
    setExhausted(true);
    setTotal(0);
    for (const url of thumbUrls.values()) URL.revokeObjectURL(url);
    thumbUrls.clear();
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const resolveRemoteSongTargets = async (
    e: RadioHistoryEntry
  ): Promise<{
    remoteId: string;
    albumId?: string;
    artistId?: string;
  } | null> => {
    if (!e.peer_addr) return null;
    const remote = await getRemoteByPeerAddr(e.peer_addr);
    if (!remote) return null;

    const base = { remoteId: remote.remote_id };
    if (!e.song_id) return base;

    try {
      const client = await getClientForRemote(remote);
      const result = await client.music.querySongs({
        q: null,
        search_fields: null,
        filters: { song_ids: [e.song_id] },
        sort_by: null,
        sort_direction: null,
        limit: 1,
        offset: null,
        user_id: null,
        favorites_only: null,
        min_rating: null,
      });
      if (!result.success || result.data.items.length === 0) {
        return base;
      }
      const first = result.data.items[0];
      return {
        ...base,
        albumId: first.album?.id ?? undefined,
        artistId: first.artist?.id ?? undefined,
      };
    } catch (err) {
      debug("radio-history", "failed to resolve remote song targets:", err);
      return base;
    }
  };

  const openSongView = async (e: RadioHistoryEntry) => {
    if (!e.song_id) return;
    const targets = await resolveRemoteSongTargets(e);
    if (!targets?.remoteId || !targets.albumId) return;
    setHighlightedSongId(e.song_id);
    navigate(
      `/${targets.remoteId}/albums/${encodeURIComponent(targets.albumId)}?song_id=${encodeURIComponent(e.song_id)}`
    );
  };

  const openArtistView = async (e: RadioHistoryEntry) => {
    const targets = await resolveRemoteSongTargets(e);
    if (!targets?.remoteId || !targets.artistId) return;
    navigate(`/${targets.remoteId}/artists/${encodeURIComponent(targets.artistId)}`);
  };

  return (
    <div class="flex flex-col gap-2 w-full">
      <header class="flex items-center justify-between px-1">
        <div class="text-xs uppercase tracking-wide text-neutral-500">
          history
          <Show when={total() > 0}>
            <span class="ml-2 text-neutral-600 normal-case">
              {total()} of {MAX_RADIO_HISTORY}
            </span>
          </Show>
        </div>
        <Show when={entries().length > 0}>
          <button
            class="text-xs px-2 py-0.5 rounded border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800"
            classList={{ "border-red-600 text-red-400": confirmingClear() }}
            onClick={handleClear}
          >
            {confirmingClear() ? "click again to confirm" : "clear"}
          </button>
        </Show>
      </header>

      <Show
        when={entries().length > 0}
        fallback={
          <div class="text-sm text-neutral-500 px-1 py-4">
            <Show when={!loading()} fallback={<span>loading…</span>}>
              no history yet — tune into a station to start tracking what plays.
            </Show>
          </div>
        }
      >
        <ul class="flex flex-col gap-1">
          <For each={entries()}>
            {(e) => {
              const thumb = buildThumbUrl(e);
              return (
                <li class="flex items-center gap-3 p-2 rounded hover:bg-neutral-900/50">
                  <div class="flex-shrink-0 w-10 h-10 rounded bg-gradient-to-br from-purple-700 to-indigo-900 flex items-center justify-center overflow-hidden">
                    <Show
                      when={thumb}
                      fallback={
                        <span class="text-[8px] font-bold tracking-widest opacity-60 text-white">
                          radio
                        </span>
                      }
                    >
                      <img src={thumb!} alt="" class="w-full h-full object-cover" />
                    </Show>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div
                      class="text-sm truncate"
                      classList={{
                        "cursor-pointer hover:underline decoration-[1px] underline-offset-2":
                          !!e.song_id,
                      }}
                      onClick={() => {
                        void openSongView(e);
                      }}
                      title={e.song_id ? "open album" : undefined}
                    >
                      {e.title}
                    </div>
                    <div class="text-xs text-neutral-400 truncate">
                      <span
                        classList={{
                          "cursor-pointer hover:underline decoration-[1px] underline-offset-2":
                            !!e.song_id,
                        }}
                        onClick={() => {
                          void openArtistView(e);
                        }}
                        title={e.song_id ? "open artist" : undefined}
                      >
                        {e.artist ?? "unknown artist"}
                      </span>
                      <Show when={e.album}> — {e.album}</Show>
                    </div>
                  </div>
                  <div class="flex-shrink-0 text-xs text-neutral-500 text-right">
                    <div>{formatTime(e.played_at)}</div>
                    <Show when={e.station_name}>
                      <div class="truncate max-w-[8rem]">{e.station_name}</div>
                    </Show>
                  </div>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>

      {/* sentinel for infinite-scroll. height>0 so it's observable. */}
      <div ref={sentinel} class="h-4 w-full" aria-hidden="true">
        <Show when={loading() && entries().length > 0}>
          <div class="text-xs text-neutral-500 text-center">loading…</div>
        </Show>
      </div>
    </div>
  );
}

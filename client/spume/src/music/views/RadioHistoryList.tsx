// infinite-scrolling track history list for the radio detail panel.
//
// reads pages of `RadioHistoryEntry` from IDB via `radioHistory`. uses
// an intersection-observer sentinel at the bottom to load the next
// page when it scrolls into view. capped at MAX_RADIO_HISTORY rows
// (radioHistory module trims older rows on every write).

import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  clearHistory,
  countHistory,
  getHistoryPage,
  MAX_RADIO_HISTORY,
} from "../../app/services/radio/radioHistory";
import type { RadioHistoryEntry } from "../../app/services/storage/types";

const PAGE_SIZE = 50;

interface RadioHistoryListProps {
  /** optional station filter; pass `null` to show all stations. */
  stationId?: string | null;
}

export function RadioHistoryList(props: RadioHistoryListProps) {
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

  onMount(() => {
    void loadFirstPage();
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
                    <div class="text-sm truncate">{e.title}</div>
                    <div class="text-xs text-neutral-400 truncate">
                      {e.artist ?? "unknown artist"}
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

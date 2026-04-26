// /radio root view (two-column layout).
//
// left column: discovered station list (rows with thumb, name, listener
// count). selecting a station tunes the audio service into it and
// surfaces detail in the right column. groups by source label.
//
// right column: tuned-station detail — large art, now-playing meta,
// description, and infinite-scrolling track history (RadioHistoryList).
//
// stop control lives in the player bar (see 2c-iii); this view never
// renders one.

import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { toast } from "../../components/feedback/Toast";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
import { MediaThumbnail } from "../../components/media/MediaThumbnail";
import { ContextMenu, type MenuAction } from "../../components/overlays/ContextMenu";
import { isNarrowViewport } from "../../config/breakpoints";
import {
  discoverStations,
  type DiscoveredStation,
  type SourceRef,
} from "../../app/services/radio/radioDiscovery";
import {
  radioArtUrl,
  radioCurrentPeerAddr,
  radioCurrentStationId,
  radioError,
  radioListenerCount,
  radioNowPlaying,
  radioStatus,
  tuneIntoRadio,
} from "../../app/services/radio/radioService";
import {
  createPendingRemote,
  deletePendingRemoteByPeerAddr,
  getPendingRemoteByPeerAddr,
} from "../../app/services/storage/db";
import { createRemote, getAllRemotes } from "../../app/services/remotes/remoteManager";
import { isCharnelMode } from "../../app/services/charnel";
import { debug } from "../../utils/logger";
import { RadioHistoryList } from "./RadioHistoryList";
import { showShareModal } from "../hooks/modals";
import { addRadioStationHistoryEntry } from "../services/queue/queueHistory";
import { type Remote, isHttpRemote, isP2PRemote } from "../../app/services/storage/types";
import type { ImageMetadata } from "../services/storage/types";
import { Icon } from "../../components/icons/registry";

export function RadioView() {
  const MIN_HISTORY_SCROLL_HEIGHT = 220;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // peer addrs passed via ?node_id=... or ?node_id=a&node_id=b
  const queryPeerAddrs = createMemo<string[]>(() => {
    const raw = searchParams.node_id;
    if (!raw) return [];
    return Array.isArray(raw) ? raw.filter(Boolean) : [raw];
  });

  const queryStationId = createMemo<string | null>(() => {
    const raw = searchParams.station_id;
    if (!raw) return null;
    if (Array.isArray(raw)) return raw[0] ?? null;
    return raw;
  });

  // record any query-param peers as pending remotes so they survive
  // a page refresh and can be promoted to full remotes from settings.
  onMount(async () => {
    const addrs = queryPeerAddrs();
    let inserted = false;
    for (const addr of addrs) {
      try {
        const existing = await getPendingRemoteByPeerAddr(addr);
        if (existing) continue;
        await createPendingRemote({
          peer_addr: addr,
          transport: addr.startsWith("http") ? "http" : isCharnelMode() ? "app" : "wasm",
          stage: "connected",
          server_name: null,
          server_description: null,
          server_version: null,
          server_image_data: null,
          server_image_type: null,
          knock_username: null,
          knock_message: null,
          error_message: null,
        });
        inserted = true;
        debug("radio-view", `recorded ?node_id pending remote: ${addr}`);
      } catch (e) {
        console.warn("[radio-view] could not save pending remote:", e);
      }
    }
    if (inserted) refetch();
  });

  const [stations, setStations] = createSignal<DiscoveredStation[]>([]);
  const [sweeping, setSweeping] = createSignal(false);
  const [knownRemotes, setKnownRemotes] = createSignal<Remote[]>([]);
  const BASE_POLL_MS = 30_000;
  const MAX_POLL_MS = 120_000;
  const STATION_STALE_GRACE_MS = 2 * 60_000;
  let nextPollMs = BASE_POLL_MS;
  let emptyDiscoveryStreak = 0;
  let lastNonEmptyAtMs = 0;
  let lastNonEmptyStations: DiscoveredStation[] = [];

  const hasRecentStations = () =>
    stations().length > 0 ||
    (lastNonEmptyStations.length > 0 && Date.now() - lastNonEmptyAtMs < STATION_STALE_GRACE_MS);

  const applyDiscoveredStations = (next: DiscoveredStation[]) => {
    if (next.length > 0) {
      emptyDiscoveryStreak = 0;
      lastNonEmptyAtMs = Date.now();
      lastNonEmptyStations = next;
      setStations(next);
      return;
    }

    // avoid blanking the UI on transient empty/cooldown sweeps.
    if (next.length === 0 && stations().length > 0) {
      emptyDiscoveryStreak += 1;
      if (emptyDiscoveryStreak < 3) return;
      // if we had good results recently, keep showing the previous list.
      if (Date.now() - lastNonEmptyAtMs < STATION_STALE_GRACE_MS) {
        setStations(lastNonEmptyStations);
        return;
      }
    }

    if (stations().length === 0 && Date.now() - lastNonEmptyAtMs < STATION_STALE_GRACE_MS) {
      setStations(lastNonEmptyStations);
      return;
    }

    setStations(next);
  };

  const refetch = async (opts: { forceProbeAll?: boolean } = {}) => {
    setSweeping(true);
    try {
      const final = await discoverStations({
        extraPeerAddrs: queryPeerAddrs(),
        onPartial: (s) => applyDiscoveredStations(s),
        forceProbeAll: opts.forceProbeAll ?? false,
      });
      applyDiscoveredStations(final);
    } catch (e) {
      console.warn("[radio-view] discovery failed:", e);
    } finally {
      setSweeping(false);
    }
  };

  // quiet refresh — re-runs discovery without flashing the "scanning…"
  // indicator or clearing the existing list. used by the polling timer
  // so the listener counts in the left column stay live.
  const quietRefresh = async (): Promise<boolean> => {
    try {
      const final = await discoverStations({
        extraPeerAddrs: queryPeerAddrs(),
      });
      applyDiscoveredStations(final);
      return true;
    } catch (e) {
      debug("radio-view", "quiet refresh failed:", e);
      return false;
    }
  };

  onMount(() => {
    refetch();
    // adaptive poll loop: start at 30s, back off up to 120s on failures.
    let disposed = false;
    let timer: number | null = null;

    const isStationListVisible = () => {
      // on mobile/narrow layout, discovery polling is only useful while
      // the station list is actually on screen. when detail is full-screen,
      // pause polling to reduce network + CPU load.
      if (!isNarrowViewport()) return true;
      return !showDetail();
    };

    const shouldPoll = () =>
      !sweeping() && document.visibilityState !== "hidden" && isStationListVisible();

    const cancelTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNext = (delayMs: number) => {
      if (disposed) return;
      cancelTimer();
      timer = window.setTimeout(async () => {
        if (disposed) return;
        if (!shouldPoll()) {
          // skip this cycle but reschedule — the visibilitychange handler
          // will also kick off a fresh cycle when the page comes back into view.
          scheduleNext(nextPollMs);
          return;
        }
        const ok = await quietRefresh();
        nextPollMs = ok ? BASE_POLL_MS : Math.min(MAX_POLL_MS, Math.floor(nextPollMs * 1.8));
        scheduleNext(nextPollMs);
      }, delayMs);
    };

    // when the page returns to the foreground, run a discovery sweep
    // immediately rather than waiting for the next scheduled tick.
    const onVisibilityChange = () => {
      if (disposed) return;
      if (document.visibilityState === "visible" && isStationListVisible()) {
        cancelTimer();
        void quietRefresh().then((ok) => {
          if (disposed) return;
          nextPollMs = ok ? BASE_POLL_MS : Math.min(MAX_POLL_MS, Math.floor(nextPollMs * 1.8));
          scheduleNext(nextPollMs);
        });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    scheduleNext(nextPollMs);
    onCleanup(() => {
      disposed = true;
      cancelTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    });
  });

  onMount(async () => {
    try {
      setKnownRemotes(await getAllRemotes());
    } catch (e) {
      debug("radio-view", "failed to load remotes for image fallback:", e);
    }
  });

  onMount(() => {
    const onResize = () => {
      setIsNarrow(isNarrowViewport());
      recomputeDetailLayout();
    };
    window.addEventListener("resize", onResize);
    onCleanup(() => window.removeEventListener("resize", onResize));
  });

  const grouped = createMemo(() => {
    const map = new Map<string, DiscoveredStation[]>();
    for (const s of stations()) {
      const key = s.source.label;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  const remoteForSource = (source: SourceRef): Remote | null => {
    if (source.kind === "self") {
      return knownRemotes().find((r) => r.is_charnel_managed) ?? null;
    }
    if (source.kind === "remote") {
      return knownRemotes().find((r) => r.remote_id === source.id) ?? null;
    }
    const addr = source.peer_addr ?? source.base_url;
    if (!addr) return null;
    return (
      knownRemotes().find((r) => {
        if (isP2PRemote(r)) return r.peer_addr === addr;
        if (isHttpRemote(r)) return r.base_url === addr;
        return false;
      }) ?? null
    );
  };

  const remoteImageMetaForSource = (source: SourceRef): ImageMetadata | undefined => {
    const remote = remoteForSource(source);
    if (!remote) return undefined;
    const raw = remote.image_url ?? undefined;
    const remoteUrl = raw
      ? raw.startsWith("asset://") || raw.startsWith("http://") || raw.startsWith("https://")
        ? raw
        : isHttpRemote(remote) && remote.base_url
          ? `${remote.base_url}${raw}`
          : undefined
      : undefined;
    if (!remote.image_blob_id && !remoteUrl) return undefined;
    return {
      remote_blob_id: remote.image_blob_id ?? undefined,
      remote_server_id: remote.remote_id,
      remote_url: remoteUrl,
      blob_type: "thumbnail",
      is_primary: true,
    };
  };

  // narrow-mode detail toggle.
  const [isNarrow, setIsNarrow] = createSignal(isNarrowViewport());
  const [showDetail, setShowDetail] = createSignal(false);
  const [useStickyDetailLayout, setUseStickyDetailLayout] = createSignal(false);
  let detailViewportRef: HTMLDivElement | undefined;
  let detailHeaderRef: HTMLDivElement | undefined;

  const recomputeDetailLayout = () => {
    window.requestAnimationFrame(() => {
      if (!detailViewportRef || !detailHeaderRef || radioStatus() === "idle") {
        setUseStickyDetailLayout(false);
        return;
      }
      const remainingHeight = detailViewportRef.clientHeight - detailHeaderRef.offsetHeight - 24;
      setUseStickyDetailLayout(remainingHeight >= MIN_HISTORY_SCROLL_HEIGHT);
    });
  };

  const handleTune = async (station: DiscoveredStation) => {
    const isLocal = station.source.kind === "self";
    // self source has no peer_addr — local tune subscribes in-process.
    const peer = isLocal
      ? station.source.id || "self"
      : (station.source.peer_addr ?? station.source.base_url);
    if (!peer) {
      console.warn("[radio-view] station has no peer addr", station);
      return;
    }

    const matchesCurrentStation = (
      peerToCheck: string,
      stationIdToCheck: string | null | undefined
    ) => {
      if (radioStatus() === "idle") return false;
      if (radioCurrentPeerAddr() !== peerToCheck) return false;
      const currentId = radioCurrentStationId();
      if (currentId !== null) return currentId === (stationIdToCheck ?? null);
      return (stationIdToCheck ?? null) === null;
    };

    const alreadyCurrent = matchesCurrentStation(peer, station.station_id);
    if (alreadyCurrent) {
      if (isNarrowViewport()) setShowDetail(true);
      return;
    }

    try {
      await tuneIntoRadio(peer, {
        stationId: station.station_id,
        stationName: station.name,
        isLocal,
      });
      if (isNarrowViewport()) setShowDetail(true);
    } catch (e) {
      console.error("[radio-view] tune failed:", e);
    }
  };

  // no autoplay: shared links can prefill discovery filters, but tuning
  // always requires explicit user action.
  const [attemptedSharedTune, setAttemptedSharedTune] = createSignal(false);
  createEffect(() => {
    const stationId = queryStationId();
    const candidates = stations();
    if (!stationId || candidates.length === 0 || attemptedSharedTune()) return;

    const expectedSources = new Set(queryPeerAddrs());
    const match = candidates.find((s) => {
      if (s.station_id !== stationId) return false;
      if (expectedSources.size === 0) return true;
      const sourceId = s.source.peer_addr ?? s.source.base_url ?? s.source.id;
      return expectedSources.has(sourceId);
    });

    if (match) {
      setAttemptedSharedTune(true);
      debug("radio-view", "shared station discovered (no auto-tune):", match.station_id);
    }
  });

  const isCurrent = (s: DiscoveredStation) => {
    const peer =
      s.source.kind === "self" ? s.source.id || "self" : (s.source.peer_addr ?? s.source.base_url);
    if (radioStatus() === "idle") return false;
    if (radioCurrentPeerAddr() !== peer) return false;
    const currentId = radioCurrentStationId();
    if (currentId !== null) return currentId === (s.station_id ?? null);
    return (s.station_id ?? null) === null;
  };

  const [promoting, setPromoting] = createSignal<string | null>(null);
  const promoteToRemote = async (src: SourceRef, suggestedName: string) => {
    const peer = src.peer_addr ?? src.base_url;
    if (!peer) return;
    setPromoting(src.id);
    try {
      await createRemote({
        name: suggestedName,
        peer_addr: src.base_url ? undefined : peer,
        base_url: src.base_url,
      });
      try {
        await deletePendingRemoteByPeerAddr(peer);
      } catch (e) {
        debug("radio-view", "no pending row to clean up:", e);
      }
      refetch();
    } catch (e) {
      console.error("[radio-view] promote failed:", e);
      alert(`could not save remote: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPromoting(null);
    }
  };

  const currentStationObj = createMemo(() => stations().find((s) => isCurrent(s)) ?? null);

  createEffect(() => {
    radioStatus();
    radioNowPlaying()?.title;
    currentStationObj()?.station_id;
    showDetail();
    recomputeDetailLayout();
  });

  const canShowStationNowPlaying = (station: DiscoveredStation): boolean => {
    const peer =
      station.source.kind === "self"
        ? station.source.id || "self"
        : (station.source.peer_addr ?? station.source.base_url ?? "");
    if (!peer) return !!station.now_playing;
    if (radioStatus() === "idle") return !!station.now_playing;
    const samePeerAsCurrent = radioCurrentPeerAddr() === peer;
    if (!samePeerAsCurrent) return !!station.now_playing;
    return isCurrent(station) && !!station.now_playing;
  };

  const bookmarkStation = async (station: DiscoveredStation) => {
    const isLocal = station.source.kind === "self";
    const peer = isLocal
      ? station.source.id || "self"
      : (station.source.peer_addr ?? station.source.base_url ?? "");
    if (!peer) return;
    try {
      const current = currentStationObj();
      const currentNp = radioNowPlaying();
      const isCurrentStation =
        !!current &&
        current.station_id === station.station_id &&
        current.source.id === station.source.id;
      const np = isCurrentStation ? currentNp : station.now_playing;
      await addRadioStationHistoryEntry({
        peer_addr: peer,
        station_id: station.station_id,
        station_name: station.name,
        is_local: isLocal,
        art_thumb_b64: np?.art_thumb_b64 ?? undefined,
        art_thumb_mime: np?.art_thumb_mime ?? undefined,
      });
      toast.success("saved station to history");
    } catch (e) {
      console.warn("[radio-view] bookmark failed:", e);
      toast.error("failed to save station");
    }
  };

  const openStationShare = (station: DiscoveredStation) => {
    if (!station.station_id) {
      toast.error("this station cannot be shared yet");
      return;
    }
    const source = remoteForSource(station.source);
    if (!source) {
      toast.error("could not resolve source for sharing");
      return;
    }
    showShareModal({
      target: {
        kind: "radio_station",
        id: station.station_id,
        displayTitle: station.name,
      },
      source: () => source,
    });
  };

  const stationMenuActions = (station: DiscoveredStation): MenuAction[] => [
    {
      label: isCurrent(station) ? "resume" : "tune in",
      icon: "play",
      onClick: () => {
        void handleTune(station);
      },
    },
    {
      label: "save to history",
      icon: "recent",
      onClick: () => {
        void bookmarkStation(station);
      },
    },
    {
      type: "separator",
    },
    {
      label: "share...",
      icon: "share",
      disabled: !station.station_id,
      onClick: () => openStationShare(station),
    },
  ];

  // ---------------------------------------------------------------------
  // left column — station list
  // ---------------------------------------------------------------------
  const leftColumn = (
    <div class="flex flex-col h-full min-h-0 pt-2 wide:pt-[60px]">
      <header class="flex items-center justify-between gap-2 px-3 py-3 border-b border-neutral-800">
        <h1 class="text-lg font-bold">
          radio station<span class="text-magenta-500">z</span>
        </h1>
        <button
          class="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
          onClick={() => refetch({ forceProbeAll: true })}
          disabled={sweeping()}
        >
          {sweeping() ? "scanning…" : "refresh"}
        </button>
      </header>

      <div
        class="flex-1 min-h-0 overflow-y-auto p-2"
        style={{
          "padding-bottom": "calc(var(--player-height) + var(--safe-area-bottom, 0px) + 0.75rem)",
        }}
      >
        <Show
          when={stations().length > 0}
          fallback={
            <div class="text-sm text-neutral-400 p-3">
              <Show
                when={sweeping() || hasRecentStations()}
                fallback={
                  <Show
                    when={queryPeerAddrs().length === 0}
                    fallback={<span>no stations found on those peers.</span>}
                  >
                    no stations found.
                  </Show>
                }
              >
                scanning remotes…
              </Show>
            </div>
          }
        >
          <For each={grouped()}>
            {([label, stns]) => {
              const src = stns[0]?.source;
              const isTransient = src && (src.kind === "pending" || src.kind === "query_param");
              return (
                <section class="mb-4">
                  <div class="flex items-center justify-between px-2 mb-1">
                    <h2 class="text-[11px] uppercase tracking-wide text-neutral-500 truncate">
                      {label}
                    </h2>
                    <Show when={isTransient && src}>
                      <button
                        class="text-[10px] px-1.5 py-0.5 rounded border border-neutral-700 hover:border-neutral-500"
                        onClick={() => promoteToRemote(src!, label)}
                        disabled={promoting() === src!.id}
                      >
                        {promoting() === src!.id ? "saving…" : "save"}
                      </button>
                    </Show>
                  </div>
                  <ul>
                    <For each={stns}>
                      {(station) => (
                        <li>
                          <ContextMenu actions={stationMenuActions(station)}>
                            <button
                              class="w-full text-left flex items-center gap-2 p-2 rounded transition border"
                              classList={{
                                "bg-fuchsia-900/40 border-fuchsia-700": isCurrent(station),
                                "hover:bg-neutral-900 border-transparent": !isCurrent(station),
                              }}
                              onClick={() => handleTune(station)}
                            >
                              <div class="flex-shrink-0 w-10 h-10 rounded overflow-hidden bg-gradient-to-br from-purple-700 to-indigo-900 flex items-center justify-center">
                                <Show
                                  when={isCurrent(station) && radioArtUrl()}
                                  fallback={
                                    <Show
                                      when={
                                        canShowStationNowPlaying(station) &&
                                        station.now_playing?.art_thumb_b64
                                      }
                                      fallback={
                                        <Show
                                          when={remoteImageMetaForSource(station.source)}
                                          fallback={
                                            <span class="text-[8px] font-bold tracking-widest opacity-60 text-white">
                                              radio
                                            </span>
                                          }
                                        >
                                          {(img) => (
                                            <MediaThumbnail
                                              images={[img()]}
                                              size={40}
                                              showPlayIcon={false}
                                              enablePlayClick={false}
                                              hideIndex
                                            />
                                          )}
                                        </Show>
                                      }
                                    >
                                      {(b64) => (
                                        <img
                                          src={`data:${
                                            station.now_playing?.art_thumb_mime ?? "image/jpeg"
                                          };base64,${b64()}`}
                                          alt=""
                                          class="w-full h-full object-cover"
                                        />
                                      )}
                                    </Show>
                                  }
                                >
                                  {(url) => (
                                    <img src={url()} alt="" class="w-full h-full object-cover" />
                                  )}
                                </Show>
                              </div>
                              <div class="flex-1 min-w-0">
                                <div class="text-sm font-medium truncate">{station.name}</div>
                                <div class="text-[11px] text-neutral-400 truncate">
                                  {isCurrent(station)
                                    ? radioListenerCount()
                                    : station.listener_count}{" "}
                                  listening
                                  <Show
                                    when={canShowStationNowPlaying(station) && station.now_playing}
                                  >
                                    {(np) => <> · {np().title}</>}
                                  </Show>
                                </div>
                              </div>
                            </button>
                          </ContextMenu>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------
  // right column — tuned-station detail + history
  // ---------------------------------------------------------------------
  const rightColumn = (
    <div
      class="flex flex-col h-full min-h-0"
      style={{
        "padding-bottom": "calc(var(--player-height) + var(--safe-area-bottom, 0px) + 0.75rem)",
      }}
    >
      <Show
        when={radioStatus() !== "idle"}
        fallback={
          <div class="flex-1 overflow-y-auto flex flex-col items-center text-center p-8 text-neutral-400">
            <div class="w-32 h-32 rounded-lg bg-gradient-to-tr from-magenta-900 to-purple-700 flex items-center justify-center mb-4">
              <span class="text-xs font-bold tracking-widest opacity-60 text-white">
                <Icon name="radioTower" size={64} />R A D I O
              </span>
            </div>
            <p class="text-sm max-w-xs mb-8">
              pick a station from the list to tune in && tune out.
            </p>
            <div class="w-full max-w-md">
              <RadioHistoryList />
            </div>
          </div>
        }
      >
        <div
          ref={detailViewportRef}
          class="flex-1 min-h-0"
          classList={{
            "overflow-hidden": useStickyDetailLayout(),
            "overflow-y-auto": !useStickyDetailLayout(),
          }}
        >
          <div class="px-6 pb-6 pt-3 wide:pt-6 max-w-3xl mx-auto w-full h-full min-h-0 flex flex-col">
            <div
              ref={detailHeaderRef}
              classList={{
                "sticky top-0 z-10 pb-4 mb-2": useStickyDetailLayout(),
              }}
              style={
                useStickyDetailLayout()
                  ? {
                      background:
                        "linear-gradient(to bottom, rgba(10, 10, 10, 0.98), rgba(10, 10, 10, 0.92) 82%, rgba(10, 10, 10, 0))",
                      "backdrop-filter": "blur(10px)",
                    }
                  : undefined
              }
            >
              <header class="flex items-center gap-4 mb-6">
                <div class="flex-shrink-0">
                  <div class="w-32 h-32 sm:w-40 sm:h-40 rounded-lg overflow-hidden bg-gradient-to-br from-purple-700 to-indigo-900 flex items-center justify-center">
                    <Show
                      when={radioArtUrl()}
                      fallback={
                        <Show
                          when={
                            currentStationObj() &&
                            remoteImageMetaForSource(currentStationObj()!.source)
                          }
                          fallback={
                            <span class="text-sm font-bold tracking-widest opacity-60 text-white">
                              radio
                            </span>
                          }
                        >
                          {(img) => (
                            <MediaThumbnail
                              images={[img()]}
                              size={160}
                              showPlayIcon={false}
                              enablePlayClick={false}
                              hideIndex
                            />
                          )}
                        </Show>
                      }
                    >
                      {(url) => <img src={url()} alt="" class="w-full h-full object-cover" />}
                    </Show>
                  </div>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between gap-3 mb-1 min-h-8">
                    <div class="text-xs uppercase tracking-wide text-neutral-500">
                      {radioStatus() === "connecting" ? "connecting…" : "now playing"}
                    </div>
                    <Show when={isNarrow()}>
                      <button
                        class="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 flex items-center gap-1 flex-shrink-0"
                        onClick={() => setShowDetail(false)}
                        aria-label="back to station list"
                      >
                        <span aria-hidden="true">←</span> back
                      </button>
                    </Show>
                  </div>
                  <Show when={radioNowPlaying()} fallback={<div>—</div>}>
                    {(np) => (
                      <>
                        <div class="text-2xl font-bold truncate">{np().title}</div>
                        <div class="text-base text-neutral-300 truncate">
                          {np().artist ?? "unknown artist"}
                          <Show when={np().album}> — {np().album}</Show>
                        </div>
                      </>
                    )}
                  </Show>
                  <Show when={currentStationObj()}>
                    {(s) => (
                      <div class="mt-3 text-sm text-neutral-400">
                        <div class="font-medium">{s().name}</div>
                        <Show when={s().description}>
                          <div class="text-xs">{s().description}</div>
                        </Show>
                        <div class="text-xs mt-1">
                          {radioListenerCount()} listener
                          {radioListenerCount() === 1 ? "" : "s"}
                        </div>
                        {/* <button
                          class={`mt-2 text-xs px-2 py-1 rounded border transition-colors ${
                            bookmarked()
                              ? "border-emerald-700 text-emerald-400 bg-emerald-900/30 cursor-default"
                              : "border-neutral-700 hover:border-neutral-500 hover:text-neutral-200"
                          }`}
                          onClick={handleBookmark}
                          disabled={bookmarking() || bookmarked()}
                          title="save station to queue history"
                        >
                          {bookmarked()
                            ? "saved to history"
                            : bookmarking()
                              ? "saving…"
                              : "save to history"}
                        </button> */}
                        <button
                          class="mt-2 ml-2 text-xs px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 hover:text-neutral-200 transition-colors"
                          onClick={() => openStationShare(s())}
                          disabled={!s().station_id}
                          title="share station"
                        >
                          share
                        </button>
                      </div>
                    )}
                  </Show>
                  <Show when={radioError()}>
                    <div class="mt-2 text-xs text-red-400">{radioError()}</div>
                  </Show>
                </div>
              </header>
            </div>

            <div
              classList={{
                "flex-1 min-h-0 overflow-y-auto": useStickyDetailLayout(),
                "pb-6": useStickyDetailLayout(),
              }}
            >
              <RadioHistoryList />
            </div>
          </div>
        </div>
      </Show>
    </div>
  );

  return (
    <TwoColumnLayout
      leftColumn={leftColumn}
      rightColumn={rightColumn}
      leftColumnWidth={320}
      showDetail={showDetail()}
      onBack={() => setShowDetail(false)}
    />
  );
}

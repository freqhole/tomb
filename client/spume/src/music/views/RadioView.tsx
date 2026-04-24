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

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { TwoColumnLayout } from "../../components/layout/TwoColumnLayout";
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
import { createRemote } from "../../app/services/remotes/remoteManager";
import { isCharnelMode } from "../../app/services/charnel";
import { debug } from "../../utils/logger";
import { RadioHistoryList } from "./RadioHistoryList";

export function RadioView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // peer addrs passed via ?node_id=... or ?node_id=a&node_id=b
  const queryPeerAddrs = createMemo<string[]>(() => {
    const raw = searchParams.node_id;
    if (!raw) return [];
    return Array.isArray(raw) ? raw.filter(Boolean) : [raw];
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

  const refetch = async () => {
    setSweeping(true);
    setStations([]);
    try {
      const final = await discoverStations({
        extraPeerAddrs: queryPeerAddrs(),
        onPartial: (s) => setStations(s),
      });
      setStations(final);
    } catch (e) {
      console.warn("[radio-view] discovery failed:", e);
    } finally {
      setSweeping(false);
    }
  };

  // quiet refresh — re-runs discovery without flashing the "scanning…"
  // indicator or clearing the existing list. used by the polling timer
  // so the listener counts in the left column stay live.
  const quietRefresh = async () => {
    try {
      const final = await discoverStations({
        extraPeerAddrs: queryPeerAddrs(),
      });
      setStations(final);
    } catch (e) {
      debug("radio-view", "quiet refresh failed:", e);
    }
  };

  onMount(() => {
    refetch();
    // poll every 15s so listener counts + station availability track
    // reality without users having to click refresh. cheap: discovery
    // already races sources with a short timeout.
    const interval = window.setInterval(() => {
      if (!sweeping()) quietRefresh();
    }, 15000);
    onCleanup(() => window.clearInterval(interval));
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

  // narrow-mode detail toggle.
  const [showDetail, setShowDetail] = createSignal(false);

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

  const isCurrent = (s: DiscoveredStation) => {
    const peer =
      s.source.kind === "self" ? s.source.id || "self" : (s.source.peer_addr ?? s.source.base_url);
    return (
      radioStatus() !== "idle" &&
      radioCurrentPeerAddr() === peer &&
      (radioCurrentStationId() === s.station_id || radioCurrentStationId() === null)
    );
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

  // ---------------------------------------------------------------------
  // left column — station list
  // ---------------------------------------------------------------------
  const leftColumn = (
    <div class="flex flex-col h-full mt-2 wide:mt-[60px]">
      <header class="flex items-center justify-between gap-2 px-3 py-3 border-b border-neutral-800">
        <h1 class="text-lg font-bold">radio</h1>
        <button
          class="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
          onClick={() => refetch()}
          disabled={sweeping()}
        >
          {sweeping() ? "scanning…" : "refresh"}
        </button>
      </header>

      <div class="flex-1 overflow-y-auto p-2">
        <Show
          when={stations().length > 0}
          fallback={
            <div class="text-sm text-neutral-400 p-3">
              <Show
                when={sweeping()}
                fallback={
                  <Show
                    when={queryPeerAddrs().length === 0}
                    fallback={<span>no stations found on those peers.</span>}
                  >
                    no stations found.{" "}
                    <button class="underline" onClick={() => navigate("/settings/remotes")}>
                      add a remote
                    </button>
                    .
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
                          <button
                            class="w-full text-left flex items-center gap-2 p-2 rounded transition border"
                            classList={{
                              "bg-emerald-900/40 border-emerald-700": isCurrent(station),
                              "hover:bg-neutral-900 border-transparent": !isCurrent(station),
                            }}
                            onClick={() => handleTune(station)}
                          >
                            <div class="flex-shrink-0 w-10 h-10 rounded overflow-hidden bg-gradient-to-br from-purple-700 to-indigo-900 flex items-center justify-center">
                              <Show
                                when={isCurrent(station) && radioArtUrl()}
                                fallback={
                                  <Show
                                    when={station.now_playing?.art_thumb_b64}
                                    fallback={
                                      <span class="text-[8px] font-bold tracking-widest opacity-60 text-white">
                                        radio
                                      </span>
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
                                {isCurrent(station) ? radioListenerCount() : station.listener_count}{" "}
                                listening
                                <Show when={station.now_playing}>
                                  {(np) => <> · {np().title}</>}
                                </Show>
                              </div>
                            </div>
                          </button>
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
    <div class="flex flex-col h-full overflow-y-auto">
      {/* narrow-only back button so we can return to the station list. */}
      <div class="wide:hidden flex items-center px-3 py-2 border-b border-neutral-800">
        <button
          class="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 flex items-center gap-1"
          onClick={() => setShowDetail(false)}
          aria-label="back to station list"
        >
          <span aria-hidden="true">←</span> back
        </button>
      </div>
      <Show
        when={radioStatus() !== "idle"}
        fallback={
          <div class="flex-1 flex flex-col items-center text-center p-8 text-neutral-400">
            <div class="w-32 h-32 rounded-lg bg-gradient-to-br from-purple-700 to-indigo-900 flex items-center justify-center mb-4">
              <span class="text-xs font-bold tracking-widest opacity-60 text-white">radio</span>
            </div>
            <p class="text-sm max-w-xs mb-8">
              pick a station from the list to tune in. while you listen, every track that plays is
              logged below.
            </p>
            <div class="w-full max-w-md">
              <RadioHistoryList />
            </div>
          </div>
        }
      >
        <div class="p-6 max-w-3xl mx-auto w-full">
          <header class="flex items-start gap-4 mb-6">
            <div class="flex-shrink-0 w-32 h-32 sm:w-40 sm:h-40 rounded-lg overflow-hidden bg-gradient-to-br from-purple-700 to-indigo-900 flex items-center justify-center">
              <Show
                when={radioArtUrl()}
                fallback={
                  <span class="text-sm font-bold tracking-widest opacity-60 text-white">radio</span>
                }
              >
                {(url) => <img src={url()} alt="" class="w-full h-full object-cover" />}
              </Show>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                {radioStatus() === "connecting" ? "connecting…" : "now playing"}
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
                  </div>
                )}
              </Show>
              <Show when={radioError()}>
                <div class="mt-2 text-xs text-red-400">{radioError()}</div>
              </Show>
            </div>
          </header>

          <RadioHistoryList />
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

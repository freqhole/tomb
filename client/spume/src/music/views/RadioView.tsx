// /radio root view
//
// shows the listener-side radio browser: a grid of stations across all
// configured + pending remotes, plus any peer addr passed via the
// ?node_id=... query param. clicking a tile tunes the audio service
// into that station.

import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import {
  discoverStations,
  type DiscoveredStation,
  type SourceRef,
} from "../../app/services/radio/radioDiscovery";
import {
  leaveRadio,
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
  appState,
} from "../../app/services/storage/db";
import { createRemote } from "../../app/services/remotes/remoteManager";
import { isCharnelMode } from "../../app/services/charnel";
import { debug } from "../../utils/logger";
import { getNavHeight, useViewportHeight } from "../../utils/viewport";

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
  // refetch after writing so the new pending row gets picked up by
  // the discovery sweep (which reads pending remotes at call time).
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
    if (inserted) {
      // pending rows changed; re-sweep so they show up in the grid.
      refetch();
    }
  });

  // progressive discovery: stations stream in as each source responds.
  // we hold the latest cumulative array in `stations` and a coarse
  // `sweeping` flag for the spinner.
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

  // initial sweep.
  onMount(() => {
    refetch();
  });

  // group stations by their source label so the grid stays scannable.
  const grouped = createMemo(() => {
    const map = new Map<string, DiscoveredStation[]>();
    for (const s of stations()) {
      const key = s.source.label;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  // wire the audio element from the radio service into a stable container
  // so navigating away from /radio doesn't kill playback. for now we just
  // keep it inline; a future "player bar" slice can move it to AppLayout.
  // playback now happens inside the global RadioBar (mounted in AppLayout),
  // so this view never owns an <audio> element.

  const handleTune = async (station: DiscoveredStation) => {
    const peer = station.source.peer_addr ?? station.source.base_url;
    if (!peer) {
      console.warn("[radio-view] station has no peer addr", station);
      return;
    }
    try {
      await tuneIntoRadio(peer, {
        stationId: station.station_id,
        stationName: station.name,
      });
    } catch (e) {
      console.error("[radio-view] tune failed:", e);
    }
  };

  const isCurrent = (s: DiscoveredStation) => {
    const peer = s.source.peer_addr ?? s.source.base_url;
    return (
      radioStatus() !== "idle" &&
      radioCurrentPeerAddr() === peer &&
      (radioCurrentStationId() === s.station_id || radioCurrentStationId() === null)
    );
  };

  // tracks which source is currently being promoted to a real remote
  // so the button can show a loading state.
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
      // clean up the pending row if there was one — createRemote already
      // verified the server is reachable.
      try {
        await deletePendingRemoteByPeerAddr(peer);
      } catch (e) {
        debug("radio-view", "no pending row to clean up:", e);
      }
      // re-scan so the source is now under its real remote label.
      refetch();
    } catch (e) {
      console.error("[radio-view] promote failed:", e);
      alert(`could not save remote: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPromoting(null);
    }
  };

  // viewport math: compute scroll-area height like the other music views
  // so the station grid scrolls within its container instead of the page
  // pushing under the radio bar / player bar.
  const viewportHeight = useViewportHeight();
  const playerBarPx = () => ((appState()?.queue.length || 0) > 0 ? 80 : 0);
  const radioBarPx = () => (radioStatus() !== "idle" ? 64 : 0);
  const scrollHeight = () => viewportHeight() - getNavHeight() - playerBarPx() - radioBarPx();

  return (
    <div class="flex flex-col w-full" style={{ height: `${scrollHeight()}px` }}>
      <div class="flex-1 overflow-y-auto">
        <div class="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
          <header class="flex items-start sm:items-center justify-between gap-3 mb-6 flex-col sm:flex-row">
            <div>
              <h1 class="text-3xl font-bold">radio</h1>
              <p class="text-sm text-neutral-400 mt-1">stations broadcast by your remotes</p>
            </div>
            <div class="flex gap-2 self-end sm:self-auto">
              <button
                class="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-sm"
                onClick={() => refetch()}
                disabled={sweeping()}
              >
                {sweeping() ? "scanning…" : "refresh"}
              </button>
              <Show when={radioStatus() !== "idle"}>
                <button
                  class="px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-sm"
                  onClick={() => leaveRadio()}
                >
                  stop
                </button>
              </Show>
            </div>
          </header>

          {/* now-playing strip — only shown on narrow viewports; on wide
              the global RadioBar at the bottom carries the same info. */}
          <Show when={radioStatus() !== "idle"}>
            <section class="mb-6 p-4 rounded-lg bg-neutral-900 border border-neutral-800 sm:hidden">
              <div class="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                {radioStatus() === "connecting" ? "connecting…" : "now playing"}
              </div>
              <div class="flex items-start gap-3">
                <div class="flex-shrink-0 w-16 h-16 rounded overflow-hidden bg-gradient-to-br from-purple-700 to-indigo-900 flex items-center justify-center">
                  <Show
                    when={radioArtUrl()}
                    fallback={
                      <span class="text-[10px] font-bold tracking-widest opacity-70 text-white">
                        radio
                      </span>
                    }
                  >
                    {(url) => (
                      <img src={url()} alt="album art" class="w-full h-full object-cover" />
                    )}
                  </Show>
                </div>
                <div class="flex-1 min-w-0">
                  <Show when={radioNowPlaying()} fallback={<div>—</div>}>
                    {(np) => (
                      <div>
                        <div class="text-lg font-semibold truncate">{np().title}</div>
                        <div class="text-sm text-neutral-400 truncate">
                          {np().artist ?? "unknown artist"}
                          <Show when={np().album}>
                            {" — "}
                            {np().album}
                          </Show>
                        </div>
                      </div>
                    )}
                  </Show>
                  <div class="text-xs text-neutral-500 mt-2">
                    {radioListenerCount()} listener
                    {radioListenerCount() === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <Show when={radioError()}>
                <div class="mt-2 text-xs text-red-400">{radioError()}</div>
              </Show>
            </section>
          </Show>

          {/* station grid — show partial results as they stream in */}
          <Show
            when={stations().length > 0 || !sweeping()}
            fallback={<div class="text-neutral-400">scanning remotes…</div>}
          >
            <Show
              when={stations().length > 0}
              fallback={
                <div class="text-neutral-400 text-sm">
                  no stations found.{" "}
                  <Show when={queryPeerAddrs().length === 0}>
                    add a remote in{" "}
                    <button class="underline" onClick={() => navigate("/settings/remotes")}>
                      settings → remotes
                    </button>{" "}
                    or open a shared link with <code class="text-xs">?node_id=…</code>.
                  </Show>
                </div>
              }
            >
              <For each={grouped()}>
                {([label, stations]) => {
                  const src = stations[0]?.source;
                  const isTransient = src && (src.kind === "pending" || src.kind === "query_param");
                  return (
                    <section class="mb-8">
                      <div class="flex items-center justify-between mb-2">
                        <h2 class="text-sm uppercase tracking-wide text-neutral-500">
                          {label}
                          <Show when={src?.kind === "query_param"}>
                            <span class="ml-2 text-[10px] normal-case text-amber-400">
                              (from link)
                            </span>
                          </Show>
                          <Show when={src?.kind === "pending"}>
                            <span class="ml-2 text-[10px] normal-case text-neutral-400">
                              (pending)
                            </span>
                          </Show>
                        </h2>
                        <Show when={isTransient && src}>
                          <button
                            class="text-xs px-2 py-0.5 rounded border border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800"
                            onClick={() => promoteToRemote(src!, label)}
                            disabled={promoting() === src!.id}
                          >
                            {promoting() === src!.id ? "saving…" : "save as remote"}
                          </button>
                        </Show>
                      </div>
                      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        <For each={stations}>
                          {(station) => (
                            <button
                              class={`text-left p-4 rounded-lg border transition ${
                                isCurrent(station)
                                  ? "bg-emerald-900/50 border-emerald-600"
                                  : "bg-neutral-900 border-neutral-800 hover:border-neutral-600"
                              }`}
                              onClick={() => handleTune(station)}
                            >
                              <div class="aspect-square rounded bg-gradient-to-br from-purple-700 to-indigo-900 mb-3 flex items-center justify-center text-2xl font-bold tracking-widest opacity-60 overflow-hidden">
                                <Show
                                  when={isCurrent(station) && radioArtUrl()}
                                  fallback={<>radio</>}
                                >
                                  {(url) => (
                                    <img
                                      src={url()}
                                      alt="album art"
                                      class="w-full h-full object-cover opacity-100"
                                    />
                                  )}
                                </Show>
                              </div>
                              <div class="font-semibold truncate">{station.name}</div>
                              <Show when={station.description}>
                                <div class="text-xs text-neutral-400 truncate mt-1">
                                  {station.description}
                                </div>
                              </Show>
                              <div class="text-xs text-neutral-500 mt-2">
                                {station.listener_count} listening
                                <Show when={station.is_default}> • default</Show>
                              </div>
                              <Show when={station.now_playing}>
                                {(np) => (
                                  <div class="text-xs text-neutral-300 truncate mt-1">
                                    now: {np().title}
                                  </div>
                                )}
                              </Show>
                            </button>
                          )}
                        </For>
                      </div>
                    </section>
                  );
                }}
              </For>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}

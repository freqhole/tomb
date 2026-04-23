// /radio root view
//
// shows the listener-side radio browser: a grid of stations across all
// configured + pending remotes, plus any peer addr passed via the
// ?node_id=... query param. clicking a tile tunes the audio service
// into that station.

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { discoverStations, type DiscoveredStation } from "../../app/services/radio/radioDiscovery";
import {
  leaveRadio,
  radioCurrentPeerAddr,
  radioCurrentStationId,
  radioError,
  radioListenerCount,
  radioNowPlaying,
  radioStatus,
  tuneIntoRadio,
} from "../../app/services/radio/radioService";
import { createPendingRemote, getPendingRemoteByPeerAddr } from "../../app/services/storage/db";
import { isCharnelMode } from "../../app/services/charnel";
import { debug } from "../../utils/logger";

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
        debug("radio-view", `recorded ?node_id pending remote: ${addr}`);
      } catch (e) {
        console.warn("[radio-view] could not save pending remote:", e);
      }
    }
  });

  const [stationsResource, { refetch }] = createResource(queryPeerAddrs, async (extras) => {
    return discoverStations({ extraPeerAddrs: extras });
  });

  // group stations by their source label so the grid stays scannable.
  const grouped = createMemo(() => {
    const map = new Map<string, DiscoveredStation[]>();
    for (const s of stationsResource() ?? []) {
      const key = s.source.label;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  // wire the audio element from the radio service into a stable container
  // so navigating away from /radio doesn't kill playback. for now we just
  // keep it inline; a future "player bar" slice can move it to AppLayout.
  let audioMount!: HTMLDivElement;
  const [audio, setAudio] = createSignal<HTMLAudioElement | null>(null);

  createEffect(() => {
    const el = audio();
    if (!el || !audioMount) return;
    if (el.parentElement !== audioMount) {
      audioMount.replaceChildren(el);
      el.controls = true;
      el.style.width = "100%";
    }
  });

  const handleTune = async (station: DiscoveredStation) => {
    const peer = station.source.peer_addr ?? station.source.base_url;
    if (!peer) {
      console.warn("[radio-view] station has no peer addr", station);
      return;
    }
    try {
      const el = await tuneIntoRadio(peer, {
        stationId: station.station_id,
        stationName: station.name,
      });
      setAudio(el);
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

  onCleanup(() => {
    // keep the radio session alive across route changes by NOT calling
    // leaveRadio() here. users must hit "stop" explicitly.
  });

  return (
    <div class="p-6 max-w-6xl mx-auto">
      <header class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-3xl font-bold">radio</h1>
          <p class="text-sm text-neutral-400 mt-1">stations broadcast by your remotes</p>
        </div>
        <div class="flex gap-2">
          <button
            class="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-sm"
            onClick={() => refetch()}
            disabled={stationsResource.loading}
          >
            {stationsResource.loading ? "scanning…" : "refresh"}
          </button>
          <Show when={radioStatus() !== "idle"}>
            <button
              class="px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-sm"
              onClick={() => {
                leaveRadio();
                setAudio(null);
                if (audioMount) audioMount.replaceChildren();
              }}
            >
              stop
            </button>
          </Show>
        </div>
      </header>

      {/* now-playing strip */}
      <Show when={radioStatus() !== "idle"}>
        <section class="mb-6 p-4 rounded-lg bg-neutral-900 border border-neutral-800">
          <div class="text-xs uppercase tracking-wide text-neutral-500 mb-1">
            {radioStatus() === "connecting" ? "connecting…" : "now playing"}
          </div>
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
          <div ref={(el) => (audioMount = el)} class="mt-3" />
          <Show when={radioError()}>
            <div class="mt-2 text-xs text-red-400">{radioError()}</div>
          </Show>
        </section>
      </Show>

      {/* station grid */}
      <Show
        when={!stationsResource.loading}
        fallback={<div class="text-neutral-400">scanning remotes…</div>}
      >
        <Show
          when={(stationsResource() ?? []).length > 0}
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
            {([label, stations]) => (
              <section class="mb-8">
                <h2 class="text-sm uppercase tracking-wide text-neutral-500 mb-2">{label}</h2>
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
                        <div class="aspect-square rounded bg-gradient-to-br from-purple-700 to-indigo-900 mb-3 flex items-center justify-center text-2xl font-bold tracking-widest opacity-60">
                          radio
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
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}

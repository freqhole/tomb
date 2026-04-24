// charnel-only radio station admin (stub).
//
// purpose: surface the local node's radio stations + provide a place
// where the create/edit/delete wizard will live (see 2j in
// docs/radio-remaining-work.md). today this view is read-only — the
// admin offal routes (radio_admin_create_station, etc.) don't exist
// yet, so the create/edit buttons render disabled with a "coming soon"
// hint. once those routes ship this becomes the wizard host.
//
// hidden from the settings nav for non-charnel users (web/mobile bundle
// can't run a station — admin is only meaningful when there's a local
// iroh node hosting the broadcaster).

import { createResource, createSignal, For, Show } from "solid-js";
import { getClientForRemote, isCharnelAvailable } from "../../app/api/client";
import type { RemoteRef } from "../../app/api/client";
import { getTauriManagedRemote } from "../../app/services/remotes/remoteManager";
import { isP2PRemote } from "../../app/services/storage/types";
import type { PublicStation, RadioStationsResponse } from "freqhole-api-client";
import { debug } from "../../utils/logger";

export function RadioSettingsView() {
  // gate behind charnel mode — web users can't run stations.
  if (!isCharnelAvailable()) {
    return (
      <div data-allow-select class="p-6 max-w-3xl">
        <h1 class="text-xl font-bold mb-2">radio stations</h1>
        <p class="text-sm text-neutral-400">
          radio station admin is only available in the desktop app (charnel mode). use the web ui to{" "}
          <em>browse</em> stations on the radio page; use the desktop app to create + manage them.
        </p>
      </div>
    );
  }

  const [stations, { refetch }] = createResource(loadLocalStations);
  const [creating, setCreating] = createSignal(false);

  return (
    <div data-allow-select class="p-6 max-w-3xl">
      <header class="mb-6">
        <h1 class="text-xl font-bold mb-1">radio stations</h1>
        <p class="text-sm text-neutral-400">
          stations broadcasting from <strong>this node</strong>. peers tune in via the standard
          radio discovery flow.
        </p>
      </header>

      {/* current stations list */}
      <section class="mb-8">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-300">
            current stations
          </h2>
          <button
            class="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50"
            onClick={() => refetch()}
            disabled={stations.loading}
          >
            {stations.loading ? "loading…" : "refresh"}
          </button>
        </div>

        <Show
          when={!stations.loading}
          fallback={<div class="text-sm text-neutral-500">scanning local node…</div>}
        >
          <Show
            when={stations()?.enabled}
            fallback={
              <div class="rounded-lg border border-neutral-800 p-4 text-sm text-neutral-400">
                <p class="mb-2">
                  the local node has radio <strong>disabled</strong>.
                </p>
                <p class="text-xs">
                  enable it via <code>freqhole-config.toml</code> → <code>[radio]</code> →{" "}
                  <code>enabled = true</code>, then restart. config-from-ui is a TODO; see plan.
                </p>
              </div>
            }
          >
            <Show
              when={(stations()?.stations.length ?? 0) > 0}
              fallback={
                <div class="rounded-lg border border-dashed border-neutral-800 p-4 text-sm text-neutral-400">
                  no stations running yet. create one below (once the wizard ships).
                </div>
              }
            >
              <ul class="divide-y divide-neutral-800 rounded-lg border border-neutral-800 overflow-hidden">
                <For each={stations()?.stations ?? []}>{(s) => <StationRow station={s} />}</For>
              </ul>
            </Show>
          </Show>
        </Show>
      </section>

      {/* create-station card (stub) */}
      <section class="mb-8 rounded-lg border border-neutral-800 p-4">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-300 mb-2">
          create station
        </h2>
        <p class="text-xs text-neutral-400 mb-3">
          full wizard is in flight. see{" "}
          <a class="underline" href="#" onClick={(e) => e.preventDefault()}>
            docs/radio-remaining-work.md § 2j
          </a>
          . it will:
        </p>
        <ul class="text-xs text-neutral-400 list-disc ml-5 mb-4 space-y-1">
          <li>name + description</li>
          <li>seed query (genre/tag/playlist) for now-playing rotation</li>
          <li>public/private + invite list (per-station auth — see § 2d)</li>
          <li>optional bumpers (DJ drops, station IDs — see § 2k)</li>
        </ul>
        <button
          class="text-sm px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled
          title="admin offal routes ship in 2j"
          onClick={() => setCreating(true)}
        >
          create station (coming soon)
        </button>
        <Show when={creating()}>
          <p class="text-xs text-amber-400 mt-2">stub — no backend yet.</p>
        </Show>
      </section>

      {/* radio config card (stub) */}
      <section class="rounded-lg border border-neutral-800 p-4">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-neutral-300 mb-2">
          node-wide radio config
        </h2>
        <p class="text-xs text-neutral-400 mb-2">
          edit <code>freqhole-config.toml</code> and restart for now. coming soon: enable/disable +
          chunk size + max listeners editable from this view.
        </p>
        <pre class="text-[11px] text-neutral-500 bg-black/40 rounded p-2 overflow-x-auto">
          {`[radio]
enabled = true
chunk_ms = 2000
max_listeners_per_station = 64`}
        </pre>
      </section>
    </div>
  );
}

function StationRow(props: { station: PublicStation }) {
  return (
    <li class="flex items-center gap-3 px-3 py-2.5 hover:bg-neutral-900/40">
      <div class="w-8 h-8 rounded bg-gradient-to-br from-purple-700 to-indigo-900 flex items-center justify-center flex-shrink-0">
        <span class="text-[8px] font-bold tracking-widest text-white opacity-70">radio</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline gap-2">
          <span class="text-sm font-medium truncate">{props.station.name}</span>
          <Show when={props.station.is_default}>
            <span class="text-[10px] uppercase tracking-wide text-emerald-400">default</span>
          </Show>
        </div>
        <div class="text-xs text-neutral-400 truncate">
          {props.station.listener_count} listening
          {props.station.now_playing.title ? ` · ${props.station.now_playing.title}` : ""}
        </div>
      </div>
      <button
        class="text-xs px-2 py-1 rounded border border-neutral-700 hover:border-neutral-500 disabled:opacity-40 disabled:cursor-not-allowed"
        disabled
        title="admin offal routes ship in 2j"
      >
        edit
      </button>
    </li>
  );
}

async function loadLocalStations(): Promise<RadioStationsResponse | null> {
  try {
    const ref = await localCharnelRemoteRef();
    if (!ref) return null;
    const client = await getClientForRemote(ref);
    const resp = await client.app.radioStations();
    if (!resp.success || !resp.data) {
      return { enabled: false, stations: [] };
    }
    return resp.data as RadioStationsResponse;
  } catch (e) {
    debug("radio-settings", "load failed:", e);
    return { enabled: false, stations: [] };
  }
}

async function localCharnelRemoteRef(): Promise<RemoteRef | null> {
  const remote = await getTauriManagedRemote();
  if (!remote) return null;
  if (isP2PRemote(remote)) {
    return { transport: "app", peer_addr: remote.peer_addr };
  }
  return null;
}

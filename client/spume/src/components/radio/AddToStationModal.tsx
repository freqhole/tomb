// modal for adding an artist / album / genre / song(s) to a radio station.
// lists the local station roster and calls the appropriate admin command on
// the selected station.
//
// this is the charnel-mode companion to the RadioAdminView seed editor —
// same admin commands, different entry point.

import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { AdminClient, AdminCommandError, type RadioStation } from "freqhole-api-client";
import { adminClientFor, getLocalAdminClient } from "../../app/api/adminClient";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import { toast } from "../feedback/Toast";
import {
  closeStationSelector,
  stationSelectorState,
  type StationSelectorTarget,
} from "../../music/hooks/stationSelectorState";

// dispatch the add operation for a given target
async function addTargetToStation(
  client: AdminClient,
  stationId: string,
  target: StationSelectorTarget
): Promise<void> {
  if (target.kind === "songs") {
    for (const songId of target.songIds) {
      await client.dispatchOrThrow("radio_songs_add", {
        station_id: stationId,
        song_id: songId,
      });
    }
  } else if (target.kind === "artist") {
    await client.dispatchOrThrow("radio_filters_add", {
      station_id: stationId,
      filter_type: "artist",
      filter_value: target.artistName,
      mode: "include",
    });
  } else if (target.kind === "album") {
    await client.dispatchOrThrow("radio_filters_add", {
      station_id: stationId,
      filter_type: "album",
      filter_value: target.albumTitle,
      mode: "include",
    });
  } else if (target.kind === "genre") {
    await client.dispatchOrThrow("radio_filters_add", {
      station_id: stationId,
      filter_type: "genre",
      filter_value: target.genreName,
      mode: "include",
    });
  }
}

function targetLabel(target: StationSelectorTarget): string {
  switch (target.kind) {
    case "songs":
      return target.songIds.length === 1 ? "song" : `${target.songIds.length} songs`;
    case "artist":
      return `artist "${target.artistName}"`;
    case "album":
      return `album "${target.albumTitle}"`;
    case "genre":
      return `genre "${target.genreName}"`;
  }
}

export function AddToStationModal() {
  const state = stationSelectorState;

  const [busy, setBusy] = createSignal(false);
  const [resolvedClient, setResolvedClient] = createSignal<AdminClient | null>(null);
  const [remoteName, setRemoteName] = createSignal<string | null>(null);

  // load stations on open — resolves the right admin client (local or remote)
  const [stations] = createResource(
    () => state().isOpen,
    async (isOpen) => {
      setResolvedClient(null);
      setRemoteName(null);
      if (!isOpen) return [];

      let client: AdminClient | null = null;
      const remoteServerId = state().remoteServerId;

      if (remoteServerId) {
        const remote = await getRemoteById(remoteServerId);
        if (!remote) {
          toast.error("could not find remote for this music");
          return [];
        }
        setRemoteName(remote.name);
        try {
          client = await adminClientFor(remote);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "failed to connect to remote");
          return [];
        }
      } else {
        client = getLocalAdminClient();
      }

      if (!client) return [];
      setResolvedClient(client);

      try {
        const data = await client.dispatchOrThrow("radio_stations_list", undefined);
        return (data ?? []) as RadioStation[];
      } catch (e) {
        const msg =
          e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
        toast.error(`failed to load stations: ${msg}`);
        return [];
      }
    }
  );

  // close on Escape
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state().isOpen) closeStationSelector();
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  const handleSelect = async (station: RadioStation) => {
    const target = state().target;
    const client = resolvedClient();
    if (!target || !client) return;
    setBusy(true);
    try {
      await addTargetToStation(client, station.id, target);
      toast.success(`added ${targetLabel(target)} to "${station.name}"`);
      closeStationSelector();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to add to station: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={state().isOpen}>
      {/* backdrop */}
      <div
        class="fixed inset-0 z-[2000] bg-black/60 flex items-center justify-center p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeStationSelector();
        }}
      >
        <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg w-full max-w-md shadow-2xl">
          {/* header */}
          <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
            <h2 class="text-sm font-semibold text-[var(--color-text-primary)]">
              add to station
              <Show when={state().target}>
                {(t) => (
                  <span class="ml-1 font-normal text-[var(--color-text-muted)]">
                    — {targetLabel(t())}
                  </span>
                )}
              </Show>
              <Show when={remoteName()}>
                {(name) => (
                  <span class="ml-1 text-xs font-normal text-[var(--color-text-muted)]">
                    (on {name()})
                  </span>
                )}
              </Show>
            </h2>
            <button
              class="p-1 rounded hover:bg-[var(--color-accent-500)]/10 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              onClick={closeStationSelector}
              aria-label="close"
            >
              ×
            </button>
          </div>

          {/* body */}
          <div class="p-2 max-h-80 overflow-y-auto">
            <Show when={stations.loading}>
              <p class="text-xs text-[var(--color-text-muted)] p-3">loading stations…</p>
            </Show>

            <Show when={!stations.loading && (stations() ?? []).length === 0}>
              <p class="text-xs text-[var(--color-text-muted)] p-3">
                no stations found. create one in settings → radio admin.
              </p>
            </Show>

            <For each={stations() ?? []}>
              {(station) => (
                <button
                  class="w-full text-left flex items-center gap-3 px-3 py-2 rounded hover:bg-[var(--color-accent-500)]/10 transition-colors disabled:opacity-50"
                  onClick={() => handleSelect(station)}
                  disabled={busy()}
                >
                  <div class="w-8 h-8 rounded bg-gradient-to-br from-purple-700 to-indigo-900 flex-shrink-0" />
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {station.name}
                    </div>
                    <Show when={(station as any).description}>
                      <div class="text-xs text-[var(--color-text-muted)] truncate">
                        {(station as any).description}
                      </div>
                    </Show>
                  </div>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </Show>
  );
}

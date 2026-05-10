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

// dispatch the add operation for a given target. every clause is now a
// real filter row keyed by FK id (track / artist / album / genre).
async function addTargetToStation(
  client: AdminClient,
  stationId: string,
  target: StationSelectorTarget
): Promise<void> {
  if (target.kind === "songs") {
    for (const songId of target.songIds) {
      await client.dispatchOrThrow("radio_filters_add", {
        station_id: stationId,
        filter_type: "track",
        filter_value: songId,
        mode: "include",
      });
    }
  } else if (target.kind === "artist") {
    await client.dispatchOrThrow("radio_filters_add", {
      station_id: stationId,
      filter_type: "artist",
      filter_value: target.artistId,
      mode: "include",
    });
  } else if (target.kind === "album") {
    await client.dispatchOrThrow("radio_filters_add", {
      station_id: stationId,
      filter_type: "album",
      filter_value: target.albumId,
      mode: "include",
    });
  } else if (target.kind === "genre") {
    await client.dispatchOrThrow("radio_filters_add", {
      station_id: stationId,
      filter_type: "genre",
      filter_value: target.genreId,
      mode: "include",
    });
  } else if (target.kind === "playlist") {
    await client.dispatchOrThrow("radio_filters_add", {
      station_id: stationId,
      filter_type: "playlist",
      filter_value: target.playlistId,
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
    case "playlist":
      return `playlist "${target.playlistTitle}"`;
  }
}

// suggest a sensible default name for a brand-new station seeded from the
// given target. user can edit before submitting.
function defaultStationName(target: StationSelectorTarget): string {
  switch (target.kind) {
    case "songs":
      return target.songIds.length === 1 ? "new station" : "my mix";
    case "artist":
      return target.artistName;
    case "album":
      return target.albumTitle;
    case "genre":
      return target.genreName;
    case "playlist":
      return target.playlistTitle;
  }
}

export function AddToStationModal() {
  const state = stationSelectorState;

  const [busy, setBusy] = createSignal(false);
  const [resolvedClient, setResolvedClient] = createSignal<AdminClient | null>(null);
  const [remoteName, setRemoteName] = createSignal<string | null>(null);
  // create-new branch state. when `creating` is true the modal swaps
  // its body to a name-input form; the user can still flip back to the
  // station list with the "cancel" button.
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal("");

  const startCreating = () => {
    const t = state().target;
    setNewName(t ? defaultStationName(t) : "new station");
    setCreating(true);
  };
  const cancelCreating = () => {
    setCreating(false);
    setNewName("");
  };

  // load stations on open — resolves the right admin client (local or remote)
  const [stations] = createResource(
    () => state().isOpen,
    async (isOpen) => {
      setResolvedClient(null);
      setRemoteName(null);
      setCreating(false);
      setNewName("");
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

  // create a brand-new station then immediately add the current target
  // to it. on success we close the modal; on failure we keep the user
  // on the create form so they can retry / edit the name.
  const handleCreate = async (e: SubmitEvent) => {
    e.preventDefault();
    const target = state().target;
    const client = resolvedClient();
    if (!target || !client) return;
    const name = newName().trim();
    if (!name) {
      toast.error("station name can't be empty");
      return;
    }
    setBusy(true);
    try {
      const station = (await client.dispatchOrThrow("radio_stations_create", {
        name,
      })) as RadioStation;
      await addTargetToStation(client, station.id, target);
      toast.success(`created station "${station.name}" with ${targetLabel(target)}`);
      closeStationSelector();
    } catch (err) {
      const msg =
        err instanceof AdminCommandError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      toast.error(`failed to create station: ${msg}`);
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
            <Show when={creating()}>
              <form class="p-3 space-y-3" onSubmit={handleCreate}>
                <label class="block text-xs text-[var(--color-text-muted)]">
                  station name
                  <input
                    type="text"
                    class="mt-1 w-full text-sm px-2 py-1.5 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                    value={newName()}
                    onInput={(e) => setNewName(e.currentTarget.value)}
                    autofocus
                    disabled={busy()}
                  />
                </label>
                <Show when={state().target}>
                  {(t) => (
                    <p class="text-xs text-[var(--color-text-muted)]">
                      will add {targetLabel(t())} as the first include filter.
                    </p>
                  )}
                </Show>
                <div class="flex justify-end gap-2">
                  <button
                    type="button"
                    class="px-3 py-1 text-xs rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-500)]/10"
                    onClick={cancelCreating}
                    disabled={busy()}
                  >
                    cancel
                  </button>
                  <button
                    type="submit"
                    class="px-3 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/30 disabled:opacity-50"
                    disabled={busy() || newName().trim().length === 0}
                  >
                    create + add
                  </button>
                </div>
              </form>
            </Show>

            <Show when={!creating()}>
              <Show when={stations.loading}>
                <p class="text-xs text-[var(--color-text-muted)] p-3">loading stations…</p>
              </Show>

              <Show when={!stations.loading && (stations() ?? []).length === 0}>
                <p class="text-xs text-[var(--color-text-muted)] p-3">
                  no stations yet. use "+ new station" below to create one.
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
            </Show>
          </div>

          {/* footer: "+ new station" toggle, hidden while the create form is open. */}
          <Show when={!creating() && !!resolvedClient()}>
            <div class="flex justify-end px-3 py-2 border-t border-[var(--color-border-subtle)]">
              <button
                type="button"
                class="px-2 py-1 text-xs rounded text-[var(--color-accent-400)] hover:bg-[var(--color-accent-500)]/10"
                onClick={startCreating}
                disabled={busy()}
              >
                + new station
              </button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}

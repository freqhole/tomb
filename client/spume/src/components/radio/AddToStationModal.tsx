// modal for adding an artist / album / genre / song(s) / video(s) to a
// radio station's filter criteria (admin-only), AND for submitting a
// member "request" (queue a specific song/video next) to any station
// that has `accepts_requests` set - one shared modal/trigger action for
// both, per the user's explicit preference: don't fork this into two
// separate modals, just show whichever section(s) apply. a non-admin
// caller simply never sees the "add to station" section (its fetch
// fails with a `forbidden` error, handled silently below, NOT a toast -
// that's an expected, common case here, not a real error) - if there
// are also no request-taking stations, the modal is just empty, which is
// fine (nothing for this user to do here).
//
// this is the charnel-mode companion to the RadioAdminView seed editor —
// same admin commands, different entry point.

import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  AdminClient,
  AdminCommandError,
  type PublicStation,
  type RadioStation,
} from "@freqhole/api-client";
import { adminClientFor, getLocalAdminClient } from "../../app/api/adminClient";
import { getClientForRemote } from "../../app/api/client";
import { getCurrentRemote, getDataSource } from "../../music/data";
import { RemoteMusicDataSource } from "../../music/data/remote/remoteSource";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import { tuneIntoRadio } from "../../app/services/radio/radioService";
import type { RemoteRef } from "../../app/services/storage/types";
import { getVideoDataSource } from "../../video/data";
import { toast, type ToastAction } from "../feedback/Toast";
import {
  closeStationSelector,
  stationSelectorState,
  type StationSelectorTarget,
} from "../../music/hooks/stationSelectorState";

interface TuneTarget {
  peerAddr: string;
  isLocal: boolean;
}

// derives tuneIntoRadio's (peerAddr, isLocal) from anything shaped like a
// Remote/CurrentRemoteInfo - both share these same optional field names,
// so no type-guard narrowing is needed. mirrors RadioView.tsx's handleTune
// peer-resolution logic for a `self` source.
function tuneTargetFor(remote: {
  is_charnel_managed?: boolean;
  peer_addr?: string;
  base_url?: string;
}): TuneTarget | null {
  if (remote.is_charnel_managed) return { peerAddr: "self", isLocal: true };
  if (remote.peer_addr) return { peerAddr: remote.peer_addr, isLocal: false };
  if (remote.base_url) return { peerAddr: remote.base_url, isLocal: false };
  return null;
}

// "listen" toast action for a just-added/created/requested station -
// undefined (no action button) when the tune target couldn't be resolved,
// rather than wiring a button that would silently no-op.
function listenAction(
  target: TuneTarget | null,
  stationId: string,
  stationName: string
): ToastAction | undefined {
  if (!target) return undefined;
  return {
    label: "listen",
    onClick: () => {
      void tuneIntoRadio(target.peerAddr, {
        stationId,
        stationName,
        isLocal: target.isLocal,
      });
    },
  };
}

// dispatch the add operation for a given target. every clause is now a
// real filter row keyed by FK id (track / artist / album / taxon / video
// / video_series).
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
    // genreId is a taxon id (taxon kind = "genre") — migration 038
    // renamed the FK column/filter_type from genre_id/"genre" to the
    // kind-agnostic taxon_id/"taxon".
    await client.dispatchOrThrow("radio_filters_add", {
      station_id: stationId,
      filter_type: "taxon",
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
  } else if (target.kind === "video") {
    await client.dispatchOrThrow("radio_filters_add", {
      station_id: stationId,
      filter_type: "video",
      filter_value: target.videoId,
      mode: "include",
    });
  } else if (target.kind === "video_series") {
    await client.dispatchOrThrow("radio_filters_add", {
      station_id: stationId,
      filter_type: "video_series",
      filter_value: target.seriesId,
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
    case "video":
      return `video "${target.videoTitle}"`;
    case "video_series":
      return `series "${target.seriesTitle}"`;
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
    case "video":
      return target.videoTitle;
    case "video_series":
      return target.seriesTitle;
  }
}

// a "request" needs one or more concrete playable items - unambiguous
// for a single song, a video, a series (resolved to its first episode on
// demand below), or a whole album/playlist (queues every song in order).
// skipped for a multi-song selection or a collection/criteria target
// that has no well-defined play order (artist/genre).
function canRequest(target: StationSelectorTarget): boolean {
  if (target.kind === "songs") return target.songIds.length === 1;
  return (
    target.kind === "video" ||
    target.kind === "video_series" ||
    target.kind === "album" ||
    target.kind === "playlist"
  );
}

/** resolves `target` down to the ordered list of song/video ids a
 * request actually queues - only called for a target `canRequest()`
 * already approved. an album/playlist resolves to every one of its
 * songs, in track/playlist order, so they queue and play back-to-back
 * in the right order; every other kind resolves to exactly one item. */
async function resolveRequestItems(
  target: StationSelectorTarget,
  remote: RemoteRef | null
): Promise<{ kind: "song" | "video"; itemId: string }[] | null> {
  if (target.kind === "songs") {
    return target.songIds[0] ? [{ kind: "song", itemId: target.songIds[0] }] : null;
  }
  if (target.kind === "video") {
    return [{ kind: "video", itemId: target.videoId }];
  }
  if (target.kind === "album") {
    try {
      const dataSource = remote ? new RemoteMusicDataSource(remote) : getDataSource();
      const response = await dataSource.getAlbumSongs?.(target.albumId, { limit: 1000 });
      const items = response?.items.map((s) => ({ kind: "song" as const, itemId: s.id })) ?? [];
      return items.length > 0 ? items : null;
    } catch (err) {
      console.error("failed to resolve album songs for a request:", err);
      return null;
    }
  }
  if (target.kind === "playlist") {
    try {
      const dataSource = remote ? new RemoteMusicDataSource(remote) : getDataSource();
      const response = await dataSource.getPlaylistSongs?.(target.playlistId, { limit: 1000 });
      const items = response?.items.map((s) => ({ kind: "song" as const, itemId: s.id })) ?? [];
      return items.length > 0 ? items : null;
    } catch (err) {
      console.error("failed to resolve playlist songs for a request:", err);
      return null;
    }
  }
  if (target.kind === "video_series") {
    try {
      const detail = await getVideoDataSource().getVideoSeriesDetail(target.seriesId);
      if (!detail) return null;
      const first = [...detail.seasons.flatMap((s) => s.videos), ...detail.unassignedVideos][0];
      return first ? [{ kind: "video", itemId: first.id }] : null;
    } catch (err) {
      console.error("failed to resolve series' first episode for a request:", err);
      return null;
    }
  }
  return null;
}

export function AddToStationModal() {
  const state = stationSelectorState;

  const [busy, setBusy] = createSignal(false);
  const [resolvedClient, setResolvedClient] = createSignal<AdminClient | null>(null);
  const [remoteName, setRemoteName] = createSignal<string | null>(null);
  // where the "listen" action on an admin add/create success toast should
  // tune to - derived once alongside `resolvedClient` above (same local vs.
  // remoteServerId branching), not re-resolved per station.
  const [adminTuneTarget, setAdminTuneTarget] = createSignal<TuneTarget | null>(null);
  // stations that accept member requests, for the (possibly non-admin)
  // caller's current remote - fetched via the regular authenticated
  // client, entirely independent of whether the admin fetch below
  // succeeds.
  const [requestStations, setRequestStations] = createSignal<PublicStation[]>([]);
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
      setRequestStations([]);
      setCreating(false);
      setNewName("");
      setAdminTuneTarget(null);
      if (!isOpen) return [];

      const remoteServerId = state().remoteServerId;
      // request-taking-station lookup is happy with the lighter
      // `getCurrentRemote()` shape (only `getClientForRemote` needs it),
      // but the admin flow below needs the full `Remote` record (only
      // `getRemoteById` returns one) - kept as two separate lookups
      // rather than one shared variable so each stays correctly typed.
      const requestRemote = remoteServerId
        ? await getRemoteById(remoteServerId)
        : getCurrentRemote();

      // request-taking stations: always attempted via the regular
      // (non-admin) client, regardless of whether the caller is an
      // admin - any authenticated member can request.
      const target = state().target;
      if (requestRemote && target && canRequest(target)) {
        try {
          const regularClient = await getClientForRemote(requestRemote);
          const result = await regularClient.app.radioStationsFull();
          if (result.success) {
            setRequestStations(result.data.stations.filter((s) => s.accepts_requests));
          }
        } catch (err) {
          // non-fatal: request-taking stations are a bonus section, and
          // a failure here (e.g. offline remote) shouldn't block the
          // admin section below from still rendering.
          console.error("failed to load request-taking stations:", err);
        }
      }

      let client: AdminClient | null = null;
      if (remoteServerId) {
        const remote = await getRemoteById(remoteServerId);
        if (!remote) {
          toast.error("could not find remote for this music");
          return [];
        }
        setRemoteName(remote.name);
        setAdminTuneTarget(tuneTargetFor(remote));
        try {
          // charnel-managed self is an HTTP-only remote record (no
          // peer_addr) representing "the local library" - route it
          // through the in-process admin transport instead of
          // adminClientFor, which rejects non-P2P remotes.
          client = remote.is_charnel_managed ? getLocalAdminClient() : await adminClientFor(remote);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "failed to connect to remote");
          return [];
        }
      } else {
        client = getLocalAdminClient();
        setAdminTuneTarget({ peerAddr: "self", isLocal: true });
      }

      if (!client) return [];
      setResolvedClient(client);

      try {
        const data = await client.dispatchOrThrow("radio_stations_list", undefined);
        return (data ?? []) as RadioStation[];
      } catch (e) {
        // "forbidden" here just means "this caller isn't an admin" - a
        // common, expected case for any non-admin member opening this
        // modal, not a real error. silently treat as "no admin stations
        // to show" (the request-taking section above may still have
        // something) rather than surfacing a confusing error toast.
        if (e instanceof AdminCommandError && e.errorType === "forbidden") {
          setResolvedClient(null);
          return [];
        }
        const msg =
          e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
        toast.error(`failed to load stations: ${msg}`);
        return [];
      }
    }
  );

  // admin "add to station" (persistent filter criteria) section
  // deliberately excludes any station that accepts member requests -
  // otherwise an admin who's ALSO a member sees the same
  // accepts_requests station listed twice (once per section here, for
  // the same underlying station). requests already have their own
  // dedicated section below; admins can still manage a request
  // station's filter criteria from the station settings/admin view,
  // just not from this shared modal.
  const filterableStations = createMemo(() =>
    (stations() ?? []).filter((s) => !s.accepts_requests)
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
      toast.success(`added ${targetLabel(target)} to "${station.name}"`, {
        action: listenAction(adminTuneTarget(), station.id, station.name),
      });
      closeStationSelector();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to add to station: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  // submit a member request (queue a specific song/video, or every song
  // in an album back-to-back, next) to a station that accepts them -
  // regular authenticated client, not AdminClient (see the module doc
  // comment at the top of this file).
  const handleRequestSelect = async (station: PublicStation) => {
    const target = state().target;
    const remoteServerId = state().remoteServerId;
    if (!target) return;
    const remote = remoteServerId ? await getRemoteById(remoteServerId) : getCurrentRemote();
    if (!remote) return;

    const items = await resolveRequestItems(target, remote);
    if (!items || items.length === 0) {
      toast.error("could not resolve an item to request");
      return;
    }

    setBusy(true);
    try {
      const client = await getClientForRemote(remote);
      let submitted = 0;
      for (const item of items) {
        // awaited one at a time (not Promise.all) so multi-item targets
        // (an album) land in the station's FIFO queue in track order.
        const result = await client.app.radioSubmitRequest({
          station_id: station.station_id,
          kind: item.kind,
          item_id: item.itemId,
        });
        if (result.success) {
          submitted += 1;
        } else if (items.length === 1) {
          const msg = result.error.issues[0]?.message || "failed to submit request";
          toast.error(msg);
          return;
        }
        // for a multi-item (album) request, one failed song shouldn't
        // abort the rest - just tally it and keep going.
      }
      if (submitted === 0) {
        toast.error("failed to submit request");
        return;
      }
      const label =
        items.length > 1
          ? `${submitted}/${items.length} songs from ` + targetLabel(target)
          : targetLabel(target);
      toast.success(`requested ${label} on "${station.name}"`, {
        action: listenAction(tuneTargetFor(remote), station.station_id, station.name),
      });
      closeStationSelector();
    } catch (e) {
      toast.error(`failed to submit request: ${e instanceof Error ? e.message : String(e)}`);
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
      toast.success(`created station "${station.name}" with ${targetLabel(target)}`, {
        action: listenAction(adminTuneTarget(), station.id, station.name),
      });
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

              <Show when={!stations.loading}>
                <Show when={filterableStations().length > 0}>
                  <div class="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                    add to station
                  </div>
                  <For each={filterableStations()}>
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

                <Show when={requestStations().length > 0}>
                  <div class="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                    request on station
                  </div>
                  <For each={requestStations()}>
                    {(station) => (
                      <button
                        class="w-full text-left flex items-center gap-3 px-3 py-2 rounded hover:bg-[var(--color-accent-500)]/10 transition-colors disabled:opacity-50"
                        onClick={() => handleRequestSelect(station)}
                        disabled={busy()}
                      >
                        <div class="w-8 h-8 rounded bg-gradient-to-br from-emerald-700 to-teal-900 flex-shrink-0" />
                        <div class="flex-1 min-w-0">
                          <div class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {station.name}
                          </div>
                        </div>
                      </button>
                    )}
                  </For>
                </Show>

                <Show when={filterableStations().length === 0 && requestStations().length === 0}>
                  <p class="text-xs text-[var(--color-text-muted)] p-3">
                    no stations available for this item.
                  </p>
                </Show>
              </Show>
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

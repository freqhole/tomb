// storage overview view - summary of the active removable-storage sync
// device (phases 1, 3 + 6 of docs/removable-storage-sync-plan.md, tomb
// repo).
//
// device identity, mount status + eject, disk free/used/total space
// (phase 1); one always-visible "default" rule-based filter-set per
// device (phase 6, simplified from an earlier multi-named-filter-set
// design) syncs as a `.m3u8` manifest, additive-only (phase 3). the
// device card also shows actual-vs-projected song counts (songs already
// copied vs. what the current filter clauses currently match, segmented
// by group) plus the last sync's result/errors.
import { createEffect, createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  isCharnelMode,
  listMountedExternalStorageDevices,
  getActiveExternalStorageDevice,
  getExternalStorageDiskUsage,
  ejectExternalStorageDevice,
  setActiveExternalStorageDevice,
  syncPlaylistsToDevice,
  pauseExternalStorageSync,
  getOrCreateDefaultFilterSet,
  getSyncedSongCount,
  getFilterSetProjection,
  estimateSyncSize,
  openSetupWizard,
  onExternalStorageMountedChanged,
  setExternalStorageSyncing,
  externalStorageSyncProgressSignal,
  type ExternalStorageDevice,
  type DiskUsageResult,
  type SyncPlaylistsResult,
  type SyncSizeEstimate,
  type FilterSet,
  type FilterSetProjection,
} from "../../app/services/charnel";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { formatBytes } from "../../settings/services/storageManager";
import { formatRelativeTime } from "../../utils/dateTime";
import { FilterSetManager } from "../components/FilterSetManager";

export function StorageOverviewView() {
  const navigate = useNavigate();
  const [device, setDevice] = createSignal<ExternalStorageDevice | null>(null);
  const [mountedDevices, setMountedDevices] = createSignal<ExternalStorageDevice[]>([]);
  const [switchingDevice, setSwitchingDevice] = createSignal(false);
  const [diskUsage, setDiskUsage] = createSignal<DiskUsageResult | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [defaultFilterSet, setDefaultFilterSet] = createSignal<FilterSet | null>(null);
  const [ejecting, setEjecting] = createSignal(false);
  const [syncing, setSyncing] = createSignal(false);
  const [pausing, setPausing] = createSignal(false);
  const [syncResult, setSyncResult] = createSignal<SyncPlaylistsResult | null>(null);
  // per-song sync progress now lives in a shared signal (see
  // `externalStorageSyncProgressSignal`) set globally by `AppLayout.tsx`,
  // so the playerbar icon keeps showing it even after navigating away.
  // "actual" (already copied to the device) vs "projected" (what the
  // current filter-set clauses currently match) song counts - see
  // `refreshStats`.
  const [syncedSongCount, setSyncedSongCount] = createSignal<number | null>(null);
  const [filterProjection, setFilterProjection] = createSignal<FilterSetProjection | null>(null);
  // best-effort "would this fit" estimate, refreshed alongside the stats
  // above - drives a heads-up warning before the device fills up.
  const [sizeEstimate, setSizeEstimate] = createSignal<SyncSizeEstimate | null>(null);
  // tracks whether we've ever actually shown an active device, so we can
  // tell "never had one" apart from "had one, then it got unmounted".
  let hadActiveDevice = false;

  // re-fetches both halves of the actual-vs-projected songs display, plus
  // the size estimate - called after initial load, after any filter
  // clause add/remove (via `FilterSetManager`'s `onFiltersChanged`), and
  // after a sync completes.
  const refreshStats = async () => {
    const active = device();
    const filterSet = defaultFilterSet();
    setSyncedSongCount(active ? await getSyncedSongCount(active.id) : null);
    setFilterProjection(filterSet ? await getFilterSetProjection(filterSet.id) : null);
    setSizeEstimate(active && filterSet ? await estimateSyncSize(active.id, [filterSet.id]) : null);
  };

  const refresh = async () => {
    try {
      const [active, mounted] = await Promise.all([
        getActiveExternalStorageDevice(),
        listMountedExternalStorageDevices(),
      ]);
      if (hadActiveDevice && !active) {
        // the device we were showing just disappeared - nothing left to
        // show here, so back out rather than sitting on a stale view.
        navigate(-1);
        return;
      }
      if (active) {
        hadActiveDevice = true;
      }
      setDevice(active);
      setMountedDevices(mounted);
      if (active) {
        setDiskUsage(await getExternalStorageDiskUsage(active.id));
        setDefaultFilterSet(await getOrCreateDefaultFilterSet(active.id));
      } else {
        setDiskUsage(null);
        setDefaultFilterSet(null);
      }
      await refreshStats();
      setError(null);
    } catch (err) {
      console.error("[StorageOverviewView] failed to load storage overview:", err);
      setError("failed to load storage overview");
    } finally {
      setLoading(false);
    }
  };

  const syncNow = async () => {
    const active = device();
    const filterSet = defaultFilterSet();
    if (!active || !filterSet) return;
    setSyncing(true);
    setExternalStorageSyncing(true);
    setPausing(false);
    setSyncResult(null);
    try {
      const result = await syncPlaylistsToDevice(active.id, [filterSet.id]);
      setSyncResult(result);
      await refreshStats();
    } finally {
      setSyncing(false);
      setExternalStorageSyncing(false);
      setPausing(false);
    }
  };

  const pauseSync = async () => {
    const active = device();
    if (!active || !syncing() || pausing()) return;
    setPausing(true);
    await pauseExternalStorageSync(active.id);
    // the in-progress `syncNow()` call above resolves on its own once the
    // rust side notices the pause request - nothing else to do here.
  };

  const switchActiveDevice = async (id: string) => {
    if (switchingDevice() || id === device()?.id) return;
    setSwitchingDevice(true);
    try {
      await setActiveExternalStorageDevice(id);
      await refresh();
    } finally {
      setSwitchingDevice(false);
    }
  };

  const eject = async () => {
    const active = device();
    if (!active || ejecting()) return;
    setEjecting(true);
    try {
      await ejectExternalStorageDevice(active.id);
      // the background mount watcher detects the unmount and this view's
      // `onExternalStorageMountedChanged` listener triggers `refresh()`,
      // which handles navigating away once the device disappears.
    } finally {
      setEjecting(false);
    }
  };

  onMount(() => {
    void refresh();
    void (async () => {
      const unlisten = await onExternalStorageMountedChanged(() => void refresh());
      onCleanup(() => unlisten());
    })();
  });

  createEffect(() => {
    setPageInfo({ title: "removable storage" });
  });
  onCleanup(() => clearPageInfo());

  return (
    <div class="h-full overflow-y-auto p-6">
      <div class="max-w-2xl mx-auto">
        {/* no in-view title/subtitle here - just reserved space so the
            floating top nav (title now comes from setPageInfo above) has
            room above the card. */}
        <div class="mb-6 h-10" />

        <Show when={!isCharnelMode()}>
          <div class="mb-4 p-3 bg-yellow-600/20 border border-yellow-600/30 rounded-lg text-sm text-yellow-400">
            removable-storage sync is only available in the desktop app.
          </div>
        </Show>

        <Show when={error()}>
          <div class="mb-4 p-3 bg-red-600/20 border border-red-600/30 rounded-lg text-sm text-red-400">
            {error()}
          </div>
        </Show>

        <Show when={loading()}>
          <div class="flex items-center justify-center py-12">
            <div class="animate-spin w-6 h-6 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
            <span class="ml-3 text-[var(--color-text-muted)]">loading...</span>
          </div>
        </Show>

        <Show when={!loading() && !device()}>
          <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-text-muted)]">
            <Show
              when={mountedDevices().length > 0}
              fallback={<span>no removable device is currently plugged in.</span>}
            >
              <span>
                {mountedDevices().length} device{mountedDevices().length === 1 ? "" : "s"} mounted,
                but none selected as active yet.
              </span>
            </Show>
            <div class="mt-3">
              <button
                class="text-xs text-[var(--color-accent-500)] hover:underline"
                onClick={() => void openSetupWizard("/settings")}
              >
                go to removable storage settings
              </button>
            </div>
          </div>
        </Show>

        <Show when={!loading() && device()}>
          {(activeDevice) => (
            <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg">
              <Show when={mountedDevices().length > 1}>
                <div class="mb-4">
                  <label class="block text-xs text-[var(--color-text-muted)] mb-1">
                    active device ({mountedDevices().length} plugged in)
                  </label>
                  <select
                    class="w-full text-sm px-2 py-1.5 rounded-md bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] disabled:opacity-50"
                    disabled={switchingDevice()}
                    value={activeDevice().id}
                    onChange={(e) => void switchActiveDevice(e.currentTarget.value)}
                  >
                    <For each={mountedDevices()}>
                      {(candidate) => (
                        <option value={candidate.id}>
                          {candidate.volume_name || candidate.path}
                        </option>
                      )}
                    </For>
                  </select>
                </div>
              </Show>
              <div class="flex items-center justify-between mb-4">
                <div>
                  <div class="text-[var(--color-text-primary)] font-medium">
                    {activeDevice().volume_name || activeDevice().path}
                  </div>
                  <div class="text-xs text-[var(--color-text-muted)] font-mono">
                    {activeDevice().path}
                    {activeDevice().subpath ? `/${activeDevice().subpath}` : ""}
                  </div>
                </div>
                <button
                  class="text-xs px-2 py-1 rounded-full bg-red-600/20 hover:bg-red-600/30 text-red-400 disabled:opacity-50"
                  disabled={ejecting()}
                  onClick={() => void eject()}
                >
                  {ejecting() ? "ejecting..." : "eject"}
                </button>
              </div>

              <Show
                when={diskUsage()}
                fallback={
                  <div class="text-xs text-[var(--color-text-muted)]">
                    disk space info unavailable
                  </div>
                }
              >
                {(usage) => (
                  <div class="space-y-2">
                    <div class="w-full h-2 rounded-full bg-[var(--color-bg-tertiary)] overflow-hidden">
                      <div
                        class="h-full bg-[var(--color-accent-500)]"
                        style={{
                          width: `${Math.min(100, (usage().used_bytes / Math.max(1, usage().total_bytes)) * 100)}%`,
                        }}
                      />
                    </div>
                    <div class="flex justify-between text-xs text-[var(--color-text-muted)]">
                      <span>{formatBytes(usage().used_bytes)} used</span>
                      <span>{formatBytes(usage().free_bytes)} free</span>
                      <span>{formatBytes(usage().total_bytes)} total</span>
                    </div>
                  </div>
                )}
              </Show>

              <div class="mt-4 pt-4 border-t border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)] space-y-2">
                <div class="flex items-center justify-between">
                  <span>on this device</span>
                  <span class="text-[var(--color-text-primary)] font-medium tabular-nums">
                    {syncedSongCount() !== null
                      ? `${syncedSongCount()} song${syncedSongCount() === 1 ? "" : "s"}`
                      : "\u2013"}
                  </span>
                </div>

                <Show when={filterProjection()}>
                  {(projection) => (
                    <div>
                      <div class="flex items-center justify-between">
                        <span>current filters match</span>
                        <span class="text-[var(--color-text-primary)] font-medium tabular-nums">
                          {projection().total_song_count} song
                          {projection().total_song_count === 1 ? "" : "s"}
                        </span>
                      </div>
                      <Show when={projection().groups.length > 1}>
                        <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          <For each={projection().groups}>
                            {(group) => (
                              <span>
                                {group.name}: {group.song_count}
                              </span>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>

                <div>
                  last synced:{" "}
                  {activeDevice().last_synced_at
                    ? formatRelativeTime(activeDevice().last_synced_at!)
                    : "never"}
                </div>

                <Show when={syncResult()}>
                  {(result) => (
                    <div class="pt-2 border-t border-[var(--color-border-subtle)] space-y-2">
                      <Show
                        when={result().low_disk_space}
                        fallback={
                          <Show when={result().paused}>
                            <div class="text-[var(--color-text-primary)]">
                              sync paused - click "sync now" again to resume.
                            </div>
                          </Show>
                        }
                      >
                        <div class="text-yellow-400">
                          stopped: the device is almost full - free up space then re-run the sync
                          again to continue.
                        </div>
                      </Show>
                      <For each={result().synced}>
                        {(outcome) => (
                          <div>
                            <div>
                              {outcome.title}: {outcome.song_count} song
                              {outcome.song_count === 1 ? "" : "s"} synced
                              <Show when={outcome.failed_songs.length > 0}>
                                <span class="text-red-400">
                                  {" "}
                                  ({outcome.failed_songs.length} failed)
                                </span>
                              </Show>
                            </div>
                            <Show when={outcome.failed_songs.length > 0}>
                              <ul class="ml-3 mt-1 list-disc text-red-400/80">
                                <For each={outcome.failed_songs}>
                                  {(reason) => <li>{reason}</li>}
                                </For>
                              </ul>
                            </Show>
                          </div>
                        )}
                      </For>
                      <Show when={result().removed.length > 0}>
                        <div>removed: {result().removed.join(", ")}</div>
                      </Show>
                    </div>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>

        <Show when={!loading() && device() && defaultFilterSet()}>
          {(filterSet) => (
            <div class="mt-4 p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg">
              <div class="flex items-center justify-between mb-3">
                <div class="text-sm font-medium text-[var(--color-text-primary)]">&nbsp;</div>
                <div class="flex items-center gap-2">
                  <Show when={syncing()}>
                    <button
                      class="text-xs px-3 py-1.5 rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] disabled:opacity-50"
                      disabled={pausing()}
                      onClick={() => void pauseSync()}
                    >
                      {pausing() ? "pausing..." : "pause"}
                    </button>
                  </Show>
                  <button
                    class="text-xs px-3 py-1.5 rounded-full bg-[var(--color-accent-500)] text-white disabled:opacity-50"
                    disabled={syncing()}
                    onClick={() => void syncNow()}
                  >
                    {syncing() ? "syncing..." : "sync now"}
                  </button>
                </div>
              </div>

              <Show when={syncing() && externalStorageSyncProgressSignal()}>
                {(progress) => (
                  <div class="mb-3 p-3 rounded-lg bg-[var(--color-accent-500)]/10 border border-[var(--color-accent-500)]/30">
                    <div class="flex items-center justify-between mb-1.5">
                      <span class="text-sm font-semibold text-[var(--color-accent-500)]">
                        syncing {progress().title}...
                      </span>
                      <span class="text-sm font-semibold text-[var(--color-accent-500)] tabular-nums">
                        {progress().current}/{progress().total}
                      </span>
                    </div>
                    <div class="w-full h-2 rounded-full bg-[var(--color-bg-tertiary)] overflow-hidden">
                      <div
                        class="h-full bg-[var(--color-accent-500)] transition-[width]"
                        style={{
                          width: `${Math.min(100, (progress().current / Math.max(1, progress().total)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </Show>

              <Show
                when={
                  !syncing() &&
                  sizeEstimate() &&
                  sizeEstimate()!.available_bytes !== null &&
                  sizeEstimate()!.needed_bytes > sizeEstimate()!.available_bytes!
                }
              >
                <div class="mb-3 p-3 rounded-lg bg-yellow-600/10 border border-yellow-600/30 text-xs text-yellow-400">
                  ohey! syncing needs an estimated {formatBytes(sizeEstimate()!.needed_bytes)} for{" "}
                  {sizeEstimate()!.pending_song_count} new/changed song
                  {sizeEstimate()!.pending_song_count === 1 ? "" : "s"}, but only{" "}
                  {formatBytes(sizeEstimate()!.available_bytes!)} is free - sync may stop before
                  everything fitz.
                </div>
              </Show>

              <FilterSetManager filterSetId={filterSet().id} onFiltersChanged={refreshStats} />
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

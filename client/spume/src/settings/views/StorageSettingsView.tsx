// storage settings view - displays storage usage and provides clear options
import { createSignal, onMount, Show, For } from "solid-js";
import {
  getStorageBreakdown,
  clearCacheApiData,
  clearOPFSData,
  clearMusicDbData,
  clearAllData,
  formatBytes,
  type StorageBreakdown,
} from "../services/storageManager";
import {
  shouldEnableServiceWorker,
  swVersion,
  clearServiceWorkerCaches,
  checkForUpdates,
  forceRefresh,
} from "../../app/services/serviceWorker";
import { isTauriMode } from "../../utils/tauri";
import {
  getAllRemoteCacheStats,
  clearBlobCache,
  type RemoteCacheStats,
} from "../../music/services/cache/blobCache";
import { getAllRemotes } from "../../app/services/remotes/remoteManager";
import type { Remote } from "../../app/services/storage/types";

// confirmation dialog component
function ConfirmDialog(props: {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
          <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{props.title}</h3>
          <p class="text-sm text-[var(--color-text-secondary)] mb-6">{props.message}</p>
          <div class="flex gap-3 justify-end">
            <button
              class="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
              onClick={props.onCancel}
            >
              cancel
            </button>
            <button
              class={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                props.confirmDanger
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-black"
              }`}
              onClick={props.onConfirm}
            >
              {props.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

// storage category card component
function StorageCard(props: {
  title: string;
  icon: string;
  size: number;
  details?: { label: string; value: string }[];
  onClear?: () => void;
  clearLabel?: string;
  clearDanger?: boolean;
  loading?: boolean;
}) {
  return (
    <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-4">
      <div class="flex items-start justify-between mb-3">
        <div class="flex items-center gap-2">
          <span class="text-xl">{props.icon}</span>
          <h3 class="text-sm font-medium text-[var(--color-text-primary)]">{props.title}</h3>
        </div>
        <span class="text-lg font-semibold text-[var(--color-text-primary)]">
          {formatBytes(props.size)}
        </span>
      </div>

      <Show when={props.details && props.details.length > 0}>
        <div class="space-y-1 mb-4">
          <For each={props.details}>
            {(detail) => (
              <div class="flex justify-between text-xs">
                <span class="text-[var(--color-text-muted)]">{detail.label}</span>
                <span class="text-[var(--color-text-secondary)]">{detail.value}</span>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={props.onClear}>
        <button
          class={`w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            props.clearDanger
              ? "bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30"
              : "bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]"
          }`}
          onClick={props.onClear}
          disabled={props.loading}
        >
          {props.loading ? "clearing..." : props.clearLabel || "clear"}
        </button>
      </Show>
    </div>
  );
}

export function StorageSettingsView() {
  const [breakdown, setBreakdown] = createSignal<StorageBreakdown | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [clearing, setClearing] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [persistentStorage, setPersistentStorage] = createSignal<boolean | null>(null);
  const [swCacheSize, setSwCacheSize] = createSignal<number>(0);
  const [checkingUpdates, setCheckingUpdates] = createSignal(false);
  const [updateCheckResult, setUpdateCheckResult] = createSignal<string | null>(null);
  // per-remote cache stats
  const [remoteCacheStats, setRemoteCacheStats] = createSignal<RemoteCacheStats[]>([]);
  const [remotes, setRemotes] = createSignal<Remote[]>([]);
  const [clearingRemoteCache, setClearingRemoteCache] = createSignal<string | null>(null);

  // confirmation dialog state
  const [confirmDialog, setConfirmDialog] = createSignal<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    confirmDanger: boolean;
    action: () => Promise<void>;
  }>({
    isOpen: false,
    title: "",
    message: "",
    confirmLabel: "",
    confirmDanger: false,
    action: async () => {},
  });

  const refreshBreakdown = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getStorageBreakdown();
      setBreakdown(data);

      // check persistent storage status
      if ("storage" in navigator && "persisted" in navigator.storage) {
        const persisted = await navigator.storage.persisted();
        setPersistentStorage(persisted);
      }

      // estimate SW cache size
      if (shouldEnableServiceWorker()) {
        const cacheNames = await caches.keys();
        const swCaches = cacheNames.filter((name) => name.startsWith("freqhole-"));
        let totalSize = 0;
        for (const cacheName of swCaches) {
          const cache = await caches.open(cacheName);
          const keys = await cache.keys();
          for (const request of keys) {
            const response = await cache.match(request);
            if (response) {
              const blob = await response.clone().blob();
              totalSize += blob.size;
            }
          }
        }
        setSwCacheSize(totalSize);
      }

      // fetch per-remote cache stats
      const [stats, allRemotes] = await Promise.all([getAllRemoteCacheStats(), getAllRemotes()]);
      setRemoteCacheStats(stats);
      setRemotes(allRemotes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load storage info");
    } finally {
      setLoading(false);
    }
  };

  const handleClearRemoteCache = async (remoteId: string) => {
    setClearingRemoteCache(remoteId);
    try {
      await clearBlobCache(remoteId);
      // refresh stats
      const stats = await getAllRemoteCacheStats();
      setRemoteCacheStats(stats);
      // also refresh overall breakdown
      const data = await getStorageBreakdown();
      setBreakdown(data);
    } finally {
      setClearingRemoteCache(null);
    }
  };

  onMount(() => {
    refreshBreakdown();
  });

  const showConfirmDialog = (
    title: string,
    message: string,
    confirmLabel: string,
    confirmDanger: boolean,
    action: () => Promise<void>
  ) => {
    setConfirmDialog({
      isOpen: true,
      title,
      message,
      confirmLabel,
      confirmDanger,
      action,
    });
  };

  const handleConfirm = async () => {
    const dialog = confirmDialog();
    setConfirmDialog({ ...dialog, isOpen: false });

    try {
      await dialog.action();
      await refreshBreakdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "operation failed");
    }
  };

  const handleClearCache = () => {
    showConfirmDialog(
      "clear cache data",
      "this will delete all cached remote audio and images. you'll need to re-download them when accessed. local files are not affected.",
      "clear cache",
      false,
      async () => {
        setClearing("cache");
        await clearCacheApiData();
        setClearing(null);
      }
    );
  };

  const handleClearOPFS = () => {
    showConfirmDialog(
      "clear local files",
      "this will delete all locally stored audio files and thumbnails from OPFS. library metadata will remain, but audio files will need to be re-imported.",
      "clear local files",
      true,
      async () => {
        setClearing("opfs");
        await clearOPFSData();
        setClearing(null);
      }
    );
  };

  const handleClearMusicDb = () => {
    showConfirmDialog(
      "clear music library",
      "this will delete the entire music library database including all songs, albums, artists, playlists, favorites, and ratings. audio files in OPFS will remain but be orphaned. THIS IS ONLY THE DATA IN YOUR BROWSER!",
      "clear library",
      true,
      async () => {
        setClearing("musicdb");
        await clearMusicDbData();
        setClearing(null);
      }
    );
  };

  const handleClearSwCache = () => {
    showConfirmDialog(
      "clear app cache",
      "this will delete the cached app files used for offline access. the app will re-download them on next visit.",
      "clear app cache",
      false,
      async () => {
        setClearing("swcache");
        await clearServiceWorkerCaches();
        setClearing(null);
      }
    );
  };

  const handleCheckForUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateCheckResult(null);
    try {
      const hasUpdate = await checkForUpdates();
      setUpdateCheckResult(hasUpdate ? "update available!" : "already on latest version");
    } catch {
      setUpdateCheckResult("failed to check for updates");
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleForceRefresh = () => {
    showConfirmDialog(
      "force refresh",
      "this will clear all cached app files and reload the page to get the latest version.",
      "refresh",
      false,
      async () => {
        await forceRefresh();
      }
    );
  };

  const handleClearAll = () => {
    showConfirmDialog(
      "delete everything",
      "this will permanently delete ALL freqhole data: the music library, playlists, favorites, cached files, local audio files, and app settings. this action cannot be undone. the page will reload after clearing.",
      "DELETE EVERYTHING",
      true,
      async () => {
        setClearing("all");
        await clearAllData();
        setClearing(null);
        // reload the page to reinitialize everything
        window.location.reload();
      }
    );
  };

  return (
    <div class="p-6 max-w-2xl mx-auto">
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-[var(--color-text-primary)] mb-1">storage</h1>
        <p class="text-sm text-[var(--color-text-muted)]">manage local storage used by freqhole</p>
      </div>

      {/* error display */}
      <Show when={error()}>
        <div class="mb-4 p-3 bg-red-600/20 border border-red-600/30 rounded-lg text-sm text-red-400">
          {error()}
        </div>
      </Show>

      {/* loading state */}
      <Show when={loading() && !breakdown()}>
        <div class="flex items-center justify-center py-12">
          <div class="animate-spin w-6 h-6 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
          <span class="ml-3 text-[var(--color-text-muted)]">analyzing storage...</span>
        </div>
      </Show>

      {/* storage breakdown */}
      <Show when={breakdown()}>
        {(data) => (
          <>
            {/* app info section */}
            <div class="mb-6 p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg">
              <div class="flex flex-wrap gap-x-6 gap-y-2 text-xs mb-4">
                {/* app version */}
                <div class="flex items-center gap-2">
                  <span class="text-[var(--color-text-muted)]">version:</span>
                  <span class="text-[var(--color-text-secondary)] font-mono">
                    {import.meta.env.DEV ? "dev" : (swVersion() ?? __APP_VERSION__)}
                  </span>
                </div>

                {/* persistent storage status */}
                <Show when={!isTauriMode() && persistentStorage() !== null}>
                  <div class="flex items-center gap-2">
                    <span class="text-[var(--color-text-muted)]">persistent storage:</span>
                    <span class={`${persistentStorage() ? "text-green-400" : "text-yellow-400"}`}>
                      {persistentStorage() ? "granted" : "not granted"}
                    </span>
                  </div>
                </Show>

                {/* mode */}
                <div class="flex items-center gap-2">
                  <span class="text-[var(--color-text-muted)]">mode:</span>
                  <span class="text-[var(--color-text-secondary)]">
                    {import.meta.env.DEV ? "development" : isTauriMode() ? "desktop" : "web"}
                  </span>
                </div>
              </div>

              {/* update controls (only in prod web mode) */}
              <Show when={shouldEnableServiceWorker()}>
                <div class="flex flex-wrap gap-2 items-center">
                  <button
                    class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors disabled:opacity-50"
                    onClick={handleCheckForUpdates}
                    disabled={checkingUpdates()}
                  >
                    {checkingUpdates() ? "checking..." : "check for updates"}
                  </button>
                  <button
                    class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors"
                    onClick={handleForceRefresh}
                  >
                    force refresh
                  </button>
                  <Show when={updateCheckResult()}>
                    <span class="text-xs text-[var(--color-text-muted)]">
                      {updateCheckResult()}
                    </span>
                  </Show>
                </div>
              </Show>
            </div>

            {/* overall usage bar */}
            <div class="mb-6 p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg">
              <div class="flex justify-between items-center mb-2">
                <span class="text-sm text-[var(--color-text-secondary)]">total storage used</span>
                <span class="text-sm font-medium text-[var(--color-text-primary)]">
                  {formatBytes(data().total.usage)} / {formatBytes(data().total.quota)}
                </span>
              </div>
              <div class="h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
                <div
                  class={`h-full transition-all ${
                    data().total.percentUsed > 90
                      ? "bg-red-500"
                      : data().total.percentUsed > 70
                        ? "bg-yellow-500"
                        : "bg-[var(--color-accent-500)]"
                  }`}
                  style={{ width: `${Math.min(data().total.percentUsed, 100)}%` }}
                />
              </div>
              <div class="mt-1 text-xs text-[var(--color-text-muted)]">
                {data().total.percentUsed}% used
              </div>
            </div>

            {/* storage category cards */}
            <div class="grid gap-4 mb-6">
              {/* service worker cache (only in prod web mode) */}
              <Show when={shouldEnableServiceWorker()}>
                <StorageCard
                  title="app cache (offline)"
                  icon=""
                  size={swCacheSize()}
                  details={[{ label: "cached for offline use", value: "" }]}
                  onClear={handleClearSwCache}
                  clearLabel="clear app cache"
                  loading={clearing() === "swcache"}
                />
              </Show>

              {/* cache api */}
              <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-4">
                <div class="flex items-start justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <span class="text-xl"></span>
                    <h3 class="text-sm font-medium text-[var(--color-text-primary)]">
                      remote cache
                    </h3>
                  </div>
                  <span class="text-lg font-semibold text-[var(--color-text-primary)]">
                    {formatBytes(data().cacheApi.size)}
                  </span>
                </div>

                <div class="space-y-1 mb-4">
                  <div class="flex justify-between text-xs">
                    <span class="text-[var(--color-text-muted)]">cached items</span>
                    <span class="text-[var(--color-text-secondary)]">
                      {data().cacheApi.entryCount}
                    </span>
                  </div>
                </div>

                {/* per-remote breakdown */}
                <Show when={remoteCacheStats().length > 0}>
                  <div class="border-t border-[var(--color-border-subtle)] pt-3 mb-4">
                    <div class="text-xs text-[var(--color-text-muted)] mb-2">
                      per-remote breakdown
                    </div>
                    <div class="space-y-2">
                      <For each={remoteCacheStats().filter((s) => s.totalSize > 0)}>
                        {(stats) => {
                          const remote = remotes().find((r) => r.remote_id === stats.remoteId);
                          const remoteName = remote?.name || stats.remoteId.slice(0, 8) + "...";
                          return (
                            <div class="flex items-center justify-between text-xs">
                              <div class="flex items-center gap-2 min-w-0 flex-1">
                                <span class="text-[var(--color-text-secondary)] truncate">
                                  {remoteName}
                                </span>
                                <span class="text-[var(--color-text-muted)]">
                                  ({stats.audioCount} audio, {stats.imageCount} images)
                                </span>
                              </div>
                              <div class="flex items-center gap-2 shrink-0">
                                <span class="text-[var(--color-text-secondary)]">
                                  {formatBytes(stats.totalSize)}
                                </span>
                                <button
                                  class="text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] disabled:opacity-50"
                                  onClick={() => handleClearRemoteCache(stats.remoteId)}
                                  disabled={clearingRemoteCache() === stats.remoteId}
                                >
                                  {clearingRemoteCache() === stats.remoteId ? "..." : "clear"}
                                </button>
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                </Show>

                <button
                  class="w-full px-3 py-2 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]"
                  onClick={handleClearCache}
                  disabled={clearing() === "cache"}
                >
                  {clearing() === "cache" ? "clearing..." : "clear all cached data"}
                </button>
              </div>

              {/* opfs */}
              <StorageCard
                title="local files (OPFS)"
                icon=""
                size={data().opfs.size}
                details={[
                  {
                    label: "audio files",
                    value: `${data().opfs.audioCount} (${formatBytes(data().opfs.audioSize)})`,
                  },
                  {
                    label: "thumbnails",
                    value: `${data().opfs.thumbnailCount} (${formatBytes(data().opfs.thumbnailsSize)})`,
                  },
                ]}
                onClear={handleClearOPFS}
                clearLabel="clear local files"
                clearDanger
                loading={clearing() === "opfs"}
              />

              {/* indexeddb */}
              <StorageCard
                title="music library database"
                icon=""
                size={data().indexedDb.musicDbSize}
                details={[{ label: "songs, albums, artists, playlists", value: "" }]}
                onClear={handleClearMusicDb}
                clearLabel="clear music library"
                clearDanger
                loading={clearing() === "musicdb"}
              />

              {/* app state (no clear button, just info) */}
              <StorageCard
                title="app settings"
                icon=""
                size={data().indexedDb.appDbSize + data().indexedDb.cacheMetadataDbSize}
                details={[{ label: "playback state, queue, preferences", value: "" }]}
              />
            </div>

            {/* nuclear option */}
            <div class="border-t border-[var(--color-border-subtle)] pt-6">
              <h2 class="text-sm font-medium text-red-400 mb-3">danger zone</h2>
              <button
                class="w-full px-4 py-3 bg-red-600/20 hover:bg-red-600/30 border border-red-600/50 rounded-lg text-red-400 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleClearAll}
                disabled={!!clearing()}
              >
                {clearing() === "all" ? "deleting everything..." : "DELETE EVERYTHING"}
              </button>
              <p class="mt-2 text-xs text-[var(--color-text-muted)]">
                permanently removes all freqhole data. cannot be undone.
              </p>
            </div>

            {/* refresh button */}
            <div class="mt-6 flex justify-center">
              <button
                class="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                onClick={refreshBreakdown}
                disabled={loading()}
              >
                {loading() ? "refreshing..." : "↻ refresh stats"}
              </button>
            </div>
          </>
        )}
      </Show>

      {/* confirmation dialog */}
      <ConfirmDialog
        isOpen={confirmDialog().isOpen}
        title={confirmDialog().title}
        message={confirmDialog().message}
        confirmLabel={confirmDialog().confirmLabel}
        confirmDanger={confirmDialog().confirmDanger}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmDialog({ ...confirmDialog(), isOpen: false })}
      />
    </div>
  );
}

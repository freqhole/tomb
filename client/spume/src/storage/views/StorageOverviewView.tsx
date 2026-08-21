// storage overview view - read-only summary of the active removable-storage
// sync device (phase 1 of docs/removable-storage-sync-plan.md, tomb repo).
//
// scoped honestly to what's actually available right now: device identity,
// mount status, disk free/used/total space. song/album/artist sync counts
// and "last synced" are deferred until the phase-2 copy engine + state file
// exist - there's no sync history to show yet.
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  isCharnelMode,
  listMountedExternalStorageDevices,
  getActiveExternalStorageDevice,
  getExternalStorageDiskUsage,
  openSetupWizard,
  type ExternalStorageDevice,
  type DiskUsageResult,
} from "../../app/services/charnel";
import { setPageInfo, clearPageInfo } from "../../app/services/pageInfo";
import { formatBytes } from "../../settings/services/storageManager";

// how often to re-check mount status while this view is open - needs to
// be fairly prompt since we navigate away the moment the active device
// disappears (there's nothing left on this page to show once it's gone).
const MOUNT_POLL_INTERVAL_MS = 3000;

export function StorageOverviewView() {
  const navigate = useNavigate();
  const [device, setDevice] = createSignal<ExternalStorageDevice | null>(null);
  const [mountedCount, setMountedCount] = createSignal(0);
  const [diskUsage, setDiskUsage] = createSignal<DiskUsageResult | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  // tracks whether we've ever actually shown an active device, so we can
  // tell "never had one" apart from "had one, then it got unmounted".
  let hadActiveDevice = false;

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
      setMountedCount(mounted.length);
      if (active) {
        setDiskUsage(await getExternalStorageDiskUsage(active.id));
      } else {
        setDiskUsage(null);
      }
      setError(null);
    } catch (err) {
      console.error("[StorageOverviewView] failed to load storage overview:", err);
      setError("failed to load storage overview");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), MOUNT_POLL_INTERVAL_MS);
    onCleanup(() => clearInterval(interval));
  });

  createEffect(() => {
    setPageInfo({ title: "removable storage" });
  });
  onCleanup(() => clearPageInfo());

  return (
    <div class="p-6 max-w-2xl mx-auto">
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
            when={mountedCount() > 0}
            fallback={<span>no removable device is currently plugged in.</span>}
          >
            <span>
              {mountedCount()} device{mountedCount() === 1 ? "" : "s"} mounted, but none selected as
              active yet.
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
              <span class="text-xs px-2 py-1 rounded-full bg-green-600/20 text-green-400">
                mounted
              </span>
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

            <div class="mt-4 pt-4 border-t border-[var(--color-border-subtle)] text-xs text-[var(--color-text-muted)]">
              last synced: {activeDevice().last_synced_at ? "—" : "never"}
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

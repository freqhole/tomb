// local storage usage readout (settings view). uses the standard Storage
// API's estimate(), which reflects real usage across all of the origin's
// storage (indexeddb today; would also reflect OPFS if/when phase 4's
// blob-cache gap gets closed) - no dedicated blob cache exists yet, so
// there's nothing to add a "clear cache" action for beyond that (see
// docs/player-remote-site-plan.md phase 8).

export interface StorageUsage {
  usageBytes: number;
  quotaBytes: number | null;
}

export async function getStorageUsage(): Promise<StorageUsage> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { usageBytes: 0, quotaBytes: null };
  }
  const estimate = await navigator.storage.estimate();
  return {
    usageBytes: estimate.usage ?? 0,
    quotaBytes: estimate.quota ?? null,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

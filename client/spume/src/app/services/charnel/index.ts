/**
 * tauri service - communication bridge for tauri ↔ spume
 *
 * provides typed commands (invoke) and event listeners for the tauri desktop app.
 * all functions are only available in tauri builds - browser builds tree-shake this out.
 *
 * usage:
 *   import { isCharnelMode, getConfig, onConfigChanged } from "./services/charnel";
 *
 *   if (isCharnelMode()) {
 *     const config = await getConfig();
 *     const unlisten = await onConfigChanged((event) => { ... });
 *   }
 */

// re-export mode detection
export { isCharnelMode } from "./mode";

// re-export schemas and types
export {
  FreqholeConfigSchema,
  TauriEventSchema,
  ConfigChangedEventSchema,
  ScanProgressEventSchema,
  ScanCompleteEventSchema,
  PeerOfflineEventSchema,
  ExternalStorageMountedChangedEventSchema,
  ExternalStorageSyncProgressEventSchema,
  type FreqholeConfig,
  type TauriEvent,
  type ConfigChangedEvent,
  type ScanProgressEvent,
  type ScanCompleteEvent,
  type PeerOfflineEvent,
  type ExternalStorageMountedChangedEvent,
  type ExternalStorageSyncProgressEvent,
} from "./schema";

// re-export commands
export {
  getConfig,
  setWindowTitle,
  takePendingDeepLinks,
  fetchLocalNodeId,
  updateServerInfo,
  openSetupWizard,
} from "./commands";

// re-export local-node-id accessor (synchronous; populated by charnel host on startup)
export { getLocalNodeId, setLocalNodeIdValue, localNodeIdSignal } from "./localNodeId";

// re-export the global "is a removable-storage sync running" signal (shared
// between StorageOverviewView and the always-mounted playerbar icon), plus
// the shared per-song progress signal (set once, globally, in AppLayout.tsx
// so it survives navigating away from StorageOverviewView mid-sync).
export {
  externalStorageSyncingSignal,
  setExternalStorageSyncing,
  externalStorageSyncProgressSignal,
  setExternalStorageSyncProgress,
  type ExternalStorageSyncProgress,
} from "./externalStorageSyncState";

// re-export removable-storage sync commands
export {
  listMountedExternalStorageDevices,
  getActiveExternalStorageDevice,
  getExternalStorageDiskUsage,
  ejectExternalStorageDevice,
  setActiveExternalStorageDevice,
  getSyncedPlaylistIds,
  syncPlaylistsToDevice,
  pauseExternalStorageSync,
  listFilterSets,
  createFilterSet,
  renameFilterSet,
  deleteFilterSet,
  getOrCreateDefaultFilterSet,
  listFilterSetFilters,
  addFilterSetFilter,
  removeFilterSetFilter,
  getFilterSetProjection,
  getSyncedSongCount,
  estimateSyncSize,
  FAVORITES_SYNC_ID,
  type ExternalStorageDevice,
  type DiskUsageResult,
  type SyncPlaylistsResult,
  type SyncSizeEstimate,
  type FilterSet,
  type FilterSetFilter,
  type FilterSetProjection,
} from "./externalStorage";

// re-export event listeners
export {
  onEvent,
  onConfigChanged,
  onScanProgress,
  onScanComplete,
  onPeerOffline,
  onExternalStorageMountedChanged,
  onExternalStorageSyncProgress,
} from "./events";

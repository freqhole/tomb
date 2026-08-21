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
  type FreqholeConfig,
  type TauriEvent,
  type ConfigChangedEvent,
  type ScanProgressEvent,
  type ScanCompleteEvent,
  type PeerOfflineEvent,
  type ExternalStorageMountedChangedEvent,
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

// re-export removable-storage sync commands
export {
  listMountedExternalStorageDevices,
  getActiveExternalStorageDevice,
  getExternalStorageDiskUsage,
  type ExternalStorageDevice,
  type DiskUsageResult,
} from "./externalStorage";

// re-export event listeners
export {
  onEvent,
  onConfigChanged,
  onScanProgress,
  onScanComplete,
  onPeerOffline,
  onExternalStorageMountedChanged,
} from "./events";

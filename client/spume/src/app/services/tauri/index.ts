/**
 * tauri service - communication bridge for tauri ↔ spume
 *
 * provides typed commands (invoke) and event listeners for the tauri desktop app.
 * all functions are only available in tauri builds - browser builds tree-shake this out.
 *
 * usage:
 *   import { isTauriMode, getConfig, onConfigChanged } from "./services/tauri";
 *
 *   if (isTauriMode()) {
 *     const config = await getConfig();
 *     const unlisten = await onConfigChanged((event) => { ... });
 *   }
 */

// re-export mode detection
export { isTauriMode } from "./mode";

// re-export schemas and types
export {
  FreqholeConfigSchema,
  TauriEventSchema,
  ConfigChangedEventSchema,
  ScanProgressEventSchema,
  ScanCompleteEventSchema,
  PeerOfflineEventSchema,
  type FreqholeConfig,
  type TauriEvent,
  type ConfigChangedEvent,
  type ScanProgressEvent,
  type ScanCompleteEvent,
  type PeerOfflineEvent,
} from "./schema";

// re-export commands
export { getConfig, setWindowTitle } from "./commands";

// re-export event listeners
export {
  onEvent,
  onConfigChanged,
  onScanProgress,
  onScanComplete,
  onPeerOffline,
} from "./events";

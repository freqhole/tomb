// public surface of @freqhole/cenotaph - see docs/cenotaph-migration-plan.md
// (in the tomb repo) for the migration this package is part of.

export {
  PLAYER_ALPN,
  FREQHOLE_ALPN,
  type CenotaphBiStream,
  type CenotaphAcceptableNode,
} from "./midden/node";
export { startAcceptLoop, type AlpnHandler } from "./midden/acceptLoop";

export {
  createPlayerConnectionHandler,
  type PlayerConnectionHandlerOptions,
} from "./control/playerConnectionHandler";
export { dispatchCommand, commandInFlight } from "./control/dispatcher";
export type { PlaybackBackend } from "./control/playbackBackend";
export {
  PlayerCommandSchema,
  PlayerStatusSchema,
  CommandAckSchema,
  SubscribeRequestSchema,
  type PlayerCommand,
  type PlayerStatus,
  type CommandAck,
  type SubscribeRequest,
  type MediaRef,
} from "./control/schema";
export {
  registerSubscriber,
  unregisterSubscriber,
  broadcastStatus,
} from "./control/statusSubscribers";
export {
  connectedControllers,
  markControllerConnected,
  markControllerDisconnected,
  type ConnectedController,
} from "./control/connectedControllers";
export { activityRamp, markActivity } from "./control/activityIndicator";

export { createApiRouter, type ApiRouter, type ApiRouteHandler } from "./control/apiRouter";
export {
  createHelloRouteHandler,
  type HelloInfo,
  type HelloInfoProvider,
} from "./hello/helloHandler";

export { generatePin, isValidPinFormat } from "./pairing/pin";
export { currentPin, regeneratePin } from "./pairing/pinStore";
export { isRateLimited, recordPairingFailure, clearPairingFailures } from "./pairing/rateLimiter";
export {
  createIdbTrustStore,
  type TrustStore,
  type TrustedController,
  type IdbTrustStoreOptions,
} from "./pairing/trustStore";
export { handlePairRequest } from "./pairing/pairingHandler";
export {
  PairRequestSchema,
  PairResponseSchema,
  type PairRequest,
  type PairResponse,
} from "./pairing/protocol";

export {
  deviceName,
  loadDeviceName,
  setDeviceName,
  DEFAULT_DISPLAY_NAME,
} from "./settings/deviceNameStore";
export { develMode, loadDevelMode, setDevelMode } from "./settings/develModeStore";
export { getStorageUsage, formatBytes, type StorageUsage } from "./settings/storageUsage";
export {
  installConsoleCapture,
  capturedLogLines,
  clearCapturedLogLines,
  type CapturedLogLine,
} from "./debug/consoleCapture";

export { hasMSE, choosePlaybackMode, type PlaybackMode } from "./playback/mseSupport";
export { fetchMediaBlob } from "./playback/mediaFetch";
export type { MediaPlaybackNode } from "./playback/types";
export {
  startRadio,
  stopRadio,
  radioState,
  radioNowPlaying,
  radioStationId,
  radioListenerCount,
  radioError,
  radioElement,
  type RadioState,
  type RadioNowPlaying,
} from "./playback/radioClient";
export {
  mediaPlaybackBackend,
  retryPlayback,
  engineState,
  nowPlaying,
  engineError,
  upcomingQueue,
  mediaElement,
  mediaKind,
  downloadProgress,
  playbackPosition,
  playbackDuration,
  queueItemStatus,
  pause,
  resume,
  skip,
  setLocalLibraryHooks,
  type EngineState,
  type LocalLibraryHooks,
} from "./playback/playbackEngine";

// public surface of @freqhole/cenotaph - see docs/cenotaph-migration-plan.md
// (in the tomb repo) for the migration this package is part of.
export { PLAYER_ALPN, FREQHOLE_ALPN, } from "./midden/node";
export { startAcceptLoop } from "./midden/acceptLoop";
export { createPlayerConnectionHandler, } from "./control/playerConnectionHandler";
export { dispatchCommand, commandInFlight } from "./control/dispatcher";
export { PlayerCommandSchema, PlayerStatusSchema, CommandAckSchema, SubscribeRequestSchema, } from "./control/schema";
export { registerSubscriber, unregisterSubscriber, broadcastStatus, } from "./control/statusSubscribers";
export { connectedControllers, markControllerConnected, markControllerDisconnected, } from "./control/connectedControllers";
export { activityRamp, markActivity } from "./control/activityIndicator";
export { createApiRouter } from "./control/apiRouter";
export { createHelloRouteHandler, } from "./hello/helloHandler";
export { generatePin, isValidPinFormat } from "./pairing/pin";
export { currentPin, regeneratePin } from "./pairing/pinStore";
export { isRateLimited, recordPairingFailure, clearPairingFailures } from "./pairing/rateLimiter";
export { createIdbTrustStore, } from "./pairing/trustStore";
export { handlePairRequest } from "./pairing/pairingHandler";
export { PairRequestSchema, PairResponseSchema, } from "./pairing/protocol";
export { deviceName, loadDeviceName, setDeviceName, DEFAULT_DISPLAY_NAME, } from "./settings/deviceNameStore";
export { develMode, loadDevelMode, setDevelMode } from "./settings/develModeStore";
export { getStorageUsage, formatBytes } from "./settings/storageUsage";
export { installConsoleCapture, capturedLogLines, clearCapturedLogLines, } from "./debug/consoleCapture";
export { hasMSE, choosePlaybackMode } from "./playback/mseSupport";
export { fetchMediaBlob } from "./playback/mediaFetch";
export { startRadio, stopRadio, radioState, radioNowPlaying, radioStationId, radioListenerCount, radioError, radioElement, } from "./playback/radioClient";
export { mediaPlaybackBackend, retryPlayback, engineState, nowPlaying, engineError, upcomingQueue, mediaElement, mediaKind, downloadProgress, playbackPosition, playbackDuration, queueItemStatus, pause, resume, skip, } from "./playback/playbackEngine";

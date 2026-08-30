// pluggable playback implementation a host app supplies to the control
// dispatcher - decouples command handling from any one playback engine, so
// a host app can drive its OWN existing player/queue instead of running a
// second, parallel playback engine just to answer remote commands.
//
// player.freqhole.net wraps its own playback/playbackEngine.ts +
// playback/radioClient.ts; spume wraps its own real player + queue
// services (see docs/cenotaph-migration-plan.md phase 1).

import type { MediaRef, PlayerStatus } from "./schema";

// generic over the host's own node/identity handle type (`TNode`) -
// cenotaph's dispatcher never calls any method on `node` itself, it's
// forwarded opaquely so each method here can use it however its own host
// app needs (e.g. spume's adapter casts it to `MiddenNodeLike` to call
// `api_request`/`fetch_blob_with_progress`; a future charnel adapter would
// cast it to whatever its native transport handle is).
export interface PlaybackBackend<TNode = unknown> {
  play(node: TNode, item: MediaRef): Promise<void>;
  replaceQueue(node: TNode, items: MediaRef[]): Promise<void>;
  appendQueue(node: TNode, items: MediaRef[]): Promise<void>;
  pause(): void;
  resume(): void;
  seek(positionMs: number): void;
  skip(node: TNode): Promise<void>;
  removeFromQueue(node: TNode, index: number): Promise<void>;
  reorderQueue(fromIndex: number, toIndex: number): void;
  setVolume(volume: number): void;
  stop(): void;
  startRadio(node: TNode, peerAddr: string, stationId?: string): Promise<void>;
  stopRadio(): void;
  setAutoDownloadEnabled(enabled: boolean): void;
  currentStatus(): PlayerStatus;
}

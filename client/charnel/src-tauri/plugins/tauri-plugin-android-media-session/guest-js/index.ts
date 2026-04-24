import { invoke, addPluginListener, type PluginListener } from "@tauri-apps/api/core";

export type PlaybackState = "playing" | "paused" | "stopped";

export interface SetMetadataPayload {
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  /** base64 bytes (webp/png/jpeg). data-URL prefixes are tolerated. */
  artworkBase64?: string;
}

export interface SetPositionPayload {
  positionMs: number;
  durationMs: number;
  playbackRate: number;
}

export type MediaAction =
  | "play"
  | "pause"
  | "next"
  | "previous"
  | "seekTo";

export interface MediaActionEvent {
  action: MediaAction;
  positionMs?: number;
}

const NS = "plugin:android-media-session";

export async function setMetadata(payload: SetMetadataPayload): Promise<void> {
  await invoke(`${NS}|set_metadata`, { payload });
}

export async function setPlaybackState(state: PlaybackState): Promise<void> {
  await invoke(`${NS}|set_playback_state`, { payload: { state } });
}

export async function setPosition(payload: SetPositionPayload): Promise<void> {
  await invoke(`${NS}|set_position`, { payload });
}

export async function clear(): Promise<void> {
  await invoke(`${NS}|clear`);
}

export async function onMediaAction(
  cb: (ev: MediaActionEvent) => void,
): Promise<PluginListener> {
  return addPluginListener("android-media-session", "action", cb);
}

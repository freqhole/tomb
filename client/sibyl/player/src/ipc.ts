// the sibyl ipc schema, mirrored on the typescript side.
// MUST match `client/sibyl/src-tauri/src/ipc.rs::{SibylRequest, SibylResponse}`.
//
// tauri callers obtain an `IpcInvoke` from the demo app (which imports
// `@tauri-apps/api`) and pass it into player adapters. the player
// package itself never imports tauri.

import type { CodecParams } from "./types.js";

export type SibylRequest =
  | { kind: "host_file"; path: string; song_id?: string; title?: string }
  | { kind: "request_ticket"; ticket: string; have_chunks: number[] }
  | { kind: "cancel_request"; request_id: string }
  | { kind: "node_info" }
  | { kind: "rodio_load"; paths: string[] }
  | { kind: "rodio_play" }
  | { kind: "rodio_pause" }
  | { kind: "rodio_resume" }
  | { kind: "rodio_stop" }
  | { kind: "rodio_seek"; ms: number }
  | { kind: "rodio_volume"; v: number }
  | { kind: "rodio_status" };

export type SibylResponse =
  | { kind: "ticket"; ticket: string; song_id: string }
  | { kind: "request_started"; request_id: string }
  | { kind: "node_info"; node_id: string }
  | { kind: "rodio_status"; status: RodioStatusPayload }
  | { kind: "rodio_total_secs"; secs: number }
  | { kind: "ok" };

export interface RodioStatusPayload {
  has_sink: boolean;
  is_paused: boolean;
  queue_len: number;
  position_secs: number;
  total_secs: number;
  volume: number;
}

/** single-function adapter handed in by the host application. */
export type IpcInvoke = (req: SibylRequest) => Promise<SibylResponse>;

/** subscription to a tauri event, returned as an unsubscribe fn. */
export type EventSubscribe = <T>(
  event: "sibyl://chunk" | "sibyl://status",
  handler: (payload: T) => void,
) => Promise<() => void>;

// re-export for downstream files that import params from here
export type { CodecParams };

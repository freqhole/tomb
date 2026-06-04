import { createSignal } from "solid-js";
import type {
  EnrichmentSource,
  InflightEntry,
  MbSessionState,
  RemoteRef,
  StreamState,
} from "./types";
import { EMPTY_SESSION } from "./types";

// inflight key: `${source}:${album_id}` so multiple sources can be
// tracked independently for the same album.
export const [inflight, setInflight] = createSignal<Map<string, InflightEntry>>(new Map());
export const [session, setSession] = createSignal<MbSessionState>(EMPTY_SESSION());

// per-job latest `Stage` event payload, for inline progress captions
// (consumed by AlbumRow / bulk review). cleared when the job settles.
export const [stageByJobId, setStageByJobId] = createSignal<
  Map<string, { stage: string; message: string | null }>
>(new Map());

// adaptive polling interval per remote: setInterval handles whichever
// cadence is current, swapped out when stream health flips.
export const pollers = new Map<string, ReturnType<typeof setInterval>>();
// reverse lookup so a health-flip can recreate the interval without
// requiring callers to pass the remote again.
export const remoteByRemoteId = new Map<string, RemoteRef>();
export const streams = new Map<string, StreamState>();

export function inflightKey(source: EnrichmentSource, albumId: string): string {
  return `${source}:${albumId}`;
}

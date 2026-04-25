// charnel adapter that exposes a `tune_radio`-shaped function backed by
// the tauri `radio_tune` / `radio_leave` IPC commands. lets the radio
// service drive both the wasm midden path and the charnel app path
// through one interface.
//
// the tauri side streams events back via a `Channel<RadioEvent>` (see
// `client/charnel/src-tauri/src/radio_commands.rs`); this adapter
// fans them out to the same `(on_hello, on_meta, on_chunk)` callbacks
// midden invokes directly.

import type { RadioHandleLike } from "freqhole-api-client";
import { isCharnelMode } from "../../services/charnel";

interface RadioChunkEvent {
  kind: "chunk";
  seq: number;
  is_init: boolean;
  bytes_b64: string;
}
interface RadioHelloEvent {
  kind: "hello";
  json: string;
}
interface RadioMetaEvent {
  kind: "meta";
  json: string;
}
interface RadioLagEvent {
  kind: "lag";
  json: string;
}
interface RadioChunkReadyEvent {
  kind: "chunk_ready";
  json: string;
}
interface RadioClosedEvent {
  kind: "closed";
  reason: string;
}
type RadioEvent =
  | RadioChunkEvent
  | RadioHelloEvent
  | RadioMetaEvent
  | RadioLagEvent
  | RadioChunkReadyEvent
  | RadioClosedEvent;

type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

let invokeCached: InvokeFn | null = null;
async function getInvoke(): Promise<InvokeFn> {
  if (invokeCached) return invokeCached;
  const tauri = await import("@tauri-apps/api/core");
  invokeCached = tauri.invoke as InvokeFn;
  return invokeCached;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * tune into a radio broadcaster from inside the tauri webview.
 *
 * shape mirrors `MiddenNodeLike.tune_radio`. callbacks are invoked from
 * the channel handler; one bad callback throw won't tear down the others.
 */
export async function tuneRadioCharnel(
  peerAddr: string,
  on_hello: (json: string) => void,
  on_meta: (json: string) => void,
  on_chunk: (seq: number, isInit: boolean, bytes: Uint8Array) => void,
): Promise<RadioHandleLike> {
  if (!isCharnelMode()) {
    throw new Error("tuneRadioCharnel called outside tauri");
  }
  const invoke = await getInvoke();
  const { Channel } = await import("@tauri-apps/api/core");

  const events = new Channel<RadioEvent>();
  events.onmessage = (msg) => {
    try {
      switch (msg.kind) {
        case "hello":
          on_hello(msg.json);
          break;
        case "meta":
        case "lag":
        case "chunk_ready":
          // route every non-Hello control message through on_meta. the
          // payload includes the original `disc` discriminator so spume
          // can dispatch on Lag / ChunkReady / Meta uniformly with the
          // wasm path.
          on_meta(msg.json);
          break;
        case "chunk":
          on_chunk(msg.seq, msg.is_init, base64ToBytes(msg.bytes_b64));
          break;
        case "closed":
          // session ended on the rust side; nothing to do besides log.
          console.info("[radio-charnel] session closed:", msg.reason);
          break;
      }
    } catch (e) {
      console.warn("[radio-charnel] callback threw:", e);
    }
  };

  const sessionId = (await invoke("radio_tune", {
    peerAddr,
    events,
  })) as string;

  // keep a strong reference to the channel for the whole session.
  // without this, GC can collect the callback while rust is still
  // streaming events, which triggers tauri "Couldn't find callback id".
  let retainedEvents: unknown = events;

  return {
    leave() {
      // reference before clearing so the closure captures retainedEvents.
      void retainedEvents;
      invoke("radio_leave", { sessionId }).catch((e) =>
        console.warn("[radio-charnel] radio_leave failed:", e),
      );
      retainedEvents = null;
    },
  };
}

/**
 * tune into a *local* broadcaster running in the same tauri process.
 * skips the iroh round-trip entirely (iroh refuses to dial yourself),
 * so the charnel app can listen to its own stations.
 *
 * `stationId` is optional — when omitted the broadcaster registry's
 * default station is used.
 */
export async function tuneRadioCharnelLocal(
  stationId: string | undefined,
  on_hello: (json: string) => void,
  on_meta: (json: string) => void,
  on_chunk: (seq: number, isInit: boolean, bytes: Uint8Array) => void,
): Promise<RadioHandleLike> {
  if (!isCharnelMode()) {
    throw new Error("tuneRadioCharnelLocal called outside tauri");
  }
  const invoke = await getInvoke();
  const { Channel } = await import("@tauri-apps/api/core");

  const events = new Channel<RadioEvent>();
  events.onmessage = (msg) => {
    try {
      switch (msg.kind) {
        case "hello":
          on_hello(msg.json);
          break;
        case "meta":
        case "lag":
        case "chunk_ready":
          on_meta(msg.json);
          break;
        case "chunk":
          on_chunk(msg.seq, msg.is_init, base64ToBytes(msg.bytes_b64));
          break;
        case "closed":
          console.info("[radio-charnel-local] session closed:", msg.reason);
          break;
      }
    } catch (e) {
      console.warn("[radio-charnel-local] callback threw:", e);
    }
  };

  const sessionId = (await invoke("radio_tune_local", {
    stationId: stationId ?? null,
    events,
  })) as string;

  // keep a strong reference to the channel for the whole session.
  let retainedEvents: unknown = events;

  return {
    leave() {
      // reference before clearing so the closure captures retainedEvents.
      void retainedEvents;
      invoke("radio_leave", { sessionId }).catch((e) =>
        console.warn("[radio-charnel-local] radio_leave failed:", e),
      );
      retainedEvents = null;
    },
  };
}

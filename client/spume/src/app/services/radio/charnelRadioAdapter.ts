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
interface RadioClosedEvent {
  kind: "closed";
  reason: string;
}
type RadioEvent =
  | RadioChunkEvent
  | RadioHelloEvent
  | RadioMetaEvent
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

  return {
    leave() {
      invoke("radio_leave", { sessionId }).catch((e) =>
        console.warn("[radio-charnel] radio_leave failed:", e),
      );
    },
  };
}

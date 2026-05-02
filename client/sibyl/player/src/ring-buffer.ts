// SPSC ring of decoded `AudioData` for the worklet to consume.
//
// preferred path: SharedArrayBuffer (requires `crossOriginIsolated`).
// fallback: AudioWorkletNode's built-in `.port` — one postMessage
// per AudioData (slightly more jitter, no other downside).
//
// the public api is the same for both modes; the player core picks
// implementation at construction time based on `crossOriginIsolated`.

export interface RingBuffer {
  /** push planar f32 audio for the worklet. returns false if full. */
  push(channels: Float32Array[], sampleRate: number): boolean;
  /** drop everything queued/buffered — used when switching songs so
   *  leftover audio from the previous song doesn't keep playing. */
  reset(): void;
  /** debug stats. */
  fill(): { available: number; capacity: number };
  /** mode flag the worklet processor uses to pick its read path. */
  readonly mode: "sab" | "port";
  /** the SAB descriptor (worklet side). only set in SAB mode. */
  sab?: SharedArrayBuffer;
  /** in port mode, the player attaches the AudioWorkletNode's
   *  built-in port via `attachPort`. (you can't transfer a custom
   *  MessagePort through `processorOptions`.) */
  attachPort?(port: MessagePort): void;
}

/** factory: pick best mode for current environment. */
export function createRingBuffer(opts: {
  capacityFrames: number;
  channelCount: number;
}): RingBuffer {
  // TODO: SabRingBuffer is currently a no-op stub (push() drops the
  // audio). until the SAB ring + matching worklet reader is real,
  // always use ChannelRingBuffer — it's slightly higher latency but
  // actually plays audio.
  // if (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated &&
  //     typeof SharedArrayBuffer !== "undefined") {
  //   return new SabRingBuffer(opts);
  // }
  return new ChannelRingBuffer(opts);
}

// stub impls — phase 1 fills these in. kept as classes so the demo
// app can wire them now and the bodies land later without touching
// callers.

class SabRingBuffer implements RingBuffer {
  readonly mode = "sab" as const;
  sab: SharedArrayBuffer;
  constructor(_opts: { capacityFrames: number; channelCount: number }) {
    // todo (phase 1): allocate sab with header + interleaved float32 channels
    this.sab = new SharedArrayBuffer(64);
  }
  push(_channels: Float32Array[], _sampleRate: number): boolean {
    return true;
  }
  reset(): void {}
  fill() { return { available: 0, capacity: 0 }; }
}

class ChannelRingBuffer implements RingBuffer {
  readonly mode = "port" as const;
  private port?: MessagePort;
  constructor(_opts: { capacityFrames: number; channelCount: number }) {}
  attachPort(port: MessagePort): void {
    this.port = port;
  }
  push(channels: Float32Array[], sampleRate: number): boolean {
    if (!this.port) return false;
    // post a transferable copy to the worklet half
    this.port.postMessage(
      { channels, sampleRate },
      channels.map((c) => c.buffer),
    );
    return true;
  }
  reset(): void {
    // tell the worklet to drop its queued audio.
    this.port?.postMessage({ type: "reset" });
  }
  fill() { return { available: 0, capacity: 0 }; }
}

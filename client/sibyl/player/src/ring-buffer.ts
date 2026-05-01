// SPSC ring of decoded `AudioData` for the worklet to consume.
//
// preferred path: SharedArrayBuffer (requires `crossOriginIsolated`).
// fallback: MessageChannel one-shot per AudioData (slightly more
// jitter, no other downside — works on safari without COOP/COEP).
//
// the public api is the same for both modes; the player core picks
// implementation at construction time based on `crossOriginIsolated`.

export interface RingBuffer {
  /** push planar f32 audio for the worklet. returns false if full. */
  push(channels: Float32Array[], sampleRate: number): boolean;
  /** debug stats. */
  fill(): { available: number; capacity: number };
  /** the message-port half (worklet side). null in SAB mode. */
  port?: MessagePort;
  /** the SAB descriptor (worklet side). null in MessageChannel mode. */
  sab?: SharedArrayBuffer;
}

/** factory: pick best mode for current environment. */
export function createRingBuffer(opts: {
  capacityFrames: number;
  channelCount: number;
}): RingBuffer {
  if (typeof crossOriginIsolated !== "undefined" && crossOriginIsolated &&
      typeof SharedArrayBuffer !== "undefined") {
    return new SabRingBuffer(opts);
  }
  return new ChannelRingBuffer(opts);
}

// stub impls — phase 1 fills these in. kept as classes so the demo
// app can wire them now and the bodies land later without touching
// callers.

class SabRingBuffer implements RingBuffer {
  sab: SharedArrayBuffer;
  constructor(_opts: { capacityFrames: number; channelCount: number }) {
    // todo (phase 1): allocate sab with header + interleaved float32 channels
    this.sab = new SharedArrayBuffer(64);
  }
  push(_channels: Float32Array[], _sampleRate: number): boolean {
    return true;
  }
  fill() { return { available: 0, capacity: 0 }; }
}

class ChannelRingBuffer implements RingBuffer {
  port: MessagePort;
  private other: MessagePort;
  constructor(_opts: { capacityFrames: number; channelCount: number }) {
    const ch = new MessageChannel();
    this.port = ch.port1;
    this.other = ch.port2;
  }
  push(channels: Float32Array[], sampleRate: number): boolean {
    // post a transferable copy to the worklet half
    this.other.postMessage(
      { channels, sampleRate },
      channels.map((c) => c.buffer),
    );
    return true;
  }
  fill() { return { available: 0, capacity: 0 }; }
}

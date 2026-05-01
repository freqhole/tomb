// decode-worker.ts
// runs decodeAudioData off the main thread so the ui stays responsive
// and decode work runs on a separate cpu core.

interface DecodeRequest {
  type: "decode";
  bytes: ArrayBuffer;
  sampleRate?: number;
}

interface DecodeResponse {
  type: "decoded";
  channels: Float32Array[];
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  duration: number;
  decodeMs: number;
}

interface DecodeError {
  type: "error";
  message: string;
}

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const msg = e.data;
  if (msg.type !== "decode") return;

  // OfflineAudioContext is available in workers in modern webkit/chromium.
  // we pass a target sampleRate; if undefined, use a sensible default and let
  // the caller resample (or discard + recreate at the buffer's native rate).
  const targetRate = msg.sampleRate ?? 48000;

  // dummy length=1 is fine; we only need decodeAudioData
  const ctx = new OfflineAudioContext(2, 1, targetRate);

  const t0 = performance.now();
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(msg.bytes);
  } catch (err) {
    const resp: DecodeError = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(resp);
    return;
  }
  const t1 = performance.now();

  const channels: Float32Array[] = [];
  const transfer: ArrayBuffer[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    // copy out so the underlying buffer is transferable
    const src = buf.getChannelData(c);
    const copy = new Float32Array(src.length);
    copy.set(src);
    channels.push(copy);
    transfer.push(copy.buffer);
  }

  const resp: DecodeResponse = {
    type: "decoded",
    channels,
    sampleRate: buf.sampleRate,
    length: buf.length,
    numberOfChannels: buf.numberOfChannels,
    duration: buf.duration,
    decodeMs: t1 - t0,
  };
  (self as unknown as Worker).postMessage(resp, transfer);
};

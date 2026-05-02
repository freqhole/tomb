// playback worklet: drains the ring buffer and outputs to speakers.
// runs in audio worklet global scope. NOT typescript-typed — published
// as raw js so it can be served as a static module.
//
// two delivery modes (matched by ring-buffer.ts):
// 1. SAB: the buffer descriptor is in `options.processorOptions.sab`,
//    we Atomics.load read/write indices each callback.
// 2. port: the main thread postMessages each AudioData payload via
//    the AudioWorkletNode's built-in `node.port` (which is connected
//    to `this.port` on the processor side). we queue payloads into a
//    local fifo and drain them in `process()`.

class SibylPlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.mode = opts.mode || "port";
    this.channelCount = opts.channelCount || 2;
    this.queue = [];
    this.cursor = 0;

    if (this.mode === "port") {
      // `this.port` is the AudioWorkletNode-paired port. main thread
      // pushes via `node.port.postMessage(...)`.
      this.port.onmessage = (e) => {
        const msg = e.data;
        if (msg && msg.type === "reset") {
          // drop any queued audio (used when switching songs).
          this.queue.length = 0;
          this.cursor = 0;
          return;
        }
        // expects { channels: Float32Array[], sampleRate: number }
        this.queue.push(msg);
      };
    }
    // SAB mode: read sab descriptor from opts.sab — todo phase 1.
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const frames = out[0].length;

    let written = 0;
    while (written < frames && this.queue.length > 0) {
      const head = this.queue[0];
      const remaining = head.channels[0].length - this.cursor;
      const take = Math.min(remaining, frames - written);
      for (let ch = 0; ch < out.length; ch++) {
        const src = head.channels[ch] || head.channels[0];
        out[ch].set(src.subarray(this.cursor, this.cursor + take), written);
      }
      this.cursor += take;
      written += take;
      if (this.cursor >= head.channels[0].length) {
        this.queue.shift();
        this.cursor = 0;
      }
    }
    // pad with silence if underrun
    if (written < frames) {
      for (let ch = 0; ch < out.length; ch++) {
        out[ch].fill(0, written);
      }
    }
    return true;
  }
}

registerProcessor("sibyl-playback", SibylPlaybackProcessor);

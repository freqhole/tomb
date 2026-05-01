// playback worklet: drains the ring buffer and outputs to speakers.
// runs in audio worklet global scope. NOT typescript-typed — published
// as raw js so it can be served as a static module.
//
// two delivery modes (matched by ring-buffer.ts):
// 1. SAB: the buffer descriptor is in `options.processorOptions.sab`,
//    we Atomics.load read/write indices each callback.
// 2. MessageChannel: the worklet receives `port` via processorOptions
//    and queues each posted AudioData payload into a local fifo.

class SibylPlaybackProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { mode, port, channelCount } = options.processorOptions || {};
    this.mode = mode || "channel";
    this.channelCount = channelCount || 2;
    this.queue = [];
    this.cursor = 0;

    if (this.mode === "channel" && port) {
      port.onmessage = (e) => {
        // expects { channels: Float32Array[], sampleRate: number }
        this.queue.push(e.data);
      };
    }
    // SAB mode: read sab descriptor from processorOptions.sab — todo phase 1.
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

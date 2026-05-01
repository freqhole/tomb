// audio-playback-worklet.js
// runs on the dedicated audio rendering thread (rt-priority via rtkit on linux).
// receives decoded pcm channel data via port message, then renders it sample-by-sample
// into the output buffer. zero allocation in process(), zero shared state with main.

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = null; // Float32Array[]
    this.length = 0;
    this.position = 0;
    this.playing = false;
    this.processCalls = 0;
    this.heartbeatsSent = 0;
    this.firstNonzeroLogged = false;
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "load") {
        this.channels = msg.channels;
        this.length = msg.length;
        this.position = 0;
        this.port.postMessage({
          type: "loaded",
          channelCount: this.channels ? this.channels.length : 0,
          length: this.length,
          ch0Type: this.channels && this.channels[0]
            ? Object.prototype.toString.call(this.channels[0])
            : "null",
          ch0Len: this.channels && this.channels[0] ? this.channels[0].length : 0,
        });
      } else if (msg.type === "play") {
        this.playing = true;
        this.port.postMessage({ type: "play-ack", position: this.position });
      } else if (msg.type === "stop") {
        this.playing = false;
        this.position = 0;
      } else if (msg.type === "pause") {
        this.playing = false;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    this.processCalls++;
    // first call, then every ~5s, capped at 5 total to avoid spam
    // (~344 calls/s at 44100hz/128 frames, so 1720 = ~5s)
    if (
      this.heartbeatsSent < 5 &&
      (this.processCalls === 1 || this.processCalls % 1720 === 0)
    ) {
      this.heartbeatsSent++;
      this.port.postMessage({
        type: "heartbeat",
        calls: this.processCalls,
        playing: this.playing,
        position: this.position,
        haveChannels: !!this.channels,
        outChannels: out.length,
        framesPerBlock: out[0] ? out[0].length : 0,
      });
    }
    if (!this.playing || !this.channels) {
      // emit silence so the graph stays alive
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }
    const numFrames = out[0].length;
    const numCh = out.length;
    const srcCh = this.channels.length;

    for (let f = 0; f < numFrames; f++) {
      const i = this.position + f;
      if (i >= this.length) {
        // pad rest with zeros and signal end
        for (let c = 0; c < numCh; c++) out[c][f] = 0;
        if (i === this.length) this.port.postMessage({ type: "ended" });
      } else {
        for (let c = 0; c < numCh; c++) {
          // duplicate mono into stereo if needed
          const sc = c < srcCh ? c : srcCh - 1;
          const v = this.channels[sc][i];
          out[c][f] = v;
          if (!this.firstNonzeroLogged && v !== 0) {
            this.firstNonzeroLogged = true;
            this.port.postMessage({ type: "first-nonzero", position: i, value: v });
          }
        }
      }
    }
    this.position += numFrames;
    return true;
  }
}

registerProcessor("playback-processor", PlaybackProcessor);

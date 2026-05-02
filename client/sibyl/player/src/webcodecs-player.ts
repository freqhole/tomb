// webcodecs playback backend: takes mp3 chunks → AudioDecoder
// → planar f32 → ring buffer → AudioWorklet.
//
// phase 1 wires up the AudioContext + worklet but `decode()` is a stub;
// phase 2 fills in the real per-frame splitter (mp3 frames inside a
// chunk are independently decodable, so we can stream them through
// AudioDecoder one at a time as bytes arrive).

import type { ChunkRecord, CodecParams } from "./types.js";
import { createRingBuffer, type RingBuffer } from "./ring-buffer.js";

export interface WebcodecsBackendOpts {
  params: CodecParams;
  /** url to the worklet js (the demo app supplies this). */
  workletUrl: string;
  /** optional logger for decode lifecycle events (errors, milestones). */
  logger?: (msg: string) => void;
}

export class WebcodecsPlayer {
  private ctx?: AudioContext;
  private node?: AudioWorkletNode;
  private ring?: RingBuffer;
  private decoder?: AudioDecoder;
  private params: CodecParams;
  private workletUrl: string;
  private started = false;
  private decodeCalls = 0;
  private decodeOk = 0;
  private audioDataCount = 0;
  private log: (msg: string) => void;

  constructor(opts: WebcodecsBackendOpts) {
    this.params = opts.params;
    this.workletUrl = opts.workletUrl;
    this.log = opts.logger ?? (() => {});
  }

  async init(): Promise<void> {
    if (this.ctx) {
      this.log(`[webcodecs] init() called twice; reusing existing ctx (state=${this.ctx.state})`);
      return;
    }
    this.ctx = new AudioContext({ sampleRate: this.params.sample_rate });
    this.log(`[webcodecs] AudioContext created sampleRate=${this.ctx.sampleRate} state=${this.ctx.state}`);
    await this.ctx.audioWorklet.addModule(this.workletUrl);
    this.log(`[webcodecs] worklet module loaded from ${this.workletUrl}`);
    this.ring = createRingBuffer({
      capacityFrames: this.params.sample_rate * 4, // ~4s
      channelCount: this.params.channels,
    });

    const sab = this.ring.sab;
    this.log(`[webcodecs] ring buffer ready mode=${this.ring.mode} channels=${this.params.channels}`);
    this.node = new AudioWorkletNode(this.ctx, "sibyl-playback", {
      numberOfOutputs: 1,
      outputChannelCount: [this.params.channels],
      processorOptions: {
        mode: this.ring.mode,
        sab,
        channelCount: this.params.channels,
      },
    });
    // hand the node's built-in port to the ring so push() has a
    // destination. (you can't transfer a custom MessagePort via
    // processorOptions; the worklet's `this.port` is the only
    // bidirectional channel that's automatically wired.)
    if (this.ring.mode === "port") {
      this.ring.attachPort?.(this.node.port);
    }
    this.node.connect(this.ctx.destination);

    this.decoder = new AudioDecoder({
      output: (data) => this.onAudioData(data),
      error: (e) => {
        // surface decoder errors to both console and panel logger so
        // the user sees *why* playback dies (eg. "closed codec",
        // "empty buffer", "unsupported config").
        console.error("[sibyl] decoder error", e);
        this.log(`[webcodecs] decoder error: ${e.message ?? String(e)} (state=${this.decoder?.state ?? "?"})`);
      },
    });
    this.decoder.configure({
      codec: "mp3",
      sampleRate: this.params.sample_rate,
      numberOfChannels: this.params.channels,
    });
    this.log(`[webcodecs] decoder configured codec=mp3 state=${this.decoder.state}`);
  }

  /** push a chunk's bytes into the decoder. */
  decode(chunk: ChunkRecord): void {
    if (!this.decoder) throw new Error("init() not called");
    if (this.decoder.state === "closed") {
      // calling decode on a closed codec throws InvalidStateError and
      // unwinds the wasm progress callback, killing the download. log
      // and drop instead so subsequent chunks at least get cached.
      if (this.decodeCalls === this.decodeOk) {
        this.log(`[webcodecs] dropping seq=${chunk.seq}: decoder is closed`);
      }
      this.decodeCalls += 1;
      return;
    }
    if (chunk.bytes.byteLength === 0) {
      this.log(`[webcodecs] dropping seq=${chunk.seq}: 0-byte chunk (buffer detached?)`);
      return;
    }
    this.decodeCalls += 1;
    try {
      this.decoder.decode(
        new EncodedAudioChunk({
          type: "key",
          timestamp: chunk.seq * 1_000_000, // rough; phase 2 makes this real
          data: chunk.bytes,
        }),
      );
      this.decodeOk += 1;
      if (this.decodeOk === 1) this.log(`[webcodecs] first decode() submitted (seq=${chunk.seq}, ${chunk.bytes.byteLength} bytes)`);
      else if (this.decodeOk % 50 === 0) this.log(`[webcodecs] decoded ${this.decodeOk} chunks, ${this.audioDataCount} AudioData out`);
    } catch (e) {
      this.log(`[webcodecs] decode threw at seq=${chunk.seq}: ${(e as Error).message}`);
    }
  }

  async play(): Promise<void> {
    if (!this.ctx) throw new Error("init() not called");
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    this.started = true;
    this.log(`[webcodecs] play() ctx.state=${this.ctx.state} decoded=${this.decodeOk}/${this.decodeCalls} audioData=${this.audioDataCount}`);
  }
  pause(): void {
    this.ctx?.suspend();
  }
  setVolume(_v: number): void {
    // todo: gain node between worklet and destination
  }

  /** flush all in-flight decoded audio + reset the mp3 decoder so the
   *  next `decode()` starts from a clean slate. used when switching
   *  songs so leftover frames from the previous song don't continue
   *  playing first. */
  reset(): void {
    this.ring?.reset();
    if (this.decoder && this.decoder.state !== "closed") {
      try {
        this.decoder.reset();
        this.decoder.configure({
          codec: "mp3",
          sampleRate: this.params.sample_rate,
          numberOfChannels: this.params.channels,
        });
      } catch (e) {
        this.log(`[webcodecs] reset/reconfigure failed: ${(e as Error).message}`);
      }
    }
    this.decodeCalls = 0;
    this.decodeOk = 0;
    this.audioDataCount = 0;
    this.log(`[webcodecs] reset complete (ring drained, decoder reconfigured)`);
  }

  private onAudioData(data: AudioData): void {
    this.audioDataCount += 1;
    if (this.audioDataCount === 1) {
      this.log(`[webcodecs] first AudioData out: ${data.numberOfFrames} frames @ ${data.sampleRate}Hz, ${data.numberOfChannels}ch`);
    }
    if (!this.ring) {
      data.close();
      return;
    }
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < data.numberOfChannels; ch++) {
      const buf = new Float32Array(data.numberOfFrames);
      data.copyTo(buf, { planeIndex: ch, format: "f32-planar" });
      channels.push(buf);
    }
    this.ring.push(channels, data.sampleRate);
    data.close();
  }
}

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
}

export class WebcodecsPlayer {
  private ctx?: AudioContext;
  private node?: AudioWorkletNode;
  private ring?: RingBuffer;
  private decoder?: AudioDecoder;
  private params: CodecParams;
  private workletUrl: string;
  private started = false;

  constructor(opts: WebcodecsBackendOpts) {
    this.params = opts.params;
    this.workletUrl = opts.workletUrl;
  }

  async init(): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: this.params.sample_rate });
    await this.ctx.audioWorklet.addModule(this.workletUrl);
    this.ring = createRingBuffer({
      capacityFrames: this.params.sample_rate * 4, // ~4s
      channelCount: this.params.channels,
    });

    const port = this.ring.port;
    const sab = this.ring.sab;
    this.node = new AudioWorkletNode(this.ctx, "sibyl-playback", {
      numberOfOutputs: 1,
      outputChannelCount: [this.params.channels],
      processorOptions: {
        mode: sab ? "sab" : "channel",
        port,
        sab,
        channelCount: this.params.channels,
      },
      // transfer port to the processor side
      ...(port ? { transfer: [port] } : {}),
    } as AudioWorkletNodeOptions);
    this.node.connect(this.ctx.destination);

    this.decoder = new AudioDecoder({
      output: (data) => this.onAudioData(data),
      error: (e) => console.error("[sibyl] decoder error", e),
    });
    this.decoder.configure({
      codec: "mp3",
      sampleRate: this.params.sample_rate,
      numberOfChannels: this.params.channels,
    });
  }

  /** push a chunk's bytes into the decoder. */
  decode(chunk: ChunkRecord): void {
    if (!this.decoder) throw new Error("init() not called");
    // todo (phase 2): split chunk.bytes into individual mp3 frames
    // (sync-word scan) and feed each as an EncodedAudioChunk so the
    // decoder doesn't see partial frames at the end of a chunk.
    this.decoder.decode(
      new EncodedAudioChunk({
        type: "key",
        timestamp: chunk.seq * 1_000_000, // rough; phase 2 makes this real
        data: chunk.bytes,
      }),
    );
  }

  async play(): Promise<void> {
    if (!this.ctx) throw new Error("init() not called");
    if (!this.started) {
      await this.ctx.resume();
      this.started = true;
    }
  }
  pause(): void {
    this.ctx?.suspend();
  }
  setVolume(_v: number): void {
    // todo: gain node between worklet and destination
  }

  private onAudioData(data: AudioData): void {
    if (!this.ring) return;
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

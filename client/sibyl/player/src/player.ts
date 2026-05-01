// SibylPlayer: orchestrates a transport + cache + playback backend.
//
// this is the surface that downstream apps (sibyl demo, eventually
// freqhole's spume) interact with. construction injects every i/o
// dependency, so the player itself has no platform assumptions.
//
// the integration shape we're aiming for:
//
//   const player = new SibylPlayer({
//     transport: makeTauriTransport(invoke),
//     cache: await OpfsCache.open(),
//     backend: new WebcodecsPlayer({ params, workletUrl }),
//   });
//   await player.loadFromTicket(ticket);
//   await player.play();

import type { ChunkTransport } from "./transport.js";
import type { OpfsCache } from "./opfs-cache.js";
import type { WebcodecsPlayer } from "./webcodecs-player.js";
import type { RodioPlayer } from "./rodio-player.js";
import { decodeTicket } from "./ticket.js";
import type { ChunkRecord } from "./types.js";

export type PlaybackBackend = WebcodecsPlayer | RodioPlayer;

export interface SibylPlayerOpts {
  transport: ChunkTransport;
  cache: OpfsCache;
  backend: PlaybackBackend;
  logger?: (msg: string) => void;
}

export type PlayerEvent =
  | { type: "status"; songId?: string; state: "idle" | "loading" | "playing" | "paused" }
  | { type: "progress"; songId: string; chunksHave: number; chunksTotal?: number }
  | { type: "chunk"; songId: string; seq: number }
  | { type: "complete"; songId: string }
  | { type: "error"; error: string };

type Listener = (e: PlayerEvent) => void;

export class SibylPlayer {
  private opts: SibylPlayerOpts;
  private listeners = new Set<Listener>();
  private currentSongId?: string;
  private currentRequestCancel?: () => void;

  constructor(opts: SibylPlayerOpts) {
    this.opts = opts;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // -- loading -----------------------------------------------------------

  /** start downloading + playing a sibyl ticket. */
  async loadFromTicket(ticketStr: string): Promise<void> {
    const t = decodeTicket(ticketStr);
    this.currentSongId = t.song_id;
    this.emit({ type: "status", songId: t.song_id, state: "loading" });

    // figure out which chunks we already have
    const m = await this.opts.cache.manifest(t.song_id);
    const haveChunks = m?.chunks_have ?? [];

    // initialize backend if it has init() (webcodecs path)
    const be = this.opts.backend as WebcodecsPlayer;
    if (typeof be.init === "function") await be.init();

    const handle = await this.opts.transport.request(ticketStr, {
      haveChunks,
      onChunk: (chunk) => this.handleChunk(t.song_id, chunk),
      onComplete: () => this.emit({ type: "complete", songId: t.song_id }),
      onError: (e) => this.emit({ type: "error", error: e.message }),
    });
    this.currentRequestCancel = handle.cancel;
  }

  /** play an already-cached song without going to the network. */
  async loadFromCache(songId: string): Promise<void> {
    const m = await this.opts.cache.manifest(songId);
    if (!m) throw new Error(`no manifest for ${songId}`);
    this.currentSongId = songId;
    const be = this.opts.backend as WebcodecsPlayer;
    if (typeof be.init === "function") await be.init();
    for (const seq of m.chunks_have.slice().sort((a, b) => a - b)) {
      const bytes = await this.opts.cache.readChunk(songId, seq);
      if (!bytes) continue;
      this.feedDecoder({ seq, bytes, frame_count: m.params.frames_per_chunk });
    }
  }

  // -- transport-driven ingestion ---------------------------------------

  private async handleChunk(songId: string, chunk: ChunkRecord): Promise<void> {
    // persist
    await this.opts.cache.writeChunk(songId, chunk.seq, chunk.bytes);
    // update manifest
    const m = (await this.opts.cache.manifest(songId)) ?? {
      song_id: songId,
      params: {
        sample_rate: 44_100,
        channels: 2,
        bitrate_kbps: 192,
        frames_per_chunk: 40,
      },
      chunks_have: [],
      created_at: Date.now(),
    };
    if (!m.chunks_have.includes(chunk.seq)) m.chunks_have.push(chunk.seq);
    await this.opts.cache.writeManifest(m);
    // feed decoder
    this.feedDecoder(chunk);
    this.emit({ type: "chunk", songId, seq: chunk.seq });
    this.emit({
      type: "progress",
      songId,
      chunksHave: m.chunks_have.length,
      chunksTotal: m.chunks_total,
    });
  }

  private feedDecoder(chunk: ChunkRecord): void {
    const be = this.opts.backend as WebcodecsPlayer;
    if (typeof be.decode === "function") be.decode(chunk);
  }

  // -- transport control ------------------------------------------------

  async play(): Promise<void> {
    await this.opts.backend.play();
    this.emit({ type: "status", songId: this.currentSongId, state: "playing" });
  }

  pause(): void {
    void this.opts.backend.pause();
    this.emit({ type: "status", songId: this.currentSongId, state: "paused" });
  }

  /** abort any in-flight transport request. cache stays. */
  cancel(): void {
    this.currentRequestCancel?.();
    this.currentRequestCancel = undefined;
  }

  setVolume(v: number): void {
    void this.opts.backend.setVolume?.(v);
  }

  async hostFile(path: string, title?: string): Promise<{ ticket: string; songId: string }> {
    return this.opts.transport.host({ sourcePath: path, title });
  }

  // ---------------------------------------------------------------------

  private emit(e: PlayerEvent): void {
    this.opts.logger?.(`[sibyl] ${JSON.stringify(e)}`);
    for (const fn of this.listeners) fn(e);
  }
}

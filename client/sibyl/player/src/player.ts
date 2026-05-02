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
import type { ChunkCache } from "./cache.js";
import type { WebcodecsPlayer } from "./webcodecs-player.js";
import type { RodioPlayer } from "./rodio-player.js";
import { decodeTicket } from "./ticket.js";
import type { ChunkRecord, CodecParams, Manifest } from "./types.js";

export type PlaybackBackend = WebcodecsPlayer | RodioPlayer;

export interface SibylPlayerOpts {
  transport: ChunkTransport;
  cache: ChunkCache;
  backend: PlaybackBackend;
  logger?: (msg: string) => void;
}

export type PlayerEvent =
  | { type: "status"; songId?: string; state: "idle" | "loading" | "playing" | "paused" }
  | { type: "progress"; songId: string; chunksHave: number; chunksTotal?: number }
  | { type: "chunk"; songId: string; seq: number }
  | { type: "complete"; songId: string }
  | { type: "error"; error: string }
  | {
      type: "stats";
      songId?: string;
      chunksDownloaded: number;
      bytesDownloaded: number;
      decodeMsAvg: number;
      timeToFirstChunkMs?: number;
      sessionMs: number;
    };

type Listener = (e: PlayerEvent) => void;

export class SibylPlayer {
  private opts: SibylPlayerOpts;
  private listeners = new Set<Listener>();
  private currentSongId?: string;
  private currentRequestCancel?: () => void;
  private currentParams?: CodecParams;
  private currentTitle?: string;
  // in-memory manifest is the source of truth during a download. the
  // disk copy is a checkpoint flushed asynchronously. holding it here
  // (and never re-reading from disk inside the chunk hot path)
  // eliminates the read-modify-write race that previously dropped
  // most chunks_have entries when callbacks arrived concurrently.
  private manifest?: Manifest;
  private manifestDirty = false;
  private manifestFlushTimer?: ReturnType<typeof setTimeout>;
  private manifestFlushInFlight: Promise<void> = Promise.resolve();
  private completeEmitted = false;

  // -- diagnostics (phase-5-lite) -------------------------------------
  private statsStart = 0;
  private chunksDownloaded = 0;
  private bytesDownloaded = 0;
  private decodeMsTotal = 0;
  private decodeSamples = 0;
  private firstChunkAt?: number;
  private statsTimer?: ReturnType<typeof setInterval>;

  constructor(opts: SibylPlayerOpts) {
    this.opts = opts;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** cancel any in-flight transport request and flush leftover audio
   *  from the backend. called automatically before loading a new
   *  song; safe to call multiple times. */
  private stopCurrent(): void {
    if (this.currentRequestCancel) {
      try { this.currentRequestCancel(); } catch { /* ignore */ }
      this.currentRequestCancel = undefined;
    }
    // null out the in-memory manifest so any late chunk callbacks
    // from the cancelled request are dropped by handleChunk's
    // stale-arrival guard (`this.manifest.song_id !== songId`).
    this.manifest = undefined;
    this.manifestDirty = false;
    if (this.manifestFlushTimer) {
      clearTimeout(this.manifestFlushTimer);
      this.manifestFlushTimer = undefined;
    }
    const be = this.opts.backend as WebcodecsPlayer;
    if (typeof be.reset === "function") be.reset();
  }

  // -- loading -----------------------------------------------------------

  /** start downloading + playing a sibyl ticket. */
  async loadFromTicket(ticketStr: string): Promise<void> {
    const t = decodeTicket(ticketStr);
    // tear down anything from the previous song before we start a new
    // one. otherwise the worklet keeps draining queued audio from the
    // last song and the decoder appends new frames after the old.
    this.stopCurrent();
    this.currentSongId = t.song_id;
    this.currentParams = t.params;
    this.currentTitle = t.title ?? undefined;
    this.completeEmitted = false;
    this.resetStats();
    this.emit({ type: "status", songId: t.song_id, state: "loading" });

    // seed the in-memory manifest from disk (or fresh). after this
    // every mutation happens against `this.manifest` and disk i/o is
    // a debounced one-way flush.
    const onDisk = await this.opts.cache.manifest(t.song_id);
    this.manifest = onDisk ?? {
      song_id: t.song_id,
      params: this.currentParams,
      chunks_have: [],
      title: this.currentTitle,
      created_at: Date.now(),
      ticket: ticketStr,
    };
    // backfill ticket on resumed downloads that predate this field.
    if (!this.manifest.ticket) {
      this.manifest.ticket = ticketStr;
      this.manifestDirty = true;
      this.scheduleManifestFlush();
    }
    const haveChunks = this.manifest.chunks_have.slice();

    // initialize backend if it has init() (webcodecs path)
    const be = this.opts.backend as WebcodecsPlayer;
    if (typeof be.init === "function") await be.init();

    // feed cached chunks into the decoder *first*, in seq order, so
    // playback can start from existing material while the rest
    // streams in. (the network-supplied chunks may arrive
    // out-of-order with respect to the cache, but the decoder
    // tolerates monotonic-by-arrival timestamps.)
    if (this.manifest.chunks_have.length > 0) {
      const sorted = this.manifest.chunks_have.slice().sort((a, b) => a - b);
      for (const seq of sorted) {
        const bytes = await this.opts.cache.readChunk(t.song_id, seq);
        if (!bytes) continue;
        this.feedDecoder({
          seq,
          bytes,
          frame_count: this.manifest.params.frames_per_chunk,
        });
      }
      this.emit({
        type: "progress",
        songId: t.song_id,
        chunksHave: this.manifest.chunks_have.length,
        chunksTotal: this.manifest.chunks_total,
      });
    }

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
    // same teardown as loadFromTicket — drain queued audio + reset
    // the decoder so we don't hear the tail of the previous song.
    this.stopCurrent();
    this.currentSongId = songId;
    const be = this.opts.backend as WebcodecsPlayer;
    if (typeof be.init === "function") await be.init();
    const order = m.chunks_have.slice().sort((a, b) => a - b);
    this.opts.logger?.(`[sibyl] loadFromCache ${songId.slice(0, 24)}… feeding ${order.length} chunks`);
    let fed = 0;
    let missing = 0;
    for (const seq of order) {
      const bytes = await this.opts.cache.readChunk(songId, seq);
      if (!bytes) { missing += 1; continue; }
      this.feedDecoder({ seq, bytes, frame_count: m.params.frames_per_chunk });
      fed += 1;
    }
    this.opts.logger?.(`[sibyl] loadFromCache done: fed=${fed} missing=${missing}`);
  }

  // -- transport-driven ingestion ---------------------------------------

  private async handleChunk(songId: string, chunk: ChunkRecord): Promise<void> {
    if (this.firstChunkAt === undefined) this.firstChunkAt = performance.now();
    this.chunksDownloaded += 1;
    this.bytesDownloaded += chunk.bytes.byteLength;

    // feed the decoder *before* persisting. the opfs cache adapter
    // transfers `bytes.buffer` to its worker (detaching the
    // underlying ArrayBuffer), so any post-write read of chunk.bytes
    // would see a 0-byte view and the AudioDecoder would close with
    // "Null or empty decoder buffer". decoding is sync so this is
    // race-free with the upcoming await.
    this.feedDecoder(chunk);

    // persist the chunk bytes (independent file per seq, no race).
    await this.opts.cache.writeChunk(songId, chunk.seq, chunk.bytes);

    // mutate the in-memory manifest. handleChunk callbacks may
    // execute concurrently but JS is single-threaded *between*
    // awaits, so as long as we mutate before the next await this is
    // race-free. the disk flush is one-way and debounced.
    if (!this.manifest || this.manifest.song_id !== songId) {
      // late arrival from a previous request, or transport delivered
      // before loadFromTicket finished seeding. bail rather than
      // resurrect a stale manifest.
      return;
    }
    const m = this.manifest;
    if (!m.chunks_have.includes(chunk.seq)) m.chunks_have.push(chunk.seq);
    if (chunk.chunks_total !== undefined && m.chunks_total === undefined) {
      m.chunks_total = chunk.chunks_total;
    }
    this.manifestDirty = true;
    this.scheduleManifestFlush();
    // periodic forced flush so a long, steady stream of chunks
    // doesn't keep resetting the debounce timer indefinitely. every
    // ~25 chunks we checkpoint regardless of timer state \u2014 caps
    // worst-case progress lost on tab-close to ~25 chunks (~26 s at
    // mp3 default).
    if (m.chunks_have.length % 25 === 0) {
      void this.flushManifestNow();
    }

    this.emit({ type: "chunk", songId, seq: chunk.seq });
    this.emit({
      type: "progress",
      songId,
      chunksHave: m.chunks_have.length,
      chunksTotal: m.chunks_total,
    });
    if (
      !this.completeEmitted &&
      m.chunks_total !== undefined &&
      m.chunks_have.length >= m.chunks_total
    ) {
      this.completeEmitted = true;
      // ensure the disk manifest reflects the final state before any
      // listener that triggers reads it (e.g. tauri assemble step).
      await this.flushManifestNow();
      this.emit({ type: "complete", songId });
    }
  }

  private scheduleManifestFlush(): void {
    if (this.manifestFlushTimer) return;
    // short debounce: just enough to coalesce a burst of chunk
    // arrivals into one write, but small enough that an unexpected
    // tab close or crash loses at most ~50ms of progress tracking.
    this.manifestFlushTimer = setTimeout(() => {
      this.manifestFlushTimer = undefined;
      void this.flushManifestNow();
    }, 50);
  }

  /** force any pending manifest changes to disk immediately. safe
   *  to call any time; resolves once the on-disk copy reflects the
   *  current in-memory state. callers wire this to `pagehide` /
   *  `visibilitychange` so a tab close doesn't lose the last few
   *  hundred ms of download progress. */
  async flush(): Promise<void> {
    await this.flushManifestNow();
  }

  private async flushManifestNow(): Promise<void> {
    if (!this.manifest || !this.manifestDirty) return;
    if (this.manifestFlushTimer) {
      clearTimeout(this.manifestFlushTimer);
      this.manifestFlushTimer = undefined;
    }
    // serialize back-to-back flushes so a slow disk write can't
    // interleave with the next one.
    const snapshot: Manifest = {
      ...this.manifest,
      chunks_have: this.manifest.chunks_have.slice(),
    };
    this.manifestDirty = false;
    const prev = this.manifestFlushInFlight;
    this.manifestFlushInFlight = (async () => {
      try {
        await prev;
      } catch {
        // previous flush already reported its own error
      }
      try {
        await this.opts.cache.writeManifest(snapshot);
      } catch (e) {
        this.emit({
          type: "error",
          error: `manifest flush: ${(e as Error).message}`,
        });
      }
    })();
    return this.manifestFlushInFlight;
  }

  private feedDecoder(chunk: ChunkRecord): void {
    const be = this.opts.backend as WebcodecsPlayer;
    if (typeof be.decode === "function") {
      const t0 = performance.now();
      be.decode(chunk);
      this.decodeMsTotal += performance.now() - t0;
      this.decodeSamples += 1;
    }
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

  /** pause the network download (audio playback continues from
   *  whatever is already buffered). leaves manifest + cached chunks
   *  intact so `resumeDownload()` (or a future `loadFromTicket` with
   *  the same ticket, e.g. after a page reload) picks up where we
   *  stopped. */
  pauseDownload(): void {
    if (!this.currentRequestCancel) return;
    this.currentRequestCancel();
    this.currentRequestCancel = undefined;
    this.emit({
      type: "status",
      songId: this.currentSongId,
      state: "paused",
    });
  }

  /** resume a paused or interrupted download. only valid while a
   *  manifest is loaded (i.e. after `loadFromTicket` or
   *  `loadFromCache`); the manifest must carry a ticket. unlike
   *  `loadFromTicket` this does NOT reset the audio backend or
   *  re-feed cached chunks \u2014 already-buffered audio keeps playing
   *  while the network catches up on what's missing. */
  async resumeDownload(): Promise<void> {
    const m = this.manifest;
    if (!m) throw new Error("resumeDownload: no manifest loaded");
    if (!m.ticket) throw new Error("resumeDownload: manifest has no stored ticket");
    if (this.currentRequestCancel) return; // already running
    if (m.chunks_total !== undefined && m.chunks_have.length >= m.chunks_total) {
      return; // nothing to do
    }
    const haveChunks = m.chunks_have.slice();
    this.opts.logger?.(
      `[sibyl] resumeDownload ${m.song_id.slice(0, 24)}\u2026 have=${haveChunks.length}${m.chunks_total ? "/" + m.chunks_total : ""}`,
    );
    const handle = await this.opts.transport.request(m.ticket, {
      haveChunks,
      onChunk: (chunk) => this.handleChunk(m.song_id, chunk),
      onComplete: () => this.emit({ type: "complete", songId: m.song_id }),
      onError: (e) => this.emit({ type: "error", error: e.message }),
    });
    this.currentRequestCancel = handle.cancel;
    this.emit({
      type: "status",
      songId: m.song_id,
      state: "loading",
    });
  }

  setVolume(v: number): void {
    void this.opts.backend.setVolume?.(v);
  }

  async hostFile(path: string, title?: string): Promise<{ ticket: string; songId: string }> {
    return this.opts.transport.host({ sourcePath: path, title });
  }

  // ---------------------------------------------------------------------

  private emit(e: PlayerEvent): void {
    // only log low-frequency lifecycle events at this layer. callers
    // that want chunk/progress/stats can subscribe via on() and route
    // them to the ui without going through the logger.
    if (e.type === "status" || e.type === "complete" || e.type === "error") {
      this.opts.logger?.(`[sibyl] ${JSON.stringify(e)}`);
    }
    for (const fn of this.listeners) fn(e);
  }

  // -- diagnostics ------------------------------------------------------

  private resetStats(): void {
    this.statsStart = performance.now();
    this.chunksDownloaded = 0;
    this.bytesDownloaded = 0;
    this.decodeMsTotal = 0;
    this.decodeSamples = 0;
    this.firstChunkAt = undefined;
    if (this.statsTimer === undefined) {
      this.statsTimer = setInterval(() => this.emitStats(), 1000);
    }
  }

  private emitStats(): void {
    this.emit({
      type: "stats",
      songId: this.currentSongId,
      chunksDownloaded: this.chunksDownloaded,
      bytesDownloaded: this.bytesDownloaded,
      decodeMsAvg:
        this.decodeSamples > 0 ? this.decodeMsTotal / this.decodeSamples : 0,
      timeToFirstChunkMs:
        this.firstChunkAt !== undefined
          ? Math.round(this.firstChunkAt - this.statsStart)
          : undefined,
      sessionMs: Math.round(performance.now() - this.statsStart),
    });
  }

  /** stop diagnostics timer (call when tearing down). */
  destroy(): void {
    if (this.statsTimer !== undefined) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
  }
}

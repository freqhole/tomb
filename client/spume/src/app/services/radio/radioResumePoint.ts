/**
 * remembers which radio chunk sits where on the media element's timeline,
 * so a pause can tell the broadcaster EXACTLY which chunk the listener
 * was playing (`init_seq` + `seq` + offset) instead of a guessed track
 * position. the broadcaster runs well ahead of the playhead, so "where
 * the server froze" is not "where the listener paused" - see
 * grimoire/src/radio/resume_point.rs for how the server uses this.
 */

export interface AppendedChunk {
  /** init seq of the track this chunk belongs to. */
  initSeq: number;
  seq: number;
  /** media-element time this chunk starts/ends at. */
  startS: number;
  endS: number;
}

export interface ResumePoint {
  initSeq: number;
  seq: number;
  offsetMs: number;
}

/** keeps a bounded log of appended chunks; oldest drop off first. */
export class AppendedChunkLog {
  private chunks: AppendedChunk[] = [];
  private trackStarts = new Map<number, number>();

  constructor(private readonly capacity = 600) {}

  record(chunk: AppendedChunk): void {
    if (!(chunk.endS > chunk.startS)) return;
    this.chunks.push(chunk);
    if (this.chunks.length > this.capacity) this.chunks.shift();
  }

  /** where a track's init landed on the timeline. */
  recordTrackStart(initSeq: number, timeS: number): void {
    this.trackStarts.set(initSeq, timeS);
    if (this.trackStarts.size > 50) {
      const oldest = this.trackStarts.keys().next().value;
      if (oldest !== undefined) this.trackStarts.delete(oldest);
    }
  }

  /** the buffered timeline was rebuilt - stored positions mean nothing now. */
  clear(): void {
    this.chunks = [];
    this.trackStarts.clear();
  }

  get size(): number {
    return this.chunks.length;
  }

  /** the chunk playing at `currentTimeS`, as a resume point. */
  resumePointAt(currentTimeS: number): ResumePoint | null {
    if (!Number.isFinite(currentTimeS)) return null;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      if (currentTimeS >= c.startS && currentTimeS < c.endS) {
        return {
          initSeq: c.initSeq,
          seq: c.seq,
          offsetMs: Math.max(0, Math.round((currentTimeS - c.startS) * 1000)),
        };
      }
    }
    return null;
  }

  /**
   * best-effort track position at `currentTimeS`: time since the track's
   * init landed here. underestimates when this listener joined mid-track
   * (replaying a bit beats skipping), 0 when unknown.
   */
  trackPositionAt(initSeq: number, currentTimeS: number): number {
    const start = this.trackStarts.get(initSeq);
    if (start === undefined || !Number.isFinite(currentTimeS)) return 0;
    return Math.max(0, currentTimeS - start);
  }

  /** where on the timeline to land when resuming into `point`'s chunk. */
  seekTargetFor(point: ResumePoint): number | null {
    const c = this.chunks.find((x) => x.initSeq === point.initSeq && x.seq === point.seq);
    if (!c) return null;
    return Math.min(c.startS + point.offsetMs / 1000, c.endS);
  }
}

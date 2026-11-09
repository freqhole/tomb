// play qualification is independent of resume position and queue-history completion.
export class PlayCompletion {
  playedSeconds = 0;
  private lastPosition: number | null = null;
  private lastObservedAt = 0;
  private wasPlaying = false;
  private recorded = false;

  observe(
    position: number,
    duration: number,
    playing: boolean,
    nowMs = performance.now()
  ): boolean {
    const delta = this.lastPosition === null ? 0 : position - this.lastPosition;
    if (playing && this.wasPlaying && Number.isFinite(delta) && delta > 0 && delta < 5) {
      // short seeks must not manufacture more watch time than actually elapsed.
      this.playedSeconds += Math.min(delta, Math.max(0, nowMs - this.lastObservedAt) / 1000);
    }
    if (position !== this.lastPosition || playing !== this.wasPlaying) {
      this.lastObservedAt = nowMs;
    }
    this.lastPosition = Number.isFinite(position) ? position : null;
    this.wasPlaying = playing;
    if (
      !this.recorded &&
      Number.isFinite(duration) &&
      duration > 0 &&
      this.playedSeconds / duration > 0.9
    ) {
      this.recorded = true;
      return true;
    }
    return false;
  }

  eventData(duration: number): Record<string, number> {
    return { played_seconds: this.playedSeconds, duration_seconds: duration };
  }
}

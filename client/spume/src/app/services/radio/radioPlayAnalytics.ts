import { PlayCompletion } from "../../../music/services/analytics/playCompletion";

export interface RadioPlayObservation {
  stationKey: string;
  initSeq: number | null;
  entityId: string | null;
  kind: "song" | "video";
  durationS: number;
  positionS: number;
  playing: boolean;
}

export class RadioPlayAnalytics {
  private current: RadioPlayObservation | null = null;
  private completion = new PlayCompletion();

  observe(item: RadioPlayObservation, nowMs = performance.now()): Record<string, number> | null {
    const previous = this.current;
    if (
      !previous ||
      previous.stationKey !== item.stationKey ||
      previous.entityId !== item.entityId ||
      previous.kind !== item.kind ||
      (previous.initSeq !== null && previous.initSeq !== item.initSeq)
    ) {
      this.completion = new PlayCompletion();
    }
    this.current = item;
    if (!item.entityId) return null;
    return this.completion.observe(item.positionS, item.durationS, item.playing, nowMs)
      ? this.completion.eventData(item.durationS)
      : null;
  }

  pause(nowMs = performance.now()): void {
    if (this.current) {
      this.observe({ ...this.current, playing: false }, nowMs);
    }
  }

  reset(): void {
    this.current = null;
    this.completion = new PlayCompletion();
  }
}

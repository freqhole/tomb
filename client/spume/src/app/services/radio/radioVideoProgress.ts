// writes series/video resume progress for videos watched on a radio
// station - the same `playback_progressz` rows queue playback writes via
// videoServerProgressSync.ts, so "pick up where you left off" sees them.
// written to the station's own library (the video ids belong to it) and
// kept just as infrequent: a ~60s tick while playing, plus a flush when
// the track changes, the listener pauses/leaves, or an admin skip cuts in.
import type { ApiClient } from "../../api/client";
import { warn } from "../../../utils/logger";

export type RadioProgressClient = {
  entities: Pick<ApiClient["entities"], "upsertPlaybackProgress">;
};

export interface RadioVideoObservation {
  /** init_seq of the audible track, or null before it's known. */
  initSeq: number | null;
  /** video id when the audible track is a video, otherwise null. */
  videoId: string | null;
  durationS: number;
  positionS: number;
  playing: boolean;
  getClient: () => Promise<RadioProgressClient>;
  sessionId: () => string | null;
}

interface TrackedVideo {
  initSeq: number | null;
  videoId: string;
  durationS: number;
  positionS: number;
  ended: boolean;
  lastSyncAt: number;
  getClient: () => Promise<RadioProgressClient>;
  sessionId: () => string | null;
}

const SYNC_INTERVAL_MS = 60_000;

export class RadioVideoProgress {
  private current: TrackedVideo | null = null;

  observe(item: RadioVideoObservation, nowMs = Date.now()): void {
    const cur = this.current;
    if (!item.videoId || !(item.durationS > 0)) {
      if (cur) void this.flush();
      return;
    }
    const sameVideo = cur?.videoId === item.videoId;
    // a retune/resync re-primes the same video under a new init_seq (and
    // the first track's init_seq can become known after its metadata) -
    // keep tracking it unless it really played to the end.
    if (cur && sameVideo && !cur.ended) cur.initSeq = item.initSeq;
    if (!cur || !sameVideo || cur.initSeq !== item.initSeq) {
      if (cur) void this.flush();
      if (!item.playing) return;
      this.current = {
        initSeq: item.initSeq,
        videoId: item.videoId,
        durationS: item.durationS,
        positionS: Math.max(0, item.positionS),
        ended: false,
        lastSyncAt: nowMs,
        getClient: item.getClient,
        sessionId: item.sessionId,
      };
      return;
    }
    if (!item.playing) return;
    cur.positionS = Math.max(cur.positionS, item.positionS);
    if (nowMs - cur.lastSyncAt >= SYNC_INTERVAL_MS) {
      cur.lastSyncAt = nowMs;
      void this.send(cur, false, cur.sessionId());
    }
  }

  /** the playhead reached the end of this track's media (not a skip). */
  markEnded(initSeq: number | null): void {
    if (this.current && initSeq !== null && this.current.initSeq === initSeq) {
      this.current.ended = true;
    }
  }

  flush(): Promise<void> {
    const cur = this.current;
    this.current = null;
    if (!cur) return Promise.resolve();
    return this.send(cur, cur.ended, cur.sessionId());
  }

  private async send(t: TrackedVideo, completed: boolean, sessionId: string | null) {
    // a listener who joined mid-episode only knows time since joining, so
    // a natural end is the reliable "finished" signal.
    const positionS = completed ? t.durationS : Math.min(t.positionS, t.durationS);
    if (!completed && positionS <= 0) return;
    try {
      const client = await t.getClient();
      const result = await client.entities.upsertPlaybackProgress({
        entity_type: "video",
        entity_id: t.videoId,
        position_fraction: Math.max(0, Math.min(1, positionS / t.durationS)),
        position_seconds: positionS,
        duration_seconds: t.durationS,
        session_id: sessionId ?? undefined,
      });
      if (!result.success) warn("radio/videoProgress", "failed to save progress:", result.error);
    } catch (error) {
      warn("radio/videoProgress", "failed to save progress:", error);
    }
  }
}

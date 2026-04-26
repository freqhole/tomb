-- 025: per-station timeline-only mode
--
-- when timeline_only_mode = 1, the broadcaster will not open an audio
-- uni stream for this station. all listeners receive only timeline
-- control messages and must use the queue-based playback path.
--
-- useful for:
--   - stations where ffmpeg is available but the operator wants
--     queue-mode for all listeners regardless
--   - testing/rolling out timeline mode before fully deprecating MSE
ALTER TABLE radio_stationz
    ADD COLUMN timeline_only_mode INTEGER NOT NULL DEFAULT 0;

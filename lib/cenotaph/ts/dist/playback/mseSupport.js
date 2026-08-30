// media source extensions support detection, used to choose between
// true chunk-streamed playback (radio-style) and a download-then-play
// fallback (mirrors spume's radioService/radioQueueAdapter split - see
// docs/player-remote-site-plan.md phase 4b).
export const hasMSE = typeof window !== "undefined" &&
    typeof window.MediaSource === "function";
export function choosePlaybackMode() {
    return hasMSE ? "chunk_stream" : "download_then_play";
}

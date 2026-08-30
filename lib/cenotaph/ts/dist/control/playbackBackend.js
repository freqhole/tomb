// pluggable playback implementation a host app supplies to the control
// dispatcher - decouples command handling from any one playback engine, so
// a host app can drive its OWN existing player/queue instead of running a
// second, parallel playback engine just to answer remote commands.
//
// player.freqhole.net wraps its own playback/playbackEngine.ts +
// playback/radioClient.ts; spume wraps its own real player + queue
// services (see docs/cenotaph-migration-plan.md phase 1).
export {};

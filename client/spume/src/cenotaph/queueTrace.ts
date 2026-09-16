// shared, grep-able tag for tracing the whole cenotaph queue-push
// pipeline (dispatcher -> accept bridge -> playback adapter -> media
// resolve -> ack/toast) across multiple files. see
// docs/cenotaph-queue-ux-hardening-plan.md - intentionally PERMANENT
// logging, not a temporary debugging aid: `grep CENOTAPH_QUEUE_TRACE` on
// a shared log file should surface the whole story, in order, for a
// single queue push.
export const CENOTAPH_QUEUE_TRACE = "CENOTAPH_QUEUE_TRACE";

export const PROGRESS_POLL_INTERVAL_MS = 5000;

export function sourceShort(s: string): string {
  switch (s) {
    case "mb":
      return "mb";
    case "lastfm":
      return "lf";
    case "audiodb":
      return "ad";
    default:
      return s.toLowerCase();
  }
}

export function isTerminalDone(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s === "completed" || s === "enriched" || s === "no_match" || s === "done" || s === "complete"
  );
}

export function isInflight(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s === "running" ||
    s === "queued" ||
    s === "pending" ||
    s === "searching" ||
    s === "fetching_detail"
  );
}

export function isFailed(status: string): boolean {
  const s = status.toLowerCase();
  return s === "failed" || s === "error" || s.includes("error");
}

export function statusGlyph(status: string, hasError = false): string {
  if (hasError || isFailed(status)) return "!";
  if (isTerminalDone(status)) return "✓";
  if (isInflight(status)) return "…";
  return "·";
}

// priority order: musicbrainz > lastfm > audiodb. matches the
// `ProposalSource` enum on the server side; the wire serialization
// uses snake_case variants ("mb" / "lastfm" / "audiodb").
export function pickSource(sources: string[]): "mb" | "lastfm" | "audiodb" {
  if (sources.includes("mb")) return "mb";
  if (sources.includes("lastfm")) return "lastfm";
  if (sources.includes("audiodb")) return "audiodb";
  return "mb";
}

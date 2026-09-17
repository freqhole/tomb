// tiny, dependency-free video mime <-> extension map - shared by
// syncVideoToLocal.ts and ephemeralFetch.ts. kept in its own module (no
// other imports) so neither of those two files has to import from the
// other's dependency chain just to reuse this small lookup.

const MIME_TO_EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
};

export function extensionFromMime(mime: string): string {
  return MIME_TO_EXTENSION[mime] ?? "mp4";
}

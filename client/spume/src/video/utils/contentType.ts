// shared video content type helpers - mirrors grimoire's `Video::content_type`
// values (see grimoire/src/video/entities/videos/models.rs).

export const VIDEO_CONTENT_TYPES = ["series", "movie", "clip", "karaoke", "music_video"] as const;

export type VideoContentType = (typeof VIDEO_CONTENT_TYPES)[number];

/** human-friendly label for a content type ("music_video" -> "music video"). */
export function contentTypeLabel(contentType: string | null | undefined): string {
  if (!contentType) return "";
  return contentType.replace(/_/g, " ");
}

/** true for the content types that point at an artist + album. */
export function isMusicContentType(contentType: string | null | undefined): boolean {
  return contentType === "music_video" || contentType === "karaoke";
}

/** the album a music-type video lands in when an artist is picked but no
 * album is ("music videos" / "karaoke videos"). */
export function defaultAlbumTitle(contentType: string | null | undefined): string | null {
  if (contentType === "music_video") return "music videos";
  if (contentType === "karaoke") return "karaoke videos";
  return null;
}

/**
 * Essential thumbnail utilities
 * Simplified to keep only the core functions needed across the codebase
 */

import type { MediaBlob } from "./websocket-types";

/**
 * Create a data URL from binary data array
 * This is the core function that converts thumbnail binary data to usable blob URLs
 */
export function createDataUrl(data: number[], mimeType: string): string {
  const uint8Array = new Uint8Array(data);
  const blob = new Blob([uint8Array], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Get an appropriate fallback icon for a file type based on MIME type
 */
export function getThumbnailFallbackIcon(mimeType?: string): string {
  if (!mimeType) return "📄";

  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎥";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType.includes("pdf")) return "📕";
  if (mimeType.includes("text")) return "📝";
  if (mimeType.includes("zip") || mimeType.includes("archive")) return "📦";
  if (mimeType.includes("json") || mimeType.includes("xml")) return "📊";

  return "📄";
}

/**
 * Extract thumbnails from MediaBlob metadata
 */
export function getThumbnails(item: MediaBlob): MediaBlob[] {
  return (item.metadata?.thumbnails as MediaBlob[]) || [];
}

/**
 * Check if a MediaBlob has thumbnails
 */
export function hasThumbnails(item: MediaBlob): boolean {
  return (
    item.metadata?.has_thumbnails === true || getThumbnails(item).length > 0
  );
}

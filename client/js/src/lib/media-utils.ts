/**
 * Media-specific utility functions for MediaBlob objects
 * Framework-agnostic functions for media file handling
 */

export interface MediaBlob {
  id: string;
  mime?: string;
  blob_type: string;
  size: number;
  parent_id?: string;
  local_path?: string;
  created_at: string;
  updated_at: string;
  filename?: string;
  sha256?: string;
  metadata?: any;
}

/**
 * Extract a display-friendly filename from a MediaBlob
 * Prioritizes metadata fields, falls back to filename or generates from hash
 */
export function getDisplayFilename(item: MediaBlob): string {
  if (item.metadata && typeof item.metadata === "object") {
    const meta = item.metadata as any;
    if (
      meta.originalName ||
      meta.filename ||
      meta.original_filename ||
      meta.file_name ||
      meta.name
    ) {
      return (
        meta.originalName ||
        meta.filename ||
        meta.original_filename ||
        meta.file_name ||
        meta.name
      );
    }
  }
  return (
    item.filename ||
    item.local_path?.split("/").pop() ||
    `${item.sha256?.slice(0, 8) || item.id.slice(0, 8)}...${item.sha256?.slice(-4) || item.id.slice(-4)}`
  );
}

/**
 * Get an appropriate icon for a file type based on MIME type
 * @deprecated Use getThumbnailFallbackIcon from thumbnail-utils.ts instead
 */
export function getFileTypeIcon(mimeType?: string): string {
  if (!mimeType) return "📄";

  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎥";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType.startsWith("text/")) return "📝";
  if (mimeType.includes("pdf")) return "📕";
  if (mimeType.includes("zip") || mimeType.includes("archive")) return "📦";
  if (mimeType.includes("json") || mimeType.includes("xml")) return "🔧";

  return "📄";
}

/**
 * Get a human-readable file type category
 */
export function getFileTypeCategory(mimeType?: string): string {
  if (!mimeType) return "Unknown";

  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.startsWith("video/")) return "Video";
  if (mimeType.startsWith("audio/")) return "Audio";
  if (mimeType.startsWith("text/")) return "Text";
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("zip") || mimeType.includes("archive"))
    return "Archive";
  if (mimeType.includes("json") || mimeType.includes("xml")) return "Data";

  return "File";
}

/**
 * Check if a MediaBlob represents an image that can be displayed
 * @deprecated Use isDisplayableImage from thumbnail-utils.ts instead
 */
export function isDisplayableImage(item: MediaBlob): boolean {
  const mime = item.mime?.toLowerCase();
  return !!(
    mime &&
    (mime.startsWith("image/jpeg") ||
      mime.startsWith("image/jpg") ||
      mime.startsWith("image/png") ||
      mime.startsWith("image/gif") ||
      mime.startsWith("image/webp") ||
      mime.startsWith("image/svg"))
  );
}

/**
 * Check if a MediaBlob represents a video file
 */
export function isVideo(item: MediaBlob): boolean {
  return !!item.mime?.startsWith("video/");
}

/**
 * Check if a MediaBlob represents an audio file
 */
export function isAudio(item: MediaBlob): boolean {
  return !!item.mime?.startsWith("audio/");
}

/**
 * Generate a thumbnail URL for a MediaBlob (placeholder implementation)
 * @deprecated Use getThumbnailUrl from thumbnail-utils.ts instead
 */
export function getThumbnailUrl(
  item: MediaBlob,
  apiBaseUrl: string
): string | null {
  if (isDisplayableImage(item)) {
    return `${apiBaseUrl}/api/blobs/${item.id}/thumbnail`;
  }
  return null;
}

/**
 * Generate a download URL for a MediaBlob
 */
export function getDownloadUrl(item: MediaBlob, apiBaseUrl: string): string {
  return `${apiBaseUrl}/api/blobs/${item.id}`;
}

/**
 * Extract thumbnails from MediaBlob metadata
 * Re-exported from thumbnail-utils for convenience
 */
export {
  getThumbnails,
  hasThumbnails,
  supportsThumbnails,
} from "./thumbnail-utils";

/**
 * Enhanced thumbnail functions - use these instead of deprecated ones above
 */
export {
  getThumbnailUrl as getEnhancedThumbnailUrl,
  getThumbnailPreviewUrl,
  getAllThumbnailUrls,
  isDisplayableImage as isEnhancedDisplayableImage,
  getThumbnailFallbackIcon,
  createDataUrl,
  createTemporaryDataUrl,
  createPlaceholderThumbnail,
  createLoadingPlaceholder,
  createErrorPlaceholder,
  thumbnailManager,
  thumbnailCache,
  ThumbnailManager,
  ThumbnailCache,
} from "./thumbnail-utils";

/**
 * Sort MediaBlob items by a given field
 */
export function sortMediaBlobs<T extends MediaBlob>(
  items: T[],
  field: keyof T,
  direction: "asc" | "desc" = "asc"
): T[] {
  return [...items].sort((a, b) => {
    const aValue = a[field];
    const bValue = b[field];

    let comparison = 0;
    if (aValue < bValue) comparison = -1;
    else if (aValue > bValue) comparison = 1;

    return direction === "desc" ? comparison * -1 : comparison;
  });
}

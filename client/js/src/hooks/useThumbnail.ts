/**
 * Simple thumbnail hook that encapsulates the proven working pattern
 *
 * This hook consolidates all the thumbnail logic that was scattered across components
 * and provides a clean, consistent interface for thumbnail display.
 *
 * Based on the working pattern from MediaBlobFeedItem that successfully:
 * - Extracts thumbnails from metadata.thumbnails array
 * - Creates blob URLs from binary data
 * - Handles auto-requesting thumbnails
 * - Provides fallback icons
 */

import { createSignal, createMemo, onMount } from "solid-js";
import type { MediaBlob } from "../lib/websocket-types";
import { getThumbnailFallbackIcon } from "../lib/media-utils";

export interface UseThumbnailProps {
  item: MediaBlob;
  onRequestThumbnails?: (itemId: string) => void;
  requestedThumbnails?: Set<string>;
  autoRequest?: boolean;
}

export interface ThumbnailState {
  /**
   * The thumbnail URL (blob: URL) if available, null otherwise
   */
  url: string | null;

  /**
   * Whether the item has thumbnails in metadata
   */
  hasThumbnails: boolean;

  /**
   * Whether thumbnails have been requested for this item
   */
  isRequested: boolean;

  /**
   * Fallback icon for when no thumbnail is available
   */
  fallbackIcon: string;

  /**
   * Function to call when image fails to load
   */
  onImageError: () => void;
}

/**
 * Create a data URL from binary data array
 * This is the core function that converts thumbnail binary data to usable URLs
 */
function createDataUrl(data: number[], mimeType: string): string {
  const uint8Array = new Uint8Array(data);
  const blob = new Blob([uint8Array], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Hook that provides thumbnail functionality for MediaBlob items
 *
 * @param props Configuration for thumbnail handling
 * @returns ThumbnailState with URL and utility functions
 */
export function useThumbnail(props: UseThumbnailProps): ThumbnailState {
  const [imageError, setImageError] = createSignal(false);
  const [autoRequested, setAutoRequested] = createSignal(false);

  // Extract thumbnails from metadata with smart prioritization
  const thumbnails = createMemo(() => {
    const thumbs = (props.item.metadata?.thumbnails as MediaBlob[]) || [];

    // Sort by priority: album art → waveforms → other types
    const sorted = thumbs.sort((a, b) => {
      const getPriority = (thumb: MediaBlob) => {
        switch (thumb.blob_type) {
          case "thumbnail":
            return 1; // Embedded album art (highest priority)
          case "waveform":
            return 2; // Waveform visualization (fallback)
          default:
            return 3; // Other types (lowest priority)
        }
      };

      return getPriority(a) - getPriority(b);
    });

    return sorted;
  });

  const hasThumbnails = createMemo(() => {
    return (
      props.item.metadata?.has_thumbnails === true || thumbnails().length > 0
    );
  });

  const isRequested = createMemo(() => {
    return (
      props.requestedThumbnails?.has(props.item.id) ||
      props.item.metadata?.thumbnails_requested ||
      autoRequested()
    );
  });

  // Generate thumbnail URL using the exact working pattern
  const thumbnailUrl = createMemo(() => {
    if (imageError()) return null;

    const thumbs = thumbnails();
    if (thumbs.length > 0 && thumbs[0]) {
      const thumbnail = thumbs[0];
      // Use binary data to create blob URL (the working approach)
      if (thumbnail.data && thumbnail.data.length > 0) {
        const mimeType = thumbnail.mime || "image/webp";
        return createDataUrl(thumbnail.data, mimeType);
      }
    }

    return null;
  });

  const fallbackIcon = createMemo(() => {
    return getThumbnailFallbackIcon(props.item.mime);
  });

  // Auto-request thumbnails if enabled and needed
  onMount(() => {
    if (props.autoRequest !== false) {
      const alreadyRequested =
        props.requestedThumbnails?.has(props.item.id) ||
        props.item.metadata?.thumbnails_requested;

      // Auto-request thumbnails if we don't have them yet
      if (!hasThumbnails() && !alreadyRequested && props.onRequestThumbnails) {
        setAutoRequested(true);
        props.onRequestThumbnails(props.item.id);
      }
    }
  });

  const handleImageError = () => {
    setImageError(true);
  };

  return {
    url: thumbnailUrl(),
    hasThumbnails: hasThumbnails(),
    isRequested: isRequested(),
    fallbackIcon: fallbackIcon(),
    onImageError: handleImageError,
  };
}

export default useThumbnail;

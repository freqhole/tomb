import { createSignal, createEffect } from "solid-js";
import { apiClient } from "./api-client";

export interface ImageSource {
  id: string;
  thumbnail_blob_id?: string | null;
  thumbnail_blob_ids?: string[] | null;
  album_thumbnail_id?: string | null;
  image_url?: string | null;
  media_blob_id?: string | null;
}

export interface ImageOptions {
  preferredType?: 'thumbnail' | 'waveform' | 'preview';
  fallbackToParent?: boolean;
  size?: 'small' | 'medium' | 'large';
}

/**
 * Central utility for handling image URLs across the app
 * Consolidates all the scattered image URL logic into one place
 */
export function useImageUrl(source: ImageSource | null, options: ImageOptions = {}) {
  const [imageUrl, setImageUrl] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const getImageUrl = (source: ImageSource): string | null => {
    if (!source) return null;

    // Priority 1: Direct image_url (already a full URL or path)
    if (source.image_url) {
      if (source.image_url.startsWith("/api/blobs/")) {
        return `${apiClient.getBaseUrl()}${source.image_url}`;
      }
      if (source.image_url.startsWith("http")) {
        return source.image_url;
      }
      return `${apiClient.getBaseUrl()}/api/blobs/${source.image_url}`;
    }

    // Priority 2: Direct thumbnail_blob_id
    if (source.thumbnail_blob_id) {
      return `${apiClient.getBaseUrl()}/api/blobs/${source.thumbnail_blob_id}`;
    }

    // Priority 3: First item from thumbnail_blob_ids array
    if (source.thumbnail_blob_ids && source.thumbnail_blob_ids.length > 0) {
      return `${apiClient.getBaseUrl()}/api/blobs/${source.thumbnail_blob_ids[0]}`;
    }

    // Priority 4: Album thumbnail (for songs that inherit from album)
    if (source.album_thumbnail_id) {
      return `${apiClient.getBaseUrl()}/api/blobs/${source.album_thumbnail_id}`;
    }

    return null;
  };

  const fetchChildImages = async (mediaId: string): Promise<string | null> => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${apiClient.getBaseUrl()}/api/blobs/${mediaId}/children?type=${options.preferredType || 'thumbnail'}`,
        { credentials: "include" }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch child images: ${response.status}`);
      }

      const children = await response.json();

      // Return the first matching image
      if (children && children.length > 0) {
        return `${apiClient.getBaseUrl()}/api/blobs/${children[0].id}`;
      }

      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load image");
      return null;
    } finally {
      setLoading(false);
    }
  };

  createEffect(async () => {
    if (!source) {
      setImageUrl(null);
      return;
    }

    // Try direct image URL first
    const directUrl = getImageUrl(source);
    if (directUrl) {
      setImageUrl(directUrl);
      return;
    }

    // Fallback: try to fetch child images if we have a media_blob_id
    if (options.fallbackToParent && source.media_blob_id) {
      const childUrl = await fetchChildImages(source.media_blob_id);
      setImageUrl(childUrl);
    } else {
      setImageUrl(null);
    }
  });

  return {
    url: imageUrl,
    loading,
    error,
    hasImage: () => !!imageUrl(),
  };
}

/**
 * Simple synchronous helper for getting image URLs when you don't need reactivity
 */
export function getImageUrl(source: ImageSource | null): string | null {
  if (!source) return null;

  // Priority 1: Direct image_url
  if (source.image_url) {
    if (source.image_url.startsWith("/api/blobs/")) {
      return `${apiClient.getBaseUrl()}${source.image_url}`;
    }
    if (source.image_url.startsWith("http")) {
      return source.image_url;
    }
    return `${apiClient.getBaseUrl()}/api/blobs/${source.image_url}`;
  }

  // Priority 2: Direct thumbnail_blob_id
  if (source.thumbnail_blob_id) {
    return `${apiClient.getBaseUrl()}/api/blobs/${source.thumbnail_blob_id}`;
  }

  // Priority 3: First item from thumbnail_blob_ids array
  if (source.thumbnail_blob_ids && source.thumbnail_blob_ids.length > 0) {
    return `${apiClient.getBaseUrl()}/api/blobs/${source.thumbnail_blob_ids[0]}`;
  }

  // Priority 4: Album thumbnail
  if (source.album_thumbnail_id) {
    return `${apiClient.getBaseUrl()}/api/blobs/${source.album_thumbnail_id}`;
  }

  return null;
}

/**
 * Get fallback icon based on domain type
 */
export function getTypeIcon(domainType: string): string {
  switch (domainType) {
    case "album":
      return "♪";
    case "playlist":
      return "♭";
    case "artist":
      return "♫";
    case "genre":
      return "♬";
    case "song":
      return "♩";
    case "video":
      return "⏵";
    case "photo":
      return "📷";
    default:
      return "♪";
  }
}

/**
 * Format duration for display
 */
export function formatDuration(seconds: number | string): string {
  if (!seconds) return "";
  const secs = typeof seconds === "string" ? parseFloat(seconds) : seconds;
  if (isNaN(secs) || secs < 60) {
    return `${Math.floor(secs)}s`;
  }
  if (secs < 3600) {
    const mins = Math.floor(secs / 60);
    const remainSecs = Math.floor(secs % 60);
    return `${mins}:${remainSecs.toString().padStart(2, "0")}`;
  }
  const hours = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  return `${hours}h ${mins}m`;
}

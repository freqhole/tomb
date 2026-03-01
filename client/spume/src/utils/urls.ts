/**
 * URL helpers for remote media resources
 *
 * wraps freqhole-api-client's URL functions and adds tauri protocol support
 * when running in tauri mode. all code in spume should use these functions
 * instead of constructing URLs directly.
 */

import { utils } from "freqhole-api-client";
import { isTauriMode } from "./tauri";

/**
 * get the URL for a remote media resource (image or audio)
 *
 * in web mode, returns standard https URL (uses cookies for auth)
 * in tauri mode, appends api key as query param (webkit2gtk doesn't support
 * custom protocols for media sources, so we use direct HTTP with ?key=)
 *
 * @param baseUrl - remote server base URL (e.g., "https://music.example.com")
 * @param mediaId - the media ID on the server
 * @param apiKey - optional API key (required in tauri mode)
 */
export function getRemoteMediaUrl(baseUrl: string, mediaId: string, apiKey?: string): string {
  const standardUrl = utils.getMediaUrl(baseUrl, mediaId);

  if (!isTauriMode()) {
    return standardUrl;
  }

  // tauri mode - append api key as query param for direct HTTP access
  // webkit2gtk doesn't trust custom protocols (freqhole://) for <audio> sources
  if (apiKey) {
    return `${standardUrl}?key=${encodeURIComponent(apiKey)}`;
  }

  return standardUrl;
}

/**
 * alias for getRemoteMediaUrl - makes intent clearer for image URLs
 */
export function getRemoteImageUrl(baseUrl: string, mediaId: string, apiKey?: string): string {
  return getRemoteMediaUrl(baseUrl, mediaId, apiKey);
}

/**
 * alias for getRemoteMediaUrl - makes intent clearer for audio URLs
 */
export function getRemoteAudioUrl(baseUrl: string, mediaId: string, apiKey?: string): string {
  return getRemoteMediaUrl(baseUrl, mediaId, apiKey);
}

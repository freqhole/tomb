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
 * in web mode, returns standard https URL
 * in tauri mode, returns freqhole:// protocol URL for auth header injection
 *
 * @param baseUrl - remote server base URL (e.g., "https://music.example.com")
 * @param mediaId - the media ID on the server
 * @param apiKey - optional API key (used in tauri mode)
 */
export function getRemoteMediaUrl(baseUrl: string, mediaId: string, apiKey?: string): string {
  const standardUrl = utils.getMediaUrl(baseUrl, mediaId);

  if (!isTauriMode()) {
    return standardUrl;
  }

  // tauri mode - use custom protocol for auth header injection
  const params = new URLSearchParams();
  params.set("url", standardUrl);
  if (apiKey) {
    params.set("key", apiKey);
  }

  return `freqhole://proxy?${params.toString()}`;
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

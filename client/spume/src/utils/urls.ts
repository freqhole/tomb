/**
 * URL helpers for remote media resources
 *
 * wraps freqhole-api-client's URL functions. all code in spume should use
 * these functions instead of constructing URLs directly.
 */

import { utils } from "freqhole-api-client";

/**
 * get the URL for a remote media resource (image or audio)
 *
 * returns standard URL that uses session cookies for authentication
 *
 * @param baseUrl - remote server base URL (e.g., "https://music.example.com")
 * @param mediaId - the media ID on the server
 */
export function getRemoteMediaUrl(baseUrl: string, mediaId: string): string {
  return utils.getMediaUrl(baseUrl, mediaId);
}

/**
 * alias for getRemoteMediaUrl - makes intent clearer for image URLs
 */
export function getRemoteImageUrl(baseUrl: string, mediaId: string): string {
  return getRemoteMediaUrl(baseUrl, mediaId);
}

/**
 * alias for getRemoteMediaUrl - makes intent clearer for audio URLs
 */
export function getRemoteAudioUrl(baseUrl: string, mediaId: string): string {
  return getRemoteMediaUrl(baseUrl, mediaId);
}

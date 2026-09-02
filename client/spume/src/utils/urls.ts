/**
 * URL helpers for remote media resources
 *
 * wraps freqhole-api-client's URL functions. all code in spume should use
 * these functions instead of constructing URLs directly.
 */

import { utils } from "../app/api/client";

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

/**
 * ensure a user-entered external link (e.g. a bare "freqhole.net" typed
 * into an entity-url field) has a URL scheme, so `<a href>` doesn't
 * resolve it as a path relative to the current origin instead of
 * navigating out to the actual external site. leaves already-schemed
 * URLs (http://, https://, mailto:, etc.) untouched.
 */
export function withUrlProtocol(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

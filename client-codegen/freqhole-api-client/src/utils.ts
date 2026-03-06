// url helpers
//
// pure URL builders for resources. these don't make network requests —
// they just return the URL string for use in <audio src>, <img src>, etc.

/**
 * get the url for a media resource (audio file, image)
 * use this in <audio src={...}>, <img src={...}>, or for direct downloads
 */
export function getMediaUrl(baseUrl: string, mediaId: string): string {
  return `${baseUrl}/api/blobs/${mediaId}`;
}

/**
 * get the metadata endpoint url for a media resource
 */
export function getMediaMetadataUrl(baseUrl: string, mediaId: string): string {
  return `${baseUrl}/api/blobs/${mediaId}/metadata`;
}

/**
 * get the url for a playlist by id
 * note: this returns the api endpoint url, not a streaming url
 */
export function getPlaylistUrl(baseUrl: string, playlistId: string): string {
  return `${baseUrl}/api/music/playlists/${playlistId}`;
}

/**
 * get the url for a fetch job by id
 */
export function getFetchJobUrl(baseUrl: string, jobId: string): string {
  return `${baseUrl}/api/music/fetch/${jobId}`;
}

// ============================================================================
// TODO: refactor getPlaylistEtag to use Transport
//
// this function bypasses Transport and uses fetch() directly because:
// 1. it needs response headers (etag), but Transport only returns {status, body}
// 2. it's a HEAD request, which Transport.request() could handle but headers can't
//
// to fix this properly:
// - extend TransportResponse to include headers: Record<string, string>
// - update HttpTransport.request() to capture and return headers
// - move this to client.music.getPlaylistEtag() (route already exists)
// - delete this function
//
// until then, this is HTTP-only and won't work with other transports.
// ============================================================================

/**
 * get a playlist's etag (content hash for sync detection)
 * uses HEAD request to /api/music/playlists/{id}/etag
 * returns null if the playlist doesn't exist or request fails
 *
 * @deprecated use via Transport when headers support is added
 */
export async function getPlaylistEtag(
  baseUrl: string,
  playlistId: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${baseUrl}/api/music/playlists/${playlistId}/etag`, {
      method: "HEAD",
      credentials: "include",
    });

    if (!response.ok) {
      return null;
    }

    // etag is in the response headers
    const etag = response.headers.get("etag");
    return etag ? etag.replace(/"/g, "") : null;
  } catch {
    return null;
  }
}

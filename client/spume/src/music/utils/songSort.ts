// central song sorting utilities
// provides canonical ordering for songs: group by album, then sort by disc+track

import type { Song } from "../services/storage/types";

/**
 * sort songs in canonical order: grouped by album, sorted by disc+track within each album
 *
 * this is the default display order for songs everywhere except:
 * - queue (has its own order)
 * - playlists (have position field)
 * - search results (relevance-based)
 *
 * @param songs - array of songs to sort
 * @returns sorted array (does not mutate input)
 */
export function sortSongsCanonical(songs: Song[]): Song[] {
  const sorted = [...songs];

  sorted.sort((a, b) => {
    // first: group by album (using album_id for stability)
    if (a.album_id !== b.album_id) {
      // secondary sort by album title for visual grouping
      return a.album_title.localeCompare(b.album_title);
    }

    // within same album: sort by disc number
    const discA = a.disc_number || 1;
    const discB = b.disc_number || 1;
    if (discA !== discB) {
      return discA - discB;
    }

    // within same disc: sort by track number
    const trackA = a.track_number || 0;
    const trackB = b.track_number || 0;
    if (trackA !== trackB) {
      return trackA - trackB;
    }

    // fallback: sort by title
    return a.title.localeCompare(b.title);
  });

  return sorted;
}

/**
 * sort songs by artist, then apply canonical album+disc+track ordering
 *
 * useful for artist detail views
 *
 * @param songs - array of songs to sort
 * @returns sorted array (does not mutate input)
 */
export function sortSongsByArtist(songs: Song[]): Song[] {
  const sorted = [...songs];

  sorted.sort((a, b) => {
    // first: group by artist
    if (a.artist_name !== b.artist_name) {
      return a.artist_name.localeCompare(b.artist_name);
    }

    // then by album
    if (a.album_title !== b.album_title) {
      return a.album_title.localeCompare(b.album_title);
    }

    // then disc number
    const discA = a.disc_number || 1;
    const discB = b.disc_number || 1;
    if (discA !== discB) {
      return discA - discB;
    }

    // then track number
    const trackA = a.track_number || 0;
    const trackB = b.track_number || 0;
    if (trackA !== trackB) {
      return trackA - trackB;
    }

    // fallback: title
    return a.title.localeCompare(b.title);
  });

  return sorted;
}

/**
 * sort songs by a specific field, with fallback to canonical ordering
 *
 * @param songs - array of songs to sort
 * @param field - field to sort by
 * @param direction - sort direction
 * @returns sorted array (does not mutate input)
 */
export function sortSongsBy(
  songs: Song[],
  field: keyof Song,
  direction: "asc" | "desc" = "asc",
): Song[] {
  const sorted = [...songs];
  const dir = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];

    // handle null/undefined
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1 * dir;
    if (bVal == null) return -1 * dir;

    // compare values
    let comparison = 0;
    if (typeof aVal === "string" && typeof bVal === "string") {
      comparison = aVal.localeCompare(bVal);
    } else if (typeof aVal === "number" && typeof bVal === "number") {
      comparison = aVal - bVal;
    } else {
      comparison = String(aVal).localeCompare(String(bVal));
    }

    return comparison * dir;
  });

  return sorted;
}

/**
 * sort songs by UI field name (maps VirtualSongList field names to Song properties)
 *
 * @param songs - array of songs to sort
 * @param uiField - UI field name from VirtualSongList
 * @param direction - sort direction
 * @returns sorted array (does not mutate input)
 */
export function sortSongsByUIField(
  songs: Song[],
  uiField: string,
  direction: "asc" | "desc",
): Song[] {
  const sorted = [...songs];
  const dir = direction === "asc" ? 1 : -1;

  sorted.sort((a, b) => {
    let aVal: any;
    let bVal: any;

    // map UI field names to Song properties
    switch (uiField) {
      case "track":
        // sort by track number (with disc as secondary)
        if (a.disc_number !== b.disc_number) {
          return ((a.disc_number || 1) - (b.disc_number || 1)) * dir;
        }
        aVal = a.track_number || 0;
        bVal = b.track_number || 0;
        break;
      case "title":
        aVal = a.title;
        bVal = b.title;
        break;
      case "artist":
        aVal = a.artist_name;
        bVal = b.artist_name;
        break;
      case "album":
        aVal = a.album_title;
        bVal = b.album_title;
        break;
      case "genre":
        // genre is in album, not directly on song - skip for now
        return 0;
      case "year":
        aVal = a.year;
        bVal = b.year;
        break;
      case "duration":
        aVal = a.duration_seconds;
        bVal = b.duration_seconds;
        break;
      case "favorite":
      case "rating":
        // these need to be fetched separately from favorites/ratings tables
        return 0;
      default:
        return 0;
    }

    // handle null/undefined
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1 * dir;
    if (bVal == null) return -1 * dir;

    // compare values
    let comparison = 0;
    if (typeof aVal === "string" && typeof bVal === "string") {
      comparison = aVal.localeCompare(bVal);
    } else if (typeof aVal === "number" && typeof bVal === "number") {
      comparison = aVal - bVal;
    } else {
      comparison = String(aVal).localeCompare(String(bVal));
    }

    return comparison * dir;
  });

  return sorted;
}

/**
 * group songs by album and return as map
 *
 * useful for album grid views or when you need to process albums separately
 *
 * @param songs - array of songs to group
 * @returns map of album_id to sorted songs in that album
 */
export function groupSongsByAlbum(songs: Song[]): Map<string, Song[]> {
  const groups = new Map<string, Song[]>();

  for (const song of songs) {
    if (!groups.has(song.album_id)) {
      groups.set(song.album_id, []);
    }
    groups.get(song.album_id)!.push(song);
  }

  // sort songs within each album by disc+track
  for (const [albumId, albumSongs] of groups.entries()) {
    albumSongs.sort((a, b) => {
      const discA = a.disc_number || 1;
      const discB = b.disc_number || 1;
      if (discA !== discB) return discA - discB;

      const trackA = a.track_number || 0;
      const trackB = b.track_number || 0;
      if (trackA !== trackB) return trackA - trackB;

      return a.title.localeCompare(b.title);
    });
  }

  return groups;
}

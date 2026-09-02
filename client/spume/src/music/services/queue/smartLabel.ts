// compute a human-friendly label for a list of songs
// used by server sessions and IDB history to derive meaningful session names.
//
// rules:
//   all same album  → album title
//   all same artist → artist name
//   2 artists       → "artist a & artist b"
//   3+ artists      → "artist a, artist b & N others"
//   fallback        → "N songs"
// the result is truncated to ~100 characters.

import type { Song } from "../storage/types";
import { songsOnly, videosOnly, type MediaItem } from "../../../app/services/storage/mediaItem";

const MAX_LABEL_LENGTH = 100;

export function computeSmartLabel(songs: Song[]): string {
  if (songs.length === 0) return "";
  if (songs.length === 1) {
    const s = songs[0];
    return truncate(`${s.title} – ${s.artist_name}`, MAX_LABEL_LENGTH);
  }

  // check if all songs share the same album
  const albumIds = new Set(songs.map((s) => s.album_id).filter(Boolean));
  if (albumIds.size === 1) {
    const albumTitle = songs[0].album_title;
    if (albumTitle) return truncate(albumTitle, MAX_LABEL_LENGTH);
  }

  // check if all songs share the same artist
  const artistIds = new Set(songs.map((s) => s.artist_id).filter(Boolean));
  if (artistIds.size === 1) {
    const artistName = songs[0].artist_name;
    if (artistName) return truncate(artistName, MAX_LABEL_LENGTH);
  }

  // multiple artists — build a combined label
  // collect unique artist names preserving first-seen order
  const seen = new Set<string>();
  const artistNames: string[] = [];
  for (const s of songs) {
    const id = s.artist_id;
    if (id && !seen.has(id)) {
      seen.add(id);
      artistNames.push(s.artist_name);
    }
  }

  if (artistNames.length === 2) {
    return truncate(`${artistNames[0]} & ${artistNames[1]}`, MAX_LABEL_LENGTH);
  }

  if (artistNames.length >= 3) {
    const others = artistNames.length - 2;
    return truncate(
      `${artistNames[0]}, ${artistNames[1]} & ${others} ${others === 1 ? "other" : "others"}`,
      MAX_LABEL_LENGTH
    );
  }

  // fallback
  return `${songs.length} songs`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

// mixed-media generalization of computeSmartLabel — dispatches to the
// existing song-based rules for a song-only list, falls back to simple
// title/count-based labels for video-only or genuinely mixed lists (video
// metadata doesn't carry an artist-equivalent grouping concept worth
// mirroring the album/artist rules above for).
export function computeSmartMediaLabel(items: MediaItem[]): string {
  const hasSong = items.some((i) => i.kind === "song");
  const hasVideo = items.some((i) => i.kind === "video");

  if (hasSong && !hasVideo) return computeSmartLabel(songsOnly(items));

  if (hasVideo && !hasSong) {
    const videos = videosOnly(items);
    if (videos.length === 1) return truncate(videos[0].title, MAX_LABEL_LENGTH);
    return `${videos.length} videos`;
  }

  // genuinely mixed (both songs and videos)
  return `${items.length} items`;
}

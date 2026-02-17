// image display utilities — handles fallback logic for songs with missing cover art

import type { ImageMetadata } from "../music/services/storage/types";

// filter out waveform images from a list
function nonWaveform(imgs?: ImageMetadata[]): ImageMetadata[] {
  return (imgs || []).filter((img) => img.blob_type !== "waveform");
}

// get the best display images for a song, falling back to album images.
// excludes waveforms since they shouldn't be used as cover art thumbnails.
export function getSongDisplayImages(song: {
  images?: ImageMetadata[];
  album_images?: ImageMetadata[];
}): ImageMetadata[] | undefined {
  if (!song) return undefined;
  const songImgs = nonWaveform(song.images);
  if (songImgs.length > 0) return songImgs;
  const albumImgs = nonWaveform(song.album_images);
  if (albumImgs.length > 0) return albumImgs;
  // fall through to undefined so components show their default icon
  return song.images && song.images.length > 0 ? song.images : undefined;
}

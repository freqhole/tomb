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

/**
 * pick the best single image for a queue history entry.
 * prefers non-waveform images, checks album_images as fallback,
 * and scans across multiple songs if the first song has no usable image.
 * only returns a waveform as an absolute last resort.
 */
export function pickBestEntryImage(
  songs: Array<{ images?: ImageMetadata[]; album_images?: ImageMetadata[] }>,
  sourceImage?: ImageMetadata,
): ImageMetadata | undefined {
  // 1. use the source-provided image if it's not a waveform
  if (sourceImage && sourceImage.blob_type !== "waveform") {
    return sourceImage;
  }

  // 2. scan songs for the first non-waveform image (song images, then album images)
  for (const song of songs) {
    const songImgs = nonWaveform(song.images);
    if (songImgs.length > 0) return songImgs[0];
    const albumImgs = nonWaveform(song.album_images);
    if (albumImgs.length > 0) return albumImgs[0];
  }

  // 3. fallback: source image even if waveform
  if (sourceImage) return sourceImage;

  // 4. last resort: any image at all from any song
  for (const song of songs) {
    if (song.images && song.images.length > 0) return song.images[0];
    if (song.album_images && song.album_images.length > 0) return song.album_images[0];
  }

  return undefined;
}

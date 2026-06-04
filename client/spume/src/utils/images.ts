// image display utilities — handles fallback logic for songs with missing cover art

import type { ImageMetadata } from "../music/services/storage/types";

// extended type to handle IDB data that may have 'type' instead of 'blob_type'
// (some IndexedDB data stores use 'type' instead of 'blob_type')
type ImageDataWithTypeFallback = ImageMetadata & { type?: string };

// filter out waveform images from a list
function nonWaveform(imgs?: ImageMetadata[]): ImageMetadata[] {
  return (imgs || []).filter((img) => img.blob_type !== "waveform");
}

/**
 * pick the best single image from an array of images.
 * handles both ImageMetadata (blob_type) and raw IDB data (type).
 * 
 * priority order:
 * 1. primary thumbnail
 * 2. any thumbnail
 * 3. primary original
 * 4. any original  
 * 5. waveform (last resort before returning null)
 * 6. first available image
 */
export function pickBestImage(images?: ImageMetadata[] | null): ImageMetadata | null {
  if (!images || images.length === 0) return null;

  // spread to unwrap SolidJS store proxies, cast to handle IDB type fallback
  const arr = [...images] as ImageDataWithTypeFallback[];
  if (arr.length === 0) return null;

  const getType = (img: ImageDataWithTypeFallback) => img.blob_type || img.type;

  // 1. primary thumbnail
  const primaryThumb = arr.find((img) => img.is_primary && getType(img) === "thumbnail");
  if (primaryThumb) return primaryThumb;

  // 2. any thumbnail
  const anyThumb = arr.find((img) => getType(img) === "thumbnail");
  if (anyThumb) return anyThumb;

  // 3. primary original (non-waveform)
  const primaryOriginal = arr.find((img) => img.is_primary && getType(img) === "original");
  if (primaryOriginal) return primaryOriginal;

  // 4. any original
  const anyOriginal = arr.find((img) => getType(img) === "original");
  if (anyOriginal) return anyOriginal;

  // 5. waveform as last resort (still better than nothing)
  const waveform = arr.find((img) => getType(img) === "waveform");
  if (waveform) return waveform;

  // 6. absolute fallback - first image regardless of type
  return arr[0] || null;
}

// get the best display images for a song, falling back to album images.
// excludes waveforms since they shouldn't be used as cover art thumbnails.
//
// note: in this system, song-level images stored as blob_type "original" are
// often actually waveforms (the blob taxonomy is fuzzy — waveforms get linked
// into song_imagez and may carry "original" blob_type). album-level images
// are more reliably real cover art. so we merge album images FIRST then song
// images and let pickBestImage rank them. this preserves the behavior where:
//   - a real song-specific "thumbnail" still wins over album "original"
//   - an album "original" cover beats a song "original" (likely waveform)
//   - waveforms with proper blob_type="waveform" are still filtered out
export function getSongDisplayImages(song: {
  id?: string;
  title?: string;
  images?: ImageMetadata[];
  album_images?: ImageMetadata[];
}): ImageMetadata[] | undefined {
  if (!song) return undefined;
  const songImgs = nonWaveform(song.images);
  const albumImgs = nonWaveform(song.album_images);

  // merge album-first so pickBestImage prefers album originals over song
  // "original"-typed images (which are commonly mistyped waveforms).
  const merged = [...albumImgs, ...songImgs];
  if (merged.length > 0) return merged;

  // last-resort raw fallback (only waveforms present? show nothing)
  return undefined;
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

/**
 * get the waveform image from a song's images array.
 * returns the first image with blob_type === 'waveform', or undefined if none found.
 */
export function getWaveformImage(images?: ImageMetadata[] | null): ImageMetadata | undefined {
  if (!images || images.length === 0) return undefined;
  // spread to unwrap SolidJS store proxies, cast to handle IDB type fallback
  const arr = [...images] as ImageDataWithTypeFallback[];
  const waveform = arr.find((img) => (img.blob_type || img.type) === "waveform");
  return waveform || undefined;
}

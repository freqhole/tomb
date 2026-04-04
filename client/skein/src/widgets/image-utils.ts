/**
 * shared utilities for picking image files from the user's device
 * and converting them to small WebP data URLs.
 */

/**
 * options for picking and resizing an image file.
 */
export interface PickImageOptions {
  /** maximum output width in pixels (default: 200) */
  maxWidth?: number;
  /** maximum output height in pixels (default: 200) */
  maxHeight?: number;
  /** WebP quality 0–1 (default: 0.8) */
  quality?: number;
  /** if true, center-crop to a square before resizing (default: false) */
  cropSquare?: boolean;
}

const DEFAULT_MAX_WIDTH = 200;
const DEFAULT_MAX_HEIGHT = 200;
const DEFAULT_QUALITY = 0.8;

/**
 * open a native file picker for images, resize and encode as a WebP data URL.
 * returns null if the user cancels or an error occurs.
 */
export async function pickImageAsDataUrl(
  options?: PickImageOptions,
): Promise<string | null> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.style.display = "none";

  document.body.appendChild(input);

  try {
    input.click();

    const file = await new Promise<File | null>((resolve) => {
      input.addEventListener("change", () => {
        resolve(input.files?.[0] ?? null);
      });

      // detect cancellation — the input element fires no event on cancel,
      // but a focus event on the window fires shortly after the picker closes.
      const onFocus = () => {
        window.removeEventListener("focus", onFocus);
        // small delay so "change" fires first if a file was picked
        setTimeout(() => resolve(null), 300);
      };
      window.addEventListener("focus", onFocus);
    });

    if (!file) {
      return null;
    }

    return await resizeImageToDataUrl(file, options);
  } catch {
    return null;
  } finally {
    input.remove();
  }
}

/**
 * resize an image File/Blob to a WebP data URL.
 * useful when you already have the file (e.g. from drag-and-drop).
 * returns null on error.
 */
export async function resizeImageToDataUrl(
  file: Blob,
  options?: PickImageOptions,
): Promise<string | null> {
  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = options?.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const quality = options?.quality ?? DEFAULT_QUALITY;
  const cropSquare = options?.cropSquare ?? false;

  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await createImageBitmap(file);

    // source region defaults to the full image
    let sx = 0;
    let sy = 0;
    let sw = bitmap.width;
    let sh = bitmap.height;

    if (cropSquare) {
      // center-crop to a square using the minimum dimension
      const minDim = Math.min(bitmap.width, bitmap.height);
      sx = (bitmap.width - minDim) / 2;
      sy = (bitmap.height - minDim) / 2;
      sw = minDim;
      sh = minDim;
    }

    // fit within maxWidth x maxHeight while preserving aspect ratio
    const sourceAspect = sw / sh;
    let outW = sw;
    let outH = sh;

    if (outW > maxWidth) {
      outW = maxWidth;
      outH = Math.round(outW / sourceAspect);
    }

    if (outH > maxHeight) {
      outH = maxHeight;
      outW = Math.round(outH * sourceAspect);
    }

    // ensure dimensions are at least 1px
    outW = Math.max(1, outW);
    outH = Math.max(1, outH);

    const offscreen = new OffscreenCanvas(outW, outH);
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) {
      return null;
    }

    offCtx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);

    bitmap.close();
    bitmap = null;

    const blob = await offscreen.convertToBlob({
      type: "image/webp",
      quality,
    });

    // convert blob to data URL via FileReader
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    return dataUrl;
  } catch {
    return null;
  } finally {
    if (bitmap) {
      bitmap.close();
    }
  }
}

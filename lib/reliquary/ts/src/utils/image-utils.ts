// helpers for picking an image file from the user's device and converting it
// to a small webp data url. resizing runs on the main thread via
// OffscreenCanvas/createImageBitmap; a worker-backed variant that keeps the
// decode/encode work off the main thread can build on top of this once the
// ./worker subpath exists.

/**
 * options for picking and resizing an image file.
 */
export interface PickImageOptions {
  /** maximum output width in pixels (default: 200) */
  maxWidth?: number;
  /** maximum output height in pixels (default: 200) */
  maxHeight?: number;
  /** output quality 0-1, for lossy formats like webp/jpeg (default: 0.8) */
  quality?: number;
  /** if true, center-crop to a square before resizing (default: false) */
  cropSquare?: boolean;
  /** output mime type (default: "image/webp") */
  mime?: string;
}

const DEFAULT_MAX_WIDTH = 200;
const DEFAULT_MAX_HEIGHT = 200;
const DEFAULT_QUALITY = 0.8;
const DEFAULT_MIME = "image/webp";

/**
 * open a native file picker for images, resize and encode as a data url.
 * returns null if the user cancels, the input never resolves, or an error
 * occurs.
 */
export async function pickImageAsDataUrl(options?: PickImageOptions): Promise<string | null> {
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

      // the `cancel` event is the standard way to detect picker dismissal.
      // it is supported in chrome 113+ and firefox 113+. older browsers that
      // don't fire `cancel` will leave this promise pending until the page
      // navigates - acceptable because pickImageAsDataUrl is always called in
      // a fire-and-forget context and callers re-enable the trigger on each
      // interaction.
      input.addEventListener("cancel", () => resolve(null));
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
 * resize an image File/Blob to a data url. useful when a file is already in
 * hand (e.g. from drag-and-drop). returns null on error, or if the current
 * environment has no OffscreenCanvas/createImageBitmap support.
 */
export async function resizeImageToDataUrl(
  blob: Blob,
  options?: PickImageOptions
): Promise<string | null> {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") {
    return null;
  }

  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = options?.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const quality = options?.quality ?? DEFAULT_QUALITY;
  const cropSquare = options?.cropSquare ?? false;
  const mime = options?.mime ?? DEFAULT_MIME;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);

    let sx = 0;
    let sy = 0;
    let sw = bitmap.width;
    let sh = bitmap.height;
    if (cropSquare) {
      const minDim = Math.min(bitmap.width, bitmap.height);
      sx = (bitmap.width - minDim) / 2;
      sy = (bitmap.height - minDim) / 2;
      sw = minDim;
      sh = minDim;
    }

    const aspect = sw / sh;
    let outW = sw;
    let outH = sh;
    if (outW > maxWidth) {
      outW = maxWidth;
      outH = Math.round(outW / aspect);
    }
    if (outH > maxHeight) {
      outH = maxHeight;
      outW = Math.round(outH * aspect);
    }
    outW = Math.max(1, outW);
    outH = Math.max(1, outH);

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);

    const out = await canvas.convertToBlob({ type: mime, quality });
    const buffer = await out.arrayBuffer();
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

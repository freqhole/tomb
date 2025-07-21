// Image Service for Album Art and Playlist Covers
// Handles extraction, processing, and management of images

export interface ImageProcessingResult {
  success: boolean;
  imageData?: ArrayBuffer;
  thumbnailData?: ArrayBuffer;
  error?: string;
  metadata?: {
    width: number;
    height: number;
    format: string;
    size: number;
  };
}

export interface AlbumArtExtractionResult {
  success: boolean;
  albumArt?: string;
  error?: string;
}

// Extract album art from audio file using ID3 tags
export async function extractAlbumArt(
  file: File
): Promise<AlbumArtExtractionResult> {
  try {
    // Read file as ArrayBuffer for ID3 parsing
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    // Check for ID3v2 tag (starts with "ID3")
    if (buffer.byteLength < 10) {
      return { success: false, error: "File too small to contain ID3 tags" };
    }

    const id3Header = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2)
    );
    if (id3Header !== "ID3") {
      return { success: false, error: "No ID3v2 tag found" };
    }

    // Parse ID3v2 header
    const majorVersion = view.getUint8(3);
    // const minorVersion = view.getUint8(4);
    // const flags = view.getUint8(5);

    // Calculate tag size (synchsafe integer)
    const tagSize =
      ((view.getUint8(6) & 0x7f) << 21) |
      ((view.getUint8(7) & 0x7f) << 14) |
      ((view.getUint8(8) & 0x7f) << 7) |
      (view.getUint8(9) & 0x7f);

    let offset = 10;
    const endOffset = Math.min(10 + tagSize, buffer.byteLength);

    // Search for APIC frame (Attached Picture)
    while (offset < endOffset - 10) {
      // Read frame header
      const frameId = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );

      if (frameId === "APIC") {
        // Found album art frame
        const frameSize =
          majorVersion === 4
            ? // ID3v2.4 uses synchsafe integers
              ((view.getUint8(offset + 4) & 0x7f) << 21) |
              ((view.getUint8(offset + 5) & 0x7f) << 14) |
              ((view.getUint8(offset + 6) & 0x7f) << 7) |
              (view.getUint8(offset + 7) & 0x7f)
            : // ID3v2.3 uses regular integers
              (view.getUint8(offset + 4) << 24) |
              (view.getUint8(offset + 5) << 16) |
              (view.getUint8(offset + 6) << 8) |
              view.getUint8(offset + 7);

        // const frameFlags = (view.getUint8(offset + 8) << 8) | view.getUint8(offset + 9);
        let frameOffset = offset + 10;

        // Skip encoding byte
        frameOffset++;

        // Read MIME type (null-terminated)
        let mimeType = "";
        while (frameOffset < endOffset && view.getUint8(frameOffset) !== 0) {
          mimeType += String.fromCharCode(view.getUint8(frameOffset));
          frameOffset++;
        }
        frameOffset++; // Skip null terminator

        // Skip picture type byte
        frameOffset++;

        // Skip description (null-terminated)
        while (frameOffset < endOffset && view.getUint8(frameOffset) !== 0) {
          frameOffset++;
        }
        frameOffset++; // Skip null terminator

        // Extract image data
        const imageDataSize = frameSize - (frameOffset - offset - 10);
        if (
          imageDataSize > 0 &&
          frameOffset + imageDataSize <= buffer.byteLength
        ) {
          const imageData = buffer.slice(
            frameOffset,
            frameOffset + imageDataSize
          );
          const blob = new Blob([imageData], { type: mimeType });
          const albumArt = URL.createObjectURL(blob);

          console.log(
            `🖼️ [DEBUG] Extracted album art: ${mimeType}, ${imageDataSize} bytes, URL: ${albumArt}`
          );
          return { success: true, albumArt };
        }
      }

      // Move to next frame
      const frameSize =
        majorVersion === 4
          ? ((view.getUint8(offset + 4) & 0x7f) << 21) |
            ((view.getUint8(offset + 5) & 0x7f) << 14) |
            ((view.getUint8(offset + 6) & 0x7f) << 7) |
            (view.getUint8(offset + 7) & 0x7f)
          : (view.getUint8(offset + 4) << 24) |
            (view.getUint8(offset + 5) << 16) |
            (view.getUint8(offset + 6) << 8) |
            view.getUint8(offset + 7);

      offset += 10 + frameSize;
    }

    return { success: false, error: "No album art found in ID3 tags" };
  } catch (error) {
    console.error("❌ Error extracting album art:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Process uploaded image file for playlist cover
export async function processPlaylistCover(
  file: File
): Promise<ImageProcessingResult> {
  try {
    if (!file.type.startsWith("image/")) {
      return { success: false, error: "File is not an image" };
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return { success: false, error: "Image file too large (max 10MB)" };
    }

    // Store original image data as ArrayBuffer
    const imageData = await file.arrayBuffer();

    // Create image element to get dimensions and create thumbnail
    const img = new Image();
    const tempUrl = URL.createObjectURL(file);

    return new Promise((resolve) => {
      img.onload = async () => {
        try {
          const metadata = {
            width: img.width,
            height: img.height,
            format: file.type,
            size: file.size,
          };

          // Create thumbnail data (300x300 max)
          const thumbnailData = await createThumbnailData(
            img,
            300,
            300,
            file.type
          );

          console.log(
            `🖼️ [DEBUG] Processed playlist cover: ${img.width}x${img.height}, ${file.size} bytes, imageData size: ${imageData.byteLength}, thumbnailData size: ${thumbnailData.byteLength}`
          );

          // Clean up temporary URL
          URL.revokeObjectURL(tempUrl);

          resolve({
            success: true,
            imageData,
            thumbnailData,
            metadata,
          });
        } catch (error) {
          URL.revokeObjectURL(tempUrl);
          resolve({
            success: false,
            error: error instanceof Error ? error.message : "Processing failed",
          });
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(tempUrl);
        resolve({ success: false, error: "Invalid image file" });
      };

      img.src = tempUrl;
    });
  } catch (error) {
    console.error("❌ Error processing playlist cover:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// Create thumbnail data as ArrayBuffer from image element
async function createThumbnailData(
  img: HTMLImageElement,
  maxWidth: number,
  maxHeight: number,
  mimeType: string = "image/jpeg"
): Promise<ArrayBuffer> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Cannot create canvas context");
  }

  // Calculate thumbnail dimensions (maintain aspect ratio)
  let { width, height } = img;

  if (width > maxWidth || height > maxHeight) {
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    width *= ratio;
    height *= ratio;
  }

  canvas.width = width;
  canvas.height = height;

  // Draw image to canvas
  ctx.drawImage(img, 0, 0, width, height);

  // Convert to ArrayBuffer
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (blob) {
          const arrayBuffer = await blob.arrayBuffer();
          resolve(arrayBuffer);
        } else {
          reject(new Error("Failed to create thumbnail data"));
        }
      },
      mimeType,
      0.8
    );
  });
}

// Generate playlist thumbnail from song album art
export function generatePlaylistThumbnail(
  songImages: (string | undefined)[]
): string | null {
  const validImages = songImages.filter((img): img is string => !!img);

  if (validImages.length === 0) {
    return null;
  }

  if (validImages.length === 1) {
    return validImages[0] || null;
  }

  // For multiple images, return the first one for now
  // TODO: Could create a collage of multiple album arts
  return validImages[0] || null;
}

// Create collage from multiple album arts (future enhancement)
export async function createAlbumArtCollage(
  imageUrls: string[],
  size: number = 300
): Promise<string> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Cannot create canvas context");
  }

  canvas.width = size;
  canvas.height = size;

  // Fill with dark background
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, size, size);

  if (imageUrls.length === 0) {
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob(resolve as BlobCallback, "image/jpeg", 0.8);
    });
    return URL.createObjectURL(blob);
  }

  const gridSize = Math.ceil(Math.sqrt(Math.min(imageUrls.length, 4)));
  const cellSize = size / gridSize;

  try {
    const loadImage = (src: string): Promise<HTMLImageElement> => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    };

    const images = await Promise.all(
      imageUrls.slice(0, 4).map((url) => loadImage(url).catch(() => null))
    );

    images.forEach((img, index) => {
      if (!img) return;

      const row = Math.floor(index / gridSize);
      const col = index % gridSize;
      const x = col * cellSize;
      const y = row * cellSize;

      ctx.drawImage(img, x, y, cellSize, cellSize);
    });

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob(resolve as BlobCallback, "image/jpeg", 0.8);
    });
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error("❌ Error creating collage:", error);

    // Return single color as fallback
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, "#4a90e2");
    gradient.addColorStop(1, "#7b68ee");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob(resolve as BlobCallback, "image/jpeg", 0.8);
    });
    return URL.createObjectURL(blob);
  }
}

// Validate image file type and size
export function validateImageFile(file: File): {
  valid: boolean;
  error?: string;
} {
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: "Unsupported image format. Use JPEG, PNG, GIF, or WebP.",
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: "Image file too large. Maximum size is 10MB.",
    };
  }

  return { valid: true };
}

// Clean up object URLs to prevent memory leaks
export function cleanupImageUrl(url: string): void {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

// Batch cleanup for multiple URLs
export function cleanupImageUrls(urls: (string | undefined)[]): void {
  urls.forEach((url) => {
    if (url) {
      cleanupImageUrl(url);
    }
  });
}

// Convert stored image data to blob URL for display
export function createImageUrlFromData(
  imageData: ArrayBuffer,
  mimeType: string = "image/jpeg"
): string {
  console.log(
    `🖼️ [DEBUG] Creating URL from ArrayBuffer: ${imageData.byteLength} bytes, type: ${mimeType}`
  );
  const blob = new Blob([imageData], { type: mimeType });
  const url = URL.createObjectURL(blob);
  console.log(`🖼️ [DEBUG] Created blob URL: ${url}`);
  return url;
}

// Generate placeholder image for songs without album art
export function generatePlaceholderImage(
  text: string,
  size: number = 300,
  backgroundColor: string = "#4a5568",
  textColor: string = "#ffffff"
): string {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    // Return a data URL for a simple colored square
    return `data:image/svg+xml;base64,${btoa(`
      <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${backgroundColor}"/>
        <text x="50%" y="50%" text-anchor="middle" dy="0.3em" fill="${textColor}" font-family="Arial, sans-serif" font-size="${size * 0.1}">${text}</text>
      </svg>
    `)}`;
  }

  canvas.width = size;
  canvas.height = size;

  // Background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, size, size);

  // Text
  ctx.fillStyle = textColor;
  ctx.font = `bold ${size * 0.1}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Get first letter or first two letters of text
  const displayText = text.slice(0, 2).toUpperCase();
  ctx.fillText(displayText, size / 2, size / 2);

  return canvas.toDataURL("image/png");
}

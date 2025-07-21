// File Processing Service for Audio Files
// Handles file validation, metadata extraction, and processing

import { extractAlbumArt } from "./imageService.js";
import type {
  AudioMetadata,
  FileUploadResult,
  Song,
} from "../types/playlist.js";

// Check if file is a supported audio format
export function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/");
}

// Get list of supported audio file extensions
export function getSupportedExtensions(): string[] {
  return [
    ".mp3",
    ".wav",
    ".ogg",
    ".aac",
    ".m4a",
    ".flac",
    ".aiff",
    ".aif",
    ".wma",
    ".opus",
  ];
}

// Validate file size (default 100MB limit)
export function validateFileSize(file: File, maxSizeMB = 100): boolean {
  const maxBytes = maxSizeMB * 1024 * 1024;
  return file.size <= maxBytes;
}

// Extract basic metadata from file name
function extractMetadataFromFilename(filename: string): Partial<AudioMetadata> {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");

  // Common patterns: "Artist - Title", "Artist - Album - Title", "Title"
  const dashSplit = nameWithoutExt.split(" - ");

  if (dashSplit.length === 2) {
    return {
      artist: dashSplit[0]?.trim(),
      title: dashSplit[1]?.trim(),
    };
  } else if (dashSplit.length === 3) {
    return {
      artist: dashSplit[0]?.trim(),
      album: dashSplit[1]?.trim(),
      title: dashSplit[2]?.trim(),
    };
  } else {
    return {
      title: nameWithoutExt.trim(),
    };
  }
}

// Extract audio duration using Web Audio API
async function extractDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);

    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration || 0);
    });

    audio.addEventListener("error", (e) => {
      URL.revokeObjectURL(url);
      console.warn("Could not extract duration from audio file:", e);
      resolve(0); // Don't reject, just return 0
    });

    audio.src = url;
  });
}

// Extract cover art from file using ID3 tags
async function extractCoverArt(
  file: File
): Promise<{ data: ArrayBuffer; type: string } | undefined> {
  try {
    const result = await extractAlbumArt(file);
    if (result.success && result.albumArt) {
      console.log(`🖼️ Extracted album art from ${file.name}`);
      // Convert blob URL to ArrayBuffer
      const response = await fetch(result.albumArt);
      const arrayBuffer = await response.arrayBuffer();
      // Clean up the blob URL
      URL.revokeObjectURL(result.albumArt);
      return {
        data: arrayBuffer,
        type: "image/jpeg", // Default type, could be improved to detect actual type
      };
    }
    return undefined;
  } catch (error) {
    console.warn(`⚠️ Could not extract album art from ${file.name}:`, error);
    return undefined;
  }
}

// Main metadata extraction function
export async function extractMetadata(file: File): Promise<AudioMetadata> {
  const filenameMetadata = extractMetadataFromFilename(file.name);

  try {
    const duration = await extractDuration(file);
    const coverArt = await extractCoverArt(file);

    return {
      title: filenameMetadata.title || "Unknown Title",
      artist: filenameMetadata.artist || "Unknown Artist",
      album: filenameMetadata.album || "Unknown Album",
      duration,
      coverArtData: coverArt?.data,
      coverArtType: coverArt?.type,
    };
  } catch (error) {
    console.error("Error extracting metadata:", error);
    return {
      title: filenameMetadata.title || "Unknown Title",
      artist: filenameMetadata.artist || "Unknown Artist",
      album: filenameMetadata.album || "Unknown Album",
      duration: 0,
    };
  }
}

// Process single file upload
export async function processAudioFile(file: File): Promise<FileUploadResult> {
  try {
    // Validate file type
    if (!isAudioFile(file)) {
      return {
        success: false,
        error: `Unsupported file type: ${file.type}. Please upload an audio file.`,
      };
    }

    // Validate file size
    if (!validateFileSize(file)) {
      return {
        success: false,
        error: `File too large: ${Math.round(file.size / 1024 / 1024)}MB. Maximum size is 100MB.`,
      };
    }

    // Extract metadata
    const metadata = await extractMetadata(file);

    // Create blob URL for audio playback
    const blobUrl = URL.createObjectURL(file);

    return {
      success: true,
      song: {
        id: "", // Will be set by the database service
        file,
        blobUrl,
        title: metadata.title || "Unknown Title",
        artist: metadata.artist || "Unknown Artist",
        album: metadata.album || "Unknown Album",
        duration: metadata.duration || 0,
        position: 0, // Will be set when adding to playlist
        imageData: metadata.coverArtData,
        imageType: metadata.coverArtType,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        playlistId: "", // Will be set when adding to playlist
      } as Song,
    };
  } catch (error) {
    console.error("Error processing audio file:", error);
    return {
      success: false,
      error: `Error processing file: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

// Process multiple files
export async function processAudioFiles(
  files: FileList | File[]
): Promise<FileUploadResult[]> {
  const fileArray = Array.from(files);
  const results: FileUploadResult[] = [];

  // Process files in parallel but limit concurrency to avoid overwhelming the browser
  const BATCH_SIZE = 3;

  for (let i = 0; i < fileArray.length; i += BATCH_SIZE) {
    const batch = fileArray.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map((file) => processAudioFile(file))
    );
    results.push(...batchResults);
  }

  return results;
}

// Filter files to only include audio files
export function filterAudioFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter(isAudioFile);
}

// Get file type description for UI
export function getFileTypeDescription(file: File): string {
  const type = file.type.toLowerCase();

  if (type.includes("mp3") || type.includes("mpeg")) return "MP3 Audio";
  if (type.includes("wav")) return "WAV Audio";
  if (type.includes("flac")) return "FLAC Audio";
  if (type.includes("aac")) return "AAC Audio";
  if (type.includes("ogg")) return "OGG Audio";
  if (type.includes("aiff")) return "AIFF Audio";
  if (type.includes("m4a")) return "M4A Audio";
  if (type.includes("wma")) return "WMA Audio";

  return "Audio File";
}

// Format file size for display
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Create a preview URL for an audio file
export function createPreviewURL(file: File): string {
  return URL.createObjectURL(file);
}

// Clean up preview URL
export function revokePreviewURL(url: string): void {
  URL.revokeObjectURL(url);
}

// Validate and sanitize filename for display
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, "") // Remove invalid characters
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .trim();
}

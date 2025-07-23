import JSZip from "jszip";
import type { Playlist, Song } from "../types/playlist.js";
import { getSongsWithAudioData } from "./indexedDBService.js";

export interface PlaylistDownloadOptions {
  includeMetadata?: boolean;
  includeImages?: boolean;
  generateM3U?: boolean;
}

/**
 * Downloads a playlist as a ZIP file containing all songs, metadata, and images
 */
export async function downloadPlaylistAsZip(
  playlist: Playlist,
  options: PlaylistDownloadOptions = {
    includeMetadata: true,
    includeImages: true,
    generateM3U: true,
  }
): Promise<void> {
  try {
    const zip = new JSZip();

    // Get all songs for this playlist with audio data
    const playlistSongs = await getSongsWithAudioData(playlist.songIds);

    // Create playlist metadata file
    if (options.includeMetadata) {
      const playlistInfo = {
        title: playlist.title,
        description: playlist.description || "",
        createdAt: new Date(playlist.createdAt).toISOString(),
        updatedAt: new Date(playlist.updatedAt).toISOString(),
        songCount: playlistSongs.length,
        totalDuration: playlistSongs.reduce(
          (total, song) => total + (song.duration || 0),
          0
        ),
      };

      zip.file("playlist-info.json", JSON.stringify(playlistInfo, null, 2));
    }

    // Add playlist cover image if it exists
    if (options.includeImages && playlist.imageData && playlist.imageType) {
      const extension = getFileExtensionFromMimeType(playlist.imageType);
      zip.file(`playlist-cover${extension}`, playlist.imageData);
    }

    // Add all audio files directly to root
    const songFileNames: string[] = [];

    for (const song of playlistSongs) {
      if (song.audioData && song.originalFilename) {
        // Use original filename
        const audioFileName = song.originalFilename;
        const baseName = audioFileName.replace(/\.[^.]+$/, "");

        zip.file(audioFileName, song.audioData);
        songFileNames.push(audioFileName);

        // Add song cover art if it exists
        if (options.includeImages && song.imageData && song.imageType) {
          const imageExtension = getFileExtensionFromMimeType(song.imageType);
          const imageFileName = `${baseName}-cover${imageExtension}`;
          zip.file(imageFileName, song.imageData);
        }

        // Add individual song metadata
        if (options.includeMetadata) {
          const songMetadata = {
            title: song.title,
            artist: song.artist,
            album: song.album,
            duration: song.duration,
            mimeType: song.mimeType,
            originalFilename: song.originalFilename,
            createdAt: new Date(song.createdAt).toISOString(),
            updatedAt: new Date(song.updatedAt).toISOString(),
          };

          zip.file(
            `${baseName}-metadata.json`,
            JSON.stringify(songMetadata, null, 2)
          );
        }
      }
    }

    // Generate M3U8 playlist file
    if (options.generateM3U) {
      const m3uContent = generateM3UContent(
        playlist,
        playlistSongs,
        songFileNames
      );
      zip.file(`${createSafeFileName("", playlist.title)}.m3u8`, m3uContent);
    }

    // Generate and download the ZIP file
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${createSafeFileName("", playlist.title)}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up the URL
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error downloading playlist:", error);
    throw new Error("Failed to download playlist");
  }
}

/**
 * Generates M3U8 playlist content
 */
function generateM3UContent(
  playlist: Playlist,
  songs: Song[],
  fileNames: string[]
): string {
  let m3uContent = "#EXTM3U\n";

  // Add playlist metadata
  m3uContent += `# Playlist: ${playlist.title}\n`;
  if (playlist.description) {
    m3uContent += `# Description: ${playlist.description}\n`;
  }
  if (playlist.imageData) {
    const extension = getFileExtensionFromMimeType(
      playlist.imageType || "image/jpeg"
    );
    m3uContent += `# PlaylistImage: playlist-cover${extension}\n`;
  }
  m3uContent += "\n";

  // Add songs
  songs.forEach((song, index) => {
    const duration = Math.round(song.duration || 0);
    const fileName = fileNames[index];

    if (fileName) {
      m3uContent += `#EXTINF:${duration}, ${song.artist} - ${song.title}\n`;
      m3uContent += `# Title: ${song.title}\n`;
      m3uContent += `# Artist: ${song.artist}\n`;
      m3uContent += `# Album: ${song.album}\n`;

      if (song.imageData && song.originalFilename) {
        const baseName = song.originalFilename.replace(/\.[^.]+$/, "");
        const imageExtension = getFileExtensionFromMimeType(song.imageType!);
        m3uContent += `# Image: ${baseName}-cover${imageExtension}\n`;
      }

      m3uContent += `${fileName}\n\n`;
    }
  });

  return m3uContent;
}

/**
 * Creates a safe filename from artist and title
 */
function createSafeFileName(artist: string, title: string): string {
  const combined =
    artist && title ? `${artist} - ${title}` : title || artist || "untitled";
  return combined
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .toLowerCase()
    .substring(0, 100); // Limit length
}

/**
 * Gets file extension from MIME type
 */
function getFileExtensionFromMimeType(mimeType: string): string {
  const extensions: { [key: string]: string } = {
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/wav": ".wav",
    "audio/flac": ".flac",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
  };

  return extensions[mimeType] || ".bin";
}

/**
 * Parses an uploaded ZIP file and extracts playlist data
 */
export async function parsePlaylistZip(file: File): Promise<{
  playlist: Omit<Playlist, "id" | "createdAt" | "updatedAt">;
  songs: Omit<Song, "id" | "createdAt" | "updatedAt" | "playlistId">[];
}> {
  try {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(file);

    let playlistInfo: any = null;
    let playlistImageData: ArrayBuffer | undefined;
    let playlistImageType: string | undefined;
    const songs: Omit<Song, "id" | "createdAt" | "updatedAt" | "playlistId">[] =
      [];

    // Parse playlist metadata
    const playlistInfoFile = zipContent.file("playlist-info.json");
    if (playlistInfoFile) {
      const infoContent = await playlistInfoFile.async("string");
      playlistInfo = JSON.parse(infoContent);
    }

    // Find playlist cover image
    const coverFiles = zipContent.file(
      /^playlist-cover\.(jpg|jpeg|png|gif|webp)$/i
    );
    if (coverFiles.length > 0) {
      playlistImageData = await coverFiles[0]!.async("arraybuffer");
      playlistImageType = getMimeTypeFromExtension(coverFiles[0]!.name);
    }

    // Parse M3U file if present to get song order and metadata
    const m3uFiles = zipContent.file(/\.m3u8?$/i);
    if (m3uFiles.length > 0) {
      await m3uFiles[0]!.async("string");
    }

    // Extract songs from the root directory
    const songFiles = zipContent.file(/^[^/]+\.(mp3|m4a|wav|flac|ogg|webm)$/i);

    for (const songFile of songFiles) {
      const audioData = await songFile.async("arraybuffer");
      const fileName = songFile.name.split("/").pop() || "";
      const baseName = fileName.replace(/\.[^.]+$/, "");

      // Try to find corresponding metadata file
      const metadataFile = zipContent.file(`${baseName}-metadata.json`);
      let songMetadata: any = {};
      if (metadataFile) {
        const metadataContent = await metadataFile.async("string");
        songMetadata = JSON.parse(metadataContent);
      }

      // Try to find corresponding cover image
      const imageFiles = zipContent.file(
        new RegExp(
          `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-cover\\.(jpg|jpeg|png|gif|webp)$`,
          "i"
        )
      );
      let imageData: ArrayBuffer | undefined;
      let imageType: string | undefined;
      if (imageFiles.length > 0) {
        imageData = await imageFiles[0]!.async("arraybuffer");
        imageType = getMimeTypeFromExtension(imageFiles[0]!.name);
      }

      // Extract basic info from filename if no metadata
      const [artist, title] = baseName.includes(" - ")
        ? baseName.split(" - ", 2)
        : ["Unknown Artist", baseName];

      const song: Omit<Song, "id" | "createdAt" | "updatedAt" | "playlistId"> =
        {
          audioData,
          mimeType: getMimeTypeFromExtension(fileName),
          originalFilename: songMetadata.originalFilename || fileName,
          title: songMetadata.title || title!.replace(/_/g, " "),
          artist: songMetadata.artist || artist!.replace(/_/g, " "),
          album: songMetadata.album || "Unknown Album",
          duration: songMetadata.duration || 0,
          position: songs.length,
          imageData,
          imageType,
        };

      songs.push(song);
    }

    // Create playlist object
    const playlist: Omit<Playlist, "id" | "createdAt" | "updatedAt"> = {
      title: playlistInfo?.title || file.name.replace(/\.zip$/i, ""),
      description: playlistInfo?.description || "",
      imageData: playlistImageData,
      imageType: playlistImageType,
      songIds: [], // Will be populated when songs are saved
    };

    return { playlist, songs };
  } catch (error) {
    console.error("Error parsing playlist ZIP:", error);
    throw new Error("Failed to parse playlist ZIP file");
  }
}

/**
 * Gets MIME type from file extension
 */
function getMimeTypeFromExtension(fileName: string): string {
  const extension = fileName.toLowerCase().split(".").pop();
  const mimeTypes: { [key: string]: string } = {
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    webm: "audio/webm",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };

  return mimeTypes[extension || ""] || "application/octet-stream";
}

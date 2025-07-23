import JSZip from "jszip";
import type { Playlist, Song } from "../types/playlist.js";
import { getSongsWithAudioData } from "./indexedDBService.js";

export interface PlaylistDownloadOptions {
  includeMetadata?: boolean;
  includeImages?: boolean;
  generateM3U?: boolean;
  includeHTML?: boolean;
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
    includeHTML: true,
  }
): Promise<void> {
  try {
    const zip = new JSZip();

    // Get all songs for this playlist with audio data
    const playlistSongs = await getSongsWithAudioData(playlist.songIds);

    // Create root folder with playlist name
    const rootFolderName = createSafeFileName("", playlist.title);
    const rootFolder = zip.folder(rootFolderName);

    // Create data folder inside root folder
    const dataFolder = rootFolder!.folder("data");

    // Create comprehensive playlist data file in data folder
    const playlistData = {
      playlist: {
        title: playlist.title,
        description: playlist.description || "",
        createdAt: new Date(playlist.createdAt).toISOString(),
        updatedAt: new Date(playlist.updatedAt).toISOString(),
        songCount: playlistSongs.length,
        totalDuration: playlistSongs.reduce(
          (total, song) => total + (song.duration || 0),
          0
        ),
        imageData: playlist.imageData
          ? getFileExtensionFromMimeType(playlist.imageType || "image/jpeg")
          : null,
      },
      songs: playlistSongs.map((song) => ({
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration || 0,
        originalFilename: song.originalFilename || "",
        imageData: song.imageData
          ? getFileExtensionFromMimeType(song.imageType || "image/jpeg")
          : null,
      })),
    };

    // Add playlist cover image to data folder if it exists
    if (options.includeImages && playlist.imageData && playlist.imageType) {
      const extension = getFileExtensionFromMimeType(playlist.imageType);
      dataFolder!.file(`playlist-cover${extension}`, playlist.imageData);
    }

    // Add all audio files to data folder
    const songFileNames: string[] = [];

    for (const song of playlistSongs) {
      if (song.audioData && song.originalFilename) {
        // Use original filename
        const audioFileName = song.originalFilename;
        const baseName = audioFileName.replace(/\.[^.]+$/, "");

        dataFolder!.file(audioFileName, song.audioData);
        songFileNames.push(audioFileName);

        // Add song cover art if it exists
        if (options.includeImages && song.imageData && song.imageType) {
          const imageExtension = getFileExtensionFromMimeType(song.imageType);
          const imageFileName = `${baseName}-cover${imageExtension}`;
          dataFolder!.file(imageFileName, song.imageData);
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

          dataFolder!.file(
            `${baseName}-metadata.json`,
            JSON.stringify(songMetadata, null, 2)
          );
        }
      }
    }

    // Add playlist data to data folder
    dataFolder!.file("playlist.json", JSON.stringify(playlistData, null, 2));

    // Generate M3U8 playlist file in data folder
    if (options.generateM3U) {
      const m3uContent = generateM3UContent(
        playlist,
        playlistSongs,
        songFileNames
      );
      dataFolder!.file(
        `${createSafeFileName("", playlist.title)}.m3u8`,
        m3uContent
      );
    }

    // Generate standalone HTML page in root folder
    if (options.includeHTML) {
      try {
        console.log("🔄 Starting HTML generation...");
        const htmlContent = await generateStandaloneHTML(playlistData);
        console.log("🔄 HTML content generated, length:", htmlContent.length);
        rootFolder!.file("playlistz.html", htmlContent);
        console.log("✅ Generated playlistz.html successfully");
      } catch (error) {
        console.error("❌ Error generating HTML:", error);
        console.error("❌ Error stack:", error.stack);
        // Continue without HTML file rather than failing
      }
    } else {
      console.log("⚠️ HTML generation disabled in options");
    }

    // Generate and download the ZIP file
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${rootFolderName}.zip`;
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
    m3uContent += `# PlaylistImage: data/playlist-cover${extension}\n`;
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
        m3uContent += `# Image: data/${baseName}-cover${imageExtension}\n`;
      }

      m3uContent += `data/${fileName}\n\n`;
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

/**
 * Generates a standalone HTML page with embedded playlist data
 */
async function generateStandaloneHTML(playlistData: any): Promise<string> {
  console.log("🔄 Fetching clean HTML source...");
  // Fetch the clean HTML source instead of serializing the mutated DOM
  const response = await fetch(window.location.href);
  const currentHTML = await response.text();
  console.log("🔄 Clean HTML length:", currentHTML.length);

  // Create the standalone initialization script with embedded data
  const standaloneScript = `
    <script>
      // Flag to indicate this is a standalone version
      window.STANDALONE_MODE = true;

      // Embedded playlist data
      window.EMBEDDED_PLAYLIST_DATA = ${JSON.stringify(playlistData, null, 2)};

      // Wait for the function to be available and then initialize
      async function waitForInitialization() {
        let attempts = 0;
        const maxAttempts = 50; // Wait up to 5 seconds

        while (attempts < maxAttempts) {
          if (window.initializeStandalonePlaylist) {
            try {
              console.log('🎵 Standalone mode: Loading embedded playlist data...');
              const playlistData = window.EMBEDDED_PLAYLIST_DATA;
              console.log('🎵 Playlist data loaded:', playlistData);

              window.initializeStandalonePlaylist(playlistData);
              return; // Success, exit
            } catch (error) {
              console.error('Failed to initialize playlist:', error);
              showError('Failed to initialize playlist: ' + error.message);
              return;
            }
          }

          // Wait 100ms before trying again
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }

        // Function never became available
        console.error('initializeStandalonePlaylist function not found after waiting');
        showError('Playlist initialization function not found. The app may not have loaded properly.');
      }

      // Start waiting after DOM is loaded
      window.addEventListener('DOMContentLoaded', waitForInitialization);

      // Show dismissable error message
      function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(220, 20, 60, 0.95); color: white; padding: 15px 25px; border-radius: 8px; z-index: 10000; text-align: center; max-width: 500px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);';
        errorDiv.innerHTML = '<div style="margin-bottom: 10px;">' + message + '</div><button onclick="this.parentElement.remove()" style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 5px 15px; border-radius: 4px; cursor: pointer;">Dismiss</button>';
        document.body.appendChild(errorDiv);
      }
    </script>
  `;

  // Insert the script before the closing </head> tag
  console.log("🔄 Inserting standalone script...");
  let modifiedHTML = currentHTML.replace(
    "</head>",
    `${standaloneScript}\n</head>`
  );

  console.log("🔄 Modified HTML length:", modifiedHTML.length);
  console.log("✅ HTML generation complete");
  return modifiedHTML;
}

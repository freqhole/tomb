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

    // Audio data is now always stored in IndexedDB during initialization

    // Create root folder with playlist name
    const rootFolderName = createSafeFileName("", playlist.title);
    const rootFolder = zip.folder(rootFolderName);

    // Create data folder inside root folder
    const dataFolder = rootFolder!.folder("data");

    // Create comprehensive playlist data file in data folder
    const playlistData = {
      playlist: {
        id: playlist.id,
        title: playlist.title,
        description: playlist.description || "",
        createdAt: new Date(playlist.createdAt).toISOString(),
        updatedAt: new Date(playlist.updatedAt).toISOString(),
        songCount: playlistSongs.length,
        totalDuration: playlistSongs.reduce(
          (total, song) => total + (song.duration || 0),
          0
        ),
        imageExtension: playlist.imageData
          ? getFileExtensionFromMimeType(playlist.imageType || "image/jpeg")
          : null,
        imageMimeType: playlist.imageType || null,
      },
      songs: playlistSongs.map((song) => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration || 0,
        originalFilename: song.originalFilename || "",
        safeFilename: song.originalFilename
          ? sanitizeFilename(song.originalFilename)
          : "",
        fileSize: song.fileSize || song.audioData?.byteLength,
        mimeType: song.mimeType || "audio/mpeg",
        imageExtension: song.imageData
          ? getFileExtensionFromMimeType(song.imageType || "image/jpeg")
          : null,
        imageMimeType: song.imageType || null,
      })),
    };

    // Add single playlist JSON file to data folder
    dataFolder!.file("playlist.json", JSON.stringify(playlistData, null, 2));

    // Add playlist cover image to data folder if it exists
    if (options.includeImages && playlist.imageData && playlist.imageType) {
      const extension = getFileExtensionFromMimeType(playlist.imageType);
      dataFolder!.file(`playlist-cover${extension}`, playlist.imageData);
    }

    // Add all audio files to data folder
    const songFileNames: string[] = [];

    for (const song of playlistSongs) {
      if (song.audioData && song.originalFilename) {
        // Create safe filename for ZIP while keeping original in metadata
        const safeFileName = sanitizeFilename(song.originalFilename);
        const baseName = safeFileName.replace(/\.[^.]+$/, "");

        dataFolder!.file(safeFileName, song.audioData);
        songFileNames.push(safeFileName);

        // Add song cover art if it exists
        if (options.includeImages && song.imageData && song.imageType) {
          const imageExtension = getFileExtensionFromMimeType(song.imageType);
          const imageFileName = `${baseName}-cover${imageExtension}`;
          dataFolder!.file(imageFileName, song.imageData);
        }

        // Add individual song metadata
        // Metadata is now included in the main playlist.json file
      }
    }

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
        const htmlContent = await generateStandaloneHTML(playlistData);
        rootFolder!.file("playlistz.html", htmlContent);

        // Add service worker file for offline functionality in root directory
        // (SW must be at same level or higher than HTML to control it)
        try {
          const swResponse = await fetch("./sw.js");
          if (swResponse.ok) {
            const swContent = await swResponse.text();
            rootFolder!.file("sw.js", swContent);
          }
        } catch (swError) {
          console.warn(
            "⚠️ Could not include service worker in bundle:",
            swError
          );
          // Continue without service worker - not critical
        }
      } catch (error) {
        console.error("❌ Error generating HTML:", error);
        console.error(
          "❌ Error stack:",
          error instanceof Error ? error.stack : "Unknown error"
        );
        // Continue without HTML file rather than failing
      }
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

    // Parse playlist metadata - try new format first, then fall back to old format
    let playlistData: any = null;
    // Try with root folder first
    let playlistJsonFiles = zipContent.file(/^[^/]+\/data\/playlist\.json$/i);
    if (playlistJsonFiles.length === 0) {
      // Fall back to direct data folder
      const playlistJsonFile = zipContent.file("data/playlist.json");
      if (playlistJsonFile) {
        playlistJsonFiles = [playlistJsonFile];
      }
    }

    if (playlistJsonFiles.length > 0) {
      const playlistContent = await playlistJsonFiles[0]!.async("string");
      playlistData = JSON.parse(playlistContent);
      playlistInfo = playlistData.playlist;
    } else {
      // Fall back to old format
      const playlistInfoFile = zipContent.file("playlist-info.json");
      if (playlistInfoFile) {
        const infoContent = await playlistInfoFile.async("string");
        playlistInfo = JSON.parse(infoContent);
      }
    }

    // Find playlist cover image - try data folder first, then root
    let coverFiles = zipContent.file(
      /^[^/]+\/data\/playlist-cover\.(jpg|jpeg|png|gif|webp)$/i
    );
    if (coverFiles.length === 0) {
      coverFiles = zipContent.file(
        /^data\/playlist-cover\.(jpg|jpeg|png|gif|webp)$/i
      );
    }
    if (coverFiles.length === 0) {
      coverFiles = zipContent.file(
        /^playlist-cover\.(jpg|jpeg|png|gif|webp)$/i
      );
    }
    if (coverFiles.length > 0) {
      playlistImageData = await coverFiles[0]!.async("arraybuffer");
      playlistImageType = getMimeTypeFromExtension(coverFiles[0]!.name);
    } else if (playlistData && playlistData.playlist.imageBase64) {
      // Use embedded base64 image from playlist.json
      playlistImageData = base64ToArrayBuffer(
        playlistData.playlist.imageBase64
      );
      playlistImageType = playlistData.playlist.imageMimeType;
    }

    // Parse M3U file if present to get song order and metadata
    const m3uFiles = zipContent.file(/\.m3u8?$/i);
    if (m3uFiles.length > 0) {
      await m3uFiles[0]!.async("string");
    }

    // Extract songs from data folder first, then fall back to root directory
    // Account for root playlist folder in ZIP structure
    let songFiles = zipContent.file(
      /^[^/]+\/data\/[^/]+\.(mp3|m4a|wav|flac|ogg|webm)$/i
    );
    if (songFiles.length === 0) {
      songFiles = zipContent.file(
        /^data\/[^/]+\.(mp3|m4a|wav|flac|ogg|webm)$/i
      );
    }
    if (songFiles.length === 0) {
      songFiles = zipContent.file(/^[^/]+\.(mp3|m4a|wav|flac|ogg|webm)$/i);
    }

    for (const songFile of songFiles) {
      const audioData = await songFile.async("arraybuffer");
      const fileName = songFile.name.split("/").pop() || "";
      const baseName = fileName.replace(/\.[^.]+$/, "");

      // Get metadata from playlist.json if available, otherwise try individual metadata file
      let songMetadata: any = {};
      if (playlistData && playlistData.songs) {
        const songData = playlistData.songs.find(
          (s: any) =>
            s.safeFilename === fileName || s.originalFilename === fileName
        );
        if (songData) {
          songMetadata = {
            id: songData.id,
            title: songData.title,
            artist: songData.artist,
            album: songData.album,
            duration: songData.duration,
            originalFilename: songData.originalFilename,
            imageBase64: songData.imageBase64,
            imageMimeType: songData.imageMimeType,
          };
        }
      } else {
        // Fall back to old individual metadata files
        const metadataFile = zipContent.file(`${baseName}-metadata.json`);
        if (metadataFile) {
          const metadataContent = await metadataFile.async("string");
          songMetadata = JSON.parse(metadataContent);
        }
      }

      // Try to find corresponding cover image - first check for embedded base64, then files
      let imageData: ArrayBuffer | undefined;
      let imageType: string | undefined;

      if (songMetadata.imageBase64) {
        imageData = base64ToArrayBuffer(songMetadata.imageBase64);
        imageType = songMetadata.imageMimeType;
      } else {
        // Check for image files in data folder first, then root
        let imageFiles = zipContent.file(
          new RegExp(
            `^[^/]+/data/${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-cover\\.(jpg|jpeg|png|gif|webp)$`,
            "i"
          )
        );
        if (imageFiles.length === 0) {
          imageFiles = zipContent.file(
            new RegExp(
              `^data/${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-cover\\.(jpg|jpeg|png|gif|webp)$`,
              "i"
            )
          );
        }
        if (imageFiles.length === 0) {
          imageFiles = zipContent.file(
            new RegExp(
              `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-cover\\.(jpg|jpeg|png|gif|webp)$`,
              "i"
            )
          );
        }
        if (imageFiles.length > 0) {
          imageData = await imageFiles[0]!.async("arraybuffer");
          imageType = getMimeTypeFromExtension(imageFiles[0]!.name);
        }
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
 * Helper function to convert base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generates a standalone HTML file with embedded playlist data
 */
async function generateStandaloneHTML(playlistData: any): Promise<string> {
  // Fetch the clean HTML source instead of serializing the mutated DOM
  const response = await fetch(window.location.href);
  const currentHTML = await response.text();

  // Generate Open Graph meta tags for rich link previews
  const playlist = playlistData.playlist;
  const songCount = playlistData.songs.length;
  const description =
    playlist.description ||
    `a playlist with ${songCount} song${songCount === 1 ? "" : "z"}`;

  // Get relative path to playlist cover image if available
  let imageUrl = "";
  if (playlist.imageMimeType) {
    const extension = getFileExtensionFromMimeType(playlist.imageMimeType);
    imageUrl = `/data/playlist-cover${extension}`;
  }

  const ogMetaTags = `
    <!-- Open Graph meta tags for rich link previews -->
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${playlist.title.replace(/"/g, "&quot;")}" />
    <meta property="og:description" content="${description.replace(/"/g, "&quot;")}" />
    <meta property="og:site_name" content="playlistz" />
    ${imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : ""}
    ${imageUrl ? `<meta property="og:image:width" content="512" />` : ""}
    ${imageUrl ? `<meta property="og:image:height" content="512" />` : ""}

    <!-- standard meta tags -->
    <meta name="description" content="${description.replace(/"/g, "&quot;")}" />`;

  // create the standalone initialization script with embedded data
  const standaloneScript = `
    <script>
      // Flag to indicate this is a standalone version
      window.STANDALONE_MODE = true;

      // Show early loading indicator
      function showLoadingIndicator() {
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'early-loading';
        loadingDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0, 0, 0, 0.9); color: white; padding: 30px; border-radius: 12px; z-index: 10000; text-align: center; font-family: monospace;';
        loadingDiv.innerHTML = '<div style="margin-bottom: 15px; font-size: 18px;">loading playlist...</div><div style="width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.3); border-top: 3px solid #ff00ff; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto;"></div><style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>';
        document.body.appendChild(loadingDiv);
        return loadingDiv;
      }

      // Remove early loading indicator
      function hideLoadingIndicator(indicator) {
        if (indicator && indicator.parentNode) {
          indicator.parentNode.removeChild(indicator);
        }
      }

      // Load playlist data from data/ directory asynchronously
      async function loadPlaylistData() {
        try {
          const response = await fetch('data/playlist.json');
          if (!response.ok) {
            throw new Error('Failed to load playlist data: ' + response.status);
          }
          return await response.json();
        } catch (error) {
          console.error('Error loading playlist data:', error);
          throw error;
        }
      }

      // Wait for the function to be available and then initialize
      async function waitForInitialization() {
        let loadingIndicator = null;
        let attempts = 0;
        const maxAttempts = 50; // Wait up to 5 seconds

        while (attempts < maxAttempts) {
          if (window.initializeStandalonePlaylist) {
            try {
              // Show loading indicator during data fetch
              loadingIndicator = showLoadingIndicator();

              // Load playlist data asynchronously
              const playlistData = await loadPlaylistData();

              // Hide early loading indicator before initializing
              hideLoadingIndicator(loadingIndicator);

              // Initialize playlist (this will show its own loading progress)
              window.initializeStandalonePlaylist(playlistData);
              return; // Success, exit
            } catch (error) {
              hideLoadingIndicator(loadingIndicator);
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
        hideLoadingIndicator(loadingIndicator);
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

  // Insert the meta tags and script before the closing </head> tag
  // Also update the title
  let modifiedHTML = currentHTML.replace(
    /<title>.*?<\/title>/i,
    `<title>${playlist.title.replace(/"/g, "&quot;")} - playlistz</title>`
  );

  modifiedHTML = modifiedHTML.replace(
    "</head>",
    `${ogMetaTags}\n${standaloneScript}\n</head>`
  );

  return modifiedHTML;
}

/**
 * Sanitizes filenames for better cross-platform compatibility
 */
function sanitizeFilename(filename: string): string {
  return (
    filename
      // Replace problematic characters with safe alternatives
      .replace(/\$/g, "_DOLLAR_")
      .replace(/\[/g, "_LBRACKET_")
      .replace(/\]/g, "_RBRACKET_")
      .replace(/\(/g, "_LPAREN_")
      .replace(/\)/g, "_RPAREN_")
      .replace(/[<>:"/\\|?*]/g, "_")
      // Keep other characters as they are for readability
      .replace(/\s+/g, " ")
      .trim()
  );
}

/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import type { Playlist } from "../types/playlist.js";
import { filterAudioFiles } from "../services/fileProcessingService.js";
import { parsePlaylistZip } from "../services/playlistDownloadService.js";
import {
  createPlaylist,
  addSongToPlaylist,
} from "../services/indexedDBService.js";

export interface DragInfo {
  type: "audio-files" | "non-audio-files" | "song-reorder" | "unknown";
  itemCount: number;
}

export function useDragAndDrop() {
  // Drag state
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [dragInfo, setDragInfo] = createSignal<DragInfo>({
    type: "unknown",
    itemCount: 0,
  });
  const [error, setError] = createSignal<string | null>(null);

  // Analyze drag data to determine what's being dragged
  const analyzeDragData = (e: DragEvent): DragInfo => {
    const files = e.dataTransfer?.files;

    // Check if it's a song reorder operation
    const dragData = e.dataTransfer?.getData("application/json");
    if (dragData) {
      try {
        const data = JSON.parse(dragData);
        if (data.type === "song-reorder") {
          return { type: "song-reorder", itemCount: 1 };
        }
      } catch (err) {
        // Not JSON, continue with file analysis
      }
    }

    if (!files || files.length === 0) {
      return { type: "unknown", itemCount: 0 };
    }

    // Check for ZIP files
    const zipFiles = Array.from(files).filter(
      (file) =>
        file.type === "application/zip" ||
        file.name.toLowerCase().endsWith(".zip")
    );

    if (zipFiles.length > 0) {
      return { type: "audio-files", itemCount: zipFiles.length };
    }

    // Check for audio files
    const audioFiles = filterAudioFiles(files);
    if (audioFiles.length > 0) {
      return { type: "audio-files", itemCount: audioFiles.length };
    }

    return { type: "non-audio-files", itemCount: files.length };
  };

  // Handle drag enter
  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const info = analyzeDragData(e);
    setDragInfo(info);
    setIsDragOver(true);
  };

  // Handle drag over
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Update drag effect based on content
    const info = dragInfo();
    if (info.type === "audio-files" || info.type === "song-reorder") {
      e.dataTransfer!.dropEffect = "copy";
    } else {
      e.dataTransfer!.dropEffect = "none";
    }
  };

  // Handle drag leave
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only set drag over to false if we're leaving the main container
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false);
      setDragInfo({ type: "unknown", itemCount: 0 });
    }
  };

  // Handle file drop with ZIP and audio file support
  const handleDrop = async (
    e: DragEvent,
    options: {
      selectedPlaylist?: Playlist | null;
      playlists: Playlist[];
      onPlaylistCreated?: (playlist: Playlist) => void;
      onPlaylistSelected?: (playlist: Playlist) => void;
    }
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const info = dragInfo();
    setDragInfo({ type: "unknown", itemCount: 0 });

    // Only handle file drops, ignore song reordering
    if (info.type === "song-reorder") {
      return;
    }

    const files = e.dataTransfer?.files;
    if (!files) return;

    try {
      setError(null);

      // Check for ZIP files first
      const zipFiles = Array.from(files).filter(
        (file) =>
          file.type === "application/zip" ||
          file.name.toLowerCase().endsWith(".zip")
      );

      if (zipFiles.length > 0) {
        await handleZipFiles(zipFiles, options);
        return;
      }

      // Handle regular audio files
      const audioFiles = filterAudioFiles(files);
      if (audioFiles.length === 0) {
        handleNonAudioFiles(info);
        return;
      }

      await handleAudioFiles(audioFiles, options);
    } catch (err) {
      console.error("Error handling file drop:", err);
      setError("Failed to process dropped files");
      setTimeout(() => setError(null), 5000);
    }
  };

  // Handle ZIP file processing
  const handleZipFiles = async (
    zipFiles: File[],
    options: {
      playlists: Playlist[];
      onPlaylistCreated?: (playlist: Playlist) => void;
      onPlaylistSelected?: (playlist: Playlist) => void;
    }
  ) => {
    for (const zipFile of zipFiles) {
      const { playlist: playlistData, songs: songsData } =
        await parsePlaylistZip(zipFile);

      // Check if a playlist with the same name and songs already exists
      const existingPlaylist = options.playlists.find(
        (p) =>
          p.title === playlistData.title &&
          p.songIds.length === songsData.length
      );

      if (existingPlaylist) {
        setError(`Playlist "${playlistData.title}" already exists`);
        setTimeout(() => setError(null), 3000);
        continue;
      }

      // Create new playlist
      const newPlaylist = await createPlaylist(playlistData);

      // Add songs to the playlist
      for (const songData of songsData) {
        // Create a File object from the audio data for compatibility
        const audioBlob = new Blob([songData.audioData!], {
          type: songData.mimeType,
        });
        const audioFile = new File(
          [audioBlob],
          songData.originalFilename || `${songData.artist} - ${songData.title}`,
          { type: songData.mimeType }
        );

        await addSongToPlaylist(newPlaylist.id, audioFile, {
          title: songData.title,
          artist: songData.artist,
          album: songData.album,
          duration: songData.duration,
          imageData: songData.imageData,
          imageType: songData.imageType,
        });
      }

      // Notify about playlist creation and selection
      options.onPlaylistCreated?.(newPlaylist);
      options.onPlaylistSelected?.(newPlaylist);
    }
  };

  // Handle regular audio files
  const handleAudioFiles = async (
    audioFiles: File[],
    options: {
      selectedPlaylist?: Playlist | null;
      onPlaylistCreated?: (playlist: Playlist) => void;
      onPlaylistSelected?: (playlist: Playlist) => void;
    }
  ) => {
    let targetPlaylist = options.selectedPlaylist;

    // If no playlist is selected, create a new one
    if (!targetPlaylist) {
      targetPlaylist = await createPlaylist({
        title: "New Playlist",
        description: `Created from ${audioFiles.length} dropped file${
          audioFiles.length > 1 ? "s" : ""
        }`,
        songIds: [],
      });
      options.onPlaylistCreated?.(targetPlaylist);
      options.onPlaylistSelected?.(targetPlaylist);
    }

    // Add audio files to playlist
    for (const songFile of audioFiles) {
      await addSongToPlaylist(targetPlaylist.id, songFile);
    }
  };

  // Handle non-audio files with contextual error messages
  const handleNonAudioFiles = (info: DragInfo) => {
    if (info.type === "non-audio-files") {
      setError(
        "Only audio files and ZIP playlist files can be added. Supported formats: MP3, WAV, M4A, FLAC, OGG, ZIP"
      );
    } else {
      setError(
        "No audio files or ZIP playlist files found in the dropped item(s)"
      );
    }
    setTimeout(() => setError(null), 3000);
  };

  // Set up global drag and drop event listeners
  onMount(() => {
    const preventDefaults = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Prevent default drag behaviors on document
    document.addEventListener("dragenter", preventDefaults);
    document.addEventListener("dragover", preventDefaults);
    document.addEventListener("dragleave", preventDefaults);
    document.addEventListener("drop", preventDefaults);

    onCleanup(() => {
      document.removeEventListener("dragenter", preventDefaults);
      document.removeEventListener("dragover", preventDefaults);
      document.removeEventListener("dragleave", preventDefaults);
      document.removeEventListener("drop", preventDefaults);
    });
  });

  // Clear error after some time
  createEffect(() => {
    const errorMsg = error();
    if (errorMsg) {
      const timeoutId = setTimeout(() => {
        setError(null);
      }, 5000);

      onCleanup(() => clearTimeout(timeoutId));
    }
  });

  return {
    // State
    isDragOver,
    dragInfo,
    error,

    // Setters
    setIsDragOver,

    // Event handlers
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,

    // Utilities
    analyzeDragData,
  };
}

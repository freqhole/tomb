/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import type { Playlist } from "../types/playlist.js";
import {
  filterAudioFiles,
  extractMetadata,
} from "../services/fileProcessingService.js";
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
  // drag state
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [dragInfo, setDragInfo] = createSignal<DragInfo>({
    type: "unknown",
    itemCount: 0,
  });
  const [error, setError] = createSignal<string | null>(null);

  // what's being dragged?
  const analyzeDragData = (e: DragEvent): DragInfo => {
    // check types array first since getData() is restricted during dragenter
    const types = e.dataTransfer?.types;

    // song reorder: SongRow sets text/plain data, so types will include "text/plain" but not "Files"
    if (types && types.includes("text/plain") && !types.includes("Files")) {
      return { type: "song-reorder", itemCount: 1 };
    }

    // file drops: will have "Files" in types array
    if (types && types.includes("Files")) {
      return { type: "audio-files", itemCount: 1 };
    }

    // fallback: try to read data directly (works during drop events)
    const textData = e.dataTransfer?.getData("text/plain");
    if (textData && !isNaN(parseInt(textData, 10))) {
      return { type: "song-reorder", itemCount: 1 };
    }

    // legacy support for json data
    const dragData = e.dataTransfer?.getData("application/json");
    if (dragData) {
      try {
        const data = JSON.parse(dragData);
        if (data.type === "song-reorder") {
          return { type: "song-reorder", itemCount: 1 };
        }
      } catch (err) {
        // not json, continue with file analysis...
      }
    }

    // check items array as additional fallback
    const items = e.dataTransfer?.items;

    if (items && items.length > 0) {
      const hasFiles = Array.from(items).some((item) => item.kind === "file");
      if (hasFiles) {
        return { type: "audio-files", itemCount: items.length };
      }
    }

    // fallback to checking files (available during drop event)
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const zipFiles = Array.from(files).filter(
        (file) =>
          file.type === "application/zip" ||
          file.name.toLowerCase().endsWith(".zip")
      );

      if (zipFiles.length > 0) {
        return { type: "audio-files", itemCount: zipFiles.length };
      }

      const audioFiles = filterAudioFiles(files);
      if (audioFiles.length > 0) {
        return { type: "audio-files", itemCount: audioFiles.length };
      }

      return { type: "non-audio-files", itemCount: files.length };
    }

    return { type: "unknown", itemCount: 0 };
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const info = analyzeDragData(e);
    setDragInfo(info);

    // only show drag overlay for file drops, not song reordering
    if (info.type !== "song-reorder") {
      setIsDragOver(true);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // update drag effect based on content
    const info = dragInfo();
    if (info.type === "audio-files" || info.type === "song-reorder") {
      e.dataTransfer!.dropEffect = "copy";
    } else {
      e.dataTransfer!.dropEffect = "none";
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // only handle drag leave for file drops, not song reordering
    const info = dragInfo();
    if (info.type === "song-reorder") {
      return;
    }

    // only set drag over to false if leaving the main container
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false);
      setDragInfo({ type: "unknown", itemCount: 0 });
    }
  };

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

    // only handle file drops here; ignore song reordering
    if (info.type === "song-reorder") {
      return;
    }

    const files = e.dataTransfer?.files;
    if (!files) return;

    try {
      setError(null);

      // check ZIP first
      const zipFiles = Array.from(files).filter(
        (file) =>
          file.type === "application/zip" ||
          file.name.toLowerCase().endsWith(".zip")
      );

      if (zipFiles.length > 0) {
        await handleZipFiles(zipFiles, options);
        return;
      }

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
      throw err;
    }
  };

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

      // check if a playlist with the same name and songs already exists
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

      const newPlaylist = await createPlaylist(playlistData);

      // and add the songz
      for (const songData of songsData) {
        // create a File object from the audio data for compatibility
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

      // callback about playlist creation and selection
      options.onPlaylistCreated?.(newPlaylist);
      options.onPlaylistSelected?.(newPlaylist);
    }
  };

  const handleAudioFiles = async (
    audioFiles: File[],
    options: {
      selectedPlaylist?: Playlist | null;
      onPlaylistCreated?: (playlist: Playlist) => void;
      onPlaylistSelected?: (playlist: Playlist) => void;
    }
  ) => {
    let targetPlaylist = options.selectedPlaylist;

    // if no playlist is selected, create a new one
    if (!targetPlaylist) {
      targetPlaylist = await createPlaylist({
        title: "new playlist",
        description: `created from ${audioFiles.length} dropped file${
          audioFiles.length > 1 ? "z" : ""
        }`,
        songIds: [],
      });
      options.onPlaylistCreated?.(targetPlaylist);
      options.onPlaylistSelected?.(targetPlaylist);
    }

    // and add the songz to the playlist
    for (const songFile of audioFiles) {
      const metadata = await extractMetadata(songFile);
      await addSongToPlaylist(targetPlaylist.id, songFile, metadata);
    }
  };

  // contextual error messagez
  const handleNonAudioFiles = (info: DragInfo) => {
    if (info.type === "non-audio-files") {
      setError(
        "only audio filez and ZIP playlist filez can be added. supported formatz: MP3, WAV, M4A, FLAC, OGG, ZIP"
      );
    } else {
      setError(
        "no audio filez or ZIP playlist filez found in the dropped itemz!"
      );
    }
    setTimeout(() => setError(null), 3000);
  };

  // set 'em up the global drag and drop event listenerz
  onMount(() => {
    const preventDefaults = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // prevent default drag behaviors on document
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

  // clear error after some time
  createEffect(() => {
    const errorMsg = error();
    if (errorMsg) {
      const timeoutId = setTimeout(() => {
        setError(null);
      }, 10_000);

      onCleanup(() => clearTimeout(timeoutId));
    }
  });

  // handle file drop wrapper (moved from components/index.tsx)
  const handleFileDrop = async (
    e: DragEvent,
    options: {
      selectedPlaylist?: Playlist | null;
      playlists: Playlist[];
      onPlaylistCreated?: (playlist: Playlist) => void;
      onPlaylistSelected?: (playlist: Playlist) => void;
    }
  ) => {
    try {
      await handleDrop(e, options);
    } catch (error) {
      console.error("onoz! error in handleFileDrop:", error);
      // ensure drag overlay is cleared, even on error
      setIsDragOver(false);
    }
  };

  return {
    isDragOver,
    dragInfo,
    error,

    // setterz
    setIsDragOver,

    // actionz
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileDrop,

    // utilz
    analyzeDragData,
  };
}

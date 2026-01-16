import { useGlobalEvents } from "../hooks/useGlobalEvents";
import { storeActions, useStore } from "../store";
import { apiClient } from "../../../lib/api-client";
import { trackCollectionPlay } from "../../../lib/analytics/collection-events";
import type { Song } from "../../../lib/music/schemas/song";
import type { Album } from "../../../lib/music/schemas/album";
import type { ArtistSummary } from "../../../lib/music/schemas/artist";
import type { GenreStat } from "../../../lib/music/schemas/genre";

// Context menu action interfaces
export interface CollectionAction {
  label: string;
  icon: string;
  action: () => void;
  disabled?: boolean;
}

export interface SeparatorAction {
  type: "separator";
}

export type CollectionMenuAction = CollectionAction | SeparatorAction;

/**
 * Centralized service for collection-level interactions
 * (albums, playlists, artists, genres) with analytics tracking
 */
export function useCollectionInteractions() {
  const [store] = useStore();
  const events = useGlobalEvents();

  // Generate session id for analytics tracking (must be UUID for server)
  const getSessionId = () => {
    return store.player.currentSong?.id || crypto.randomUUID();
  };

  // Shuffle array utility
  const shuffleArray = <T>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = temp;
    }
    return shuffled;
  };

  // Core collection play logic
  const playCollection = (
    songs: Song[],
    options: {
      domainType: "album" | "playlist" | "artist" | "genre";
      songIds: string[];
      collectionName: string;
      shuffle?: boolean;
      replaceQueue?: boolean;
    }
  ) => {
    if (songs.length === 0) {
      console.warn("no songs to play in collection");
      return;
    }

    const {
      domainType,
      songIds,
      collectionName,
      shuffle = false,
      replaceQueue = true,
    } = options;
    const sessionId = getSessionId();

    // Track collection play analytics
    trackCollectionPlay(
      domainType,
      songIds,
      collectionName,
      songs.length,
      shuffle,
      sessionId,
      songs[0]?.media_blob_id
    );

    // Prepare songs (shuffle if requested)
    const songsToPlay = shuffle ? shuffleArray(songs) : songs;
    const firstSong = songsToPlay[0];

    if (replaceQueue) {
      // Clear queue and start fresh
      storeActions.clearQueue();
      storeActions.playSong(firstSong);
      storeActions.addToQueue(firstSong);
      storeActions.setCurrentIndex(0);

      // Add remaining songs to queue
      songsToPlay.slice(1).forEach((song) => {
        storeActions.addToQueue(song);
      });
    } else {
      // Add to existing queue
      songsToPlay.forEach((song) => {
        storeActions.addToQueue(song);
      });
    }

    // Show notification
    const shuffleText = shuffle ? " (shuffled)" : "";
    const action = replaceQueue ? "playing" : "added to queue";
    events.emit("notification:show", {
      message: `${action}: ${collectionName} (${songs.length} songs)${shuffleText}`,
      type: "success",
    });
  };

  // Album interactions
  const playAlbum = async (album: Album, shuffle: boolean = false) => {
    try {
      const tracks = await apiClient.getAlbumTracks(
        album.album || "",
        album.artist || undefined
      );

      playCollection(tracks, {
        domainType: "album",
        songIds: tracks.map((track) => track.media_blob_id),
        collectionName: `${album.album}`,
        shuffle,
        replaceQueue: true,
      });
    } catch (error) {
      console.error("failed to play album:", error);
      events.emit("notification:show", {
        message: "failed to load album tracks",
        type: "error",
      });
    }
  };

  const queueAlbum = async (album: Album, shuffle: boolean = false) => {
    try {
      const tracks = await apiClient.getAlbumTracks(
        album.album || "",
        album.artist || undefined
      );

      playCollection(tracks, {
        domainType: "album",
        songIds: tracks.map((track) => track.media_blob_id),
        collectionName: `${album.album}`,
        shuffle,
        replaceQueue: false,
      });
    } catch (error) {
      console.error("failed to queue album:", error);
      events.emit("notification:show", {
        message: "failed to load album tracks",
        type: "error",
      });
    }
  };

  // Artist interactions
  const playArtist = async (
    artist: ArtistSummary,
    shuffle: boolean = false
  ) => {
    try {
      const tracks = await apiClient.searchPost({
        query: artist.artist,
        page_size: 100,
      });

      const songList = tracks.songs.map((song) => ({
        ...song,
        sub_genres: song.sub_genres || null,
      }));

      playCollection(songList, {
        domainType: "artist",
        songIds: songList.map((song) => song.media_blob_id),
        collectionName: artist.artist,
        shuffle,
        replaceQueue: true,
      });
    } catch (error) {
      console.error("failed to play artist:", error);
      events.emit("notification:show", {
        message: "failed to load artist tracks",
        type: "error",
      });
    }
  };

  const queueArtist = async (
    artist: ArtistSummary,
    shuffle: boolean = false
  ) => {
    try {
      const tracks = await apiClient.searchPost({
        query: artist.artist,
        page_size: 100,
      });

      const songList = tracks.songs.map((song) => ({
        ...song,
        sub_genres: song.sub_genres || null,
      }));

      playCollection(songList, {
        domainType: "artist",
        songIds: songList.map((song) => song.media_blob_id),
        collectionName: artist.artist,
        shuffle,
        replaceQueue: false,
      });
    } catch (error) {
      console.error("failed to queue artist:", error);
      events.emit("notification:show", {
        message: "failed to load artist tracks",
        type: "error",
      });
    }
  };

  // Genre interactions
  const playGenre = async (genre: GenreStat, shuffle: boolean = false) => {
    try {
      const tracks = await apiClient.searchPost({
        query: `genre:${genre.name}`,
        page_size: 100,
      });

      const songList = tracks.songs.map((song) => ({
        ...song,
        sub_genres: song.sub_genres || null,
      }));

      playCollection(songList, {
        domainType: "genre",
        songIds: songList.map((song) => song.media_blob_id),
        collectionName: genre.name,
        shuffle,
        replaceQueue: true,
      });
    } catch (error) {
      console.error("failed to play genre:", error);
      events.emit("notification:show", {
        message: "failed to load genre tracks",
        type: "error",
      });
    }
  };

  const queueGenre = async (genre: GenreStat, shuffle: boolean = false) => {
    try {
      const tracks = await apiClient.searchPost({
        query: genre.name,
        page_size: 100,
      });

      const songList = tracks.songs.map((song) => ({
        ...song,
        sub_genres: song.sub_genres || null,
      }));

      playCollection(songList, {
        domainType: "genre",
        songIds: songList.map((song) => song.media_blob_id),
        collectionName: genre.name,
        shuffle,
        replaceQueue: false,
      });
    } catch (error) {
      console.error("failed to queue genre:", error);
      events.emit("notification:show", {
        message: "failed to load genre tracks",
        type: "error",
      });
    }
  };

  // Playlist interactions (for future use)
  const playPlaylist = async (
    playlistId: string,
    playlistName: string,
    shuffle: boolean = false
  ) => {
    try {
      const tracks = await apiClient.getPlaylistSongs(playlistId);

      playCollection(tracks, {
        domainType: "playlist",
        songIds: [playlistId], // Use playlist UUID, not song IDs
        collectionName: playlistName,
        shuffle,
        replaceQueue: true,
      });
    } catch (error) {
      console.error("failed to play playlist:", error);
      events.emit("notification:show", {
        message: "failed to load playlist tracks",
        type: "error",
      });
    }
  };

  const queuePlaylist = async (
    playlistId: string,
    playlistName: string,
    shuffle: boolean = false
  ) => {
    try {
      const tracks = await apiClient.getPlaylistSongs(playlistId);

      playCollection(tracks, {
        domainType: "playlist",
        songIds: [playlistId], // Use playlist UUID, not song IDs
        collectionName: playlistName,
        shuffle,
        replaceQueue: false,
      });
    } catch (error) {
      console.error("failed to queue playlist:", error);
      events.emit("notification:show", {
        message: "failed to load playlist tracks",
        type: "error",
      });
    }
  };

  // Context menu actions for collections

  const createAlbumContextMenuActions = (
    album: Album
  ): CollectionMenuAction[] => {
    return [
      {
        label: "play album",
        icon: "play",
        action: () => playAlbum(album),
      },
      {
        label: "shuffle album",
        icon: "shuffle",
        action: () => playAlbum(album, true),
      },
      { type: "separator" },
      {
        label: "add to queue",
        icon: "queue-add",
        action: () => queueAlbum(album),
      },
      {
        label: "shuffle to queue",
        icon: "queue-shuffle",
        action: () => queueAlbum(album, true),
      },
    ];
  };

  const createArtistContextMenuActions = (
    artist: ArtistSummary
  ): CollectionMenuAction[] => {
    return [
      {
        label: "play all songs",
        icon: "play",
        action: () => playArtist(artist),
      },
      {
        label: "shuffle all songs",
        icon: "shuffle",
        action: () => playArtist(artist, true),
      },
      { type: "separator" },
      {
        label: "add to queue",
        icon: "queue-add",
        action: () => queueArtist(artist),
      },
      {
        label: "shuffle to queue",
        icon: "queue-shuffle",
        action: () => queueArtist(artist, true),
      },
    ];
  };

  const createGenreContextMenuActions = (
    genre: GenreStat
  ): CollectionMenuAction[] => {
    return [
      {
        label: "play all songs",
        icon: "play",
        action: () => playGenre(genre),
      },
      {
        label: "shuffle all songs",
        icon: "shuffle",
        action: () => playGenre(genre, true),
      },
      { type: "separator" },
      {
        label: "add to queue",
        icon: "queue-add",
        action: () => queueGenre(genre),
      },
      {
        label: "shuffle to queue",
        icon: "queue-shuffle",
        action: () => queueGenre(genre, true),
      },
    ];
  };

  // Right-click handlers
  const handleAlbumRightClick = (event: MouseEvent, album: Album) => {
    event.preventDefault();

    const actions = createAlbumContextMenuActions(album);

    events.emit("context-menu:open", {
      x: event.clientX,
      y: event.clientY,
      actions,
    });
  };

  const handleArtistRightClick = (event: MouseEvent, artist: ArtistSummary) => {
    event.preventDefault();

    const actions = createArtistContextMenuActions(artist);

    events.emit("context-menu:open", {
      x: event.clientX,
      y: event.clientY,
      actions,
    });
  };

  const handleGenreRightClick = (event: MouseEvent, genre: GenreStat) => {
    event.preventDefault();

    const actions = createGenreContextMenuActions(genre);

    events.emit("context-menu:open", {
      x: event.clientX,
      y: event.clientY,
      actions,
    });
  };

  // Generic collection play method for feed components
  const playCollectionGeneric = async (
    domainType: "album" | "playlist" | "artist" | "genre",
    domainId: string,
    options: {
      total_songs: number;
      shuffle_enabled: boolean;
      play_source: string;
    }
  ) => {
    try {
      let tracks: Song[] = [];
      let collectionName = "";

      if (domainType === "playlist") {
        const playlistsResponse = await apiClient.getPlaylists();
        const playlist = playlistsResponse.playlists.find(
          (p: any) => p.id === domainId
        );
        if (!playlist) throw new Error(`Playlist ${domainId} not found`);
        tracks = await apiClient.getPlaylistSongs(domainId);
        collectionName = playlist.title;
      } else if (domainType === "album") {
        // For albums, use the proper album API
        // The domainId might be formatted as "artist:album" or just the album name
        let albumName: string;
        let artistName: string | undefined;

        if (domainId.includes(":")) {
          const [artist, album] = domainId.split(":", 2);
          artistName = artist;
          albumName = album || "";
        } else {
          // Try to get album info from feed metadata if available
          albumName = domainId;
          artistName = undefined;
        }

        // Get album tracks using the proper API
        tracks = await apiClient.getAlbumTracks(albumName, artistName);

        // Try to get album metadata for better naming
        try {
          const albumInfo = await apiClient.getAlbumByName(
            albumName,
            artistName
          );
          if (albumInfo) {
            collectionName = `${albumInfo.album} by ${albumInfo.artist}`;
          } else {
            collectionName = tracks[0]?.album || albumName;
          }
        } catch {
          collectionName = tracks[0]?.album || albumName;
        }
      } else if (domainType === "artist") {
        const searchResults = await apiClient.searchPost({
          query: domainId,
          page_size: 100,
        });
        tracks = searchResults.songs.map((song) => ({
          ...song,
          sub_genres: song.sub_genres || null,
        }));
        collectionName = tracks[0]?.artist || "Unknown Artist";
      } else if (domainType === "genre") {
        const searchResults = await apiClient.searchPost({
          query: `genre:${domainId}`,
          page_size: 100,
        });
        tracks = searchResults.songs.map((song) => ({
          ...song,
          sub_genres: song.sub_genres || null,
        }));
        collectionName = domainId;
      }

      playCollection(tracks, {
        domainType,
        songIds: tracks.map((track) => track.media_blob_id),
        collectionName,
        shuffle: options.shuffle_enabled,
        replaceQueue: true,
      });
    } catch (error) {
      console.error("failed to play collection:", error);
      events.emit("notification:show", {
        message: "failed to load collection",
        type: "error",
      });
    }
  };

  // Generic context menu handler for feed components
  const showCollectionContextMenu = (
    event: MouseEvent,
    domainType: "album" | "playlist" | "artist" | "genre",
    domainId: string,
    metadata?: { artist?: string; album?: string }
  ) => {
    event.preventDefault();

    const actions: CollectionMenuAction[] = [
      {
        label: "play",
        icon: "play",
        action: () =>
          playCollectionGeneric(domainType, domainId, {
            total_songs: 0,
            shuffle_enabled: false,
            play_source: "context_menu",
          }),
      },
      {
        label: "shuffle",
        icon: "shuffle",
        action: () =>
          playCollectionGeneric(domainType, domainId, {
            total_songs: 0,
            shuffle_enabled: true,
            play_source: "context_menu",
          }),
      },
      { type: "separator" },
      {
        label: "add to queue",
        icon: "queue-add",
        action: () => {
          // TODO: Implement queue functionality for generic collections
          events.emit("notification:show", {
            message: "queue functionality coming soon",
            type: "info",
          });
        },
      },
    ];

    // Add navigation options based on domain type
    if (domainType === "album" && metadata?.album && metadata?.artist) {
      actions.push(
        { type: "separator" },
        {
          label: "view album",
          icon: "view",
          action: () => {
            const encodedAlbum = encodeURIComponent(metadata.album!);
            const encodedArtist = encodeURIComponent(metadata.artist!);
            // Use navigate from router
            window.location.href = `/album/${encodedArtist}/${encodedAlbum}`;
          },
        },
        {
          label: "view artist",
          icon: "view",
          action: () => {
            const encodedArtist = encodeURIComponent(metadata.artist!);
            window.location.href = `/artist/${encodedArtist}`;
          },
        }
      );
    } else if (domainType === "playlist") {
      actions.push(
        { type: "separator" },
        {
          label: "view playlist",
          icon: "view",
          action: () => {
            window.location.href = `/playlist/${domainId}`;
          },
        }
      );
    } else if (domainType === "artist" && metadata?.artist) {
      actions.push(
        { type: "separator" },
        {
          label: "view artist",
          icon: "view",
          action: () => {
            const encodedArtist = encodeURIComponent(metadata.artist!);
            window.location.href = `/artist/${encodedArtist}`;
          },
        }
      );
    }

    events.emit("context-menu:open", {
      x: event.clientX,
      y: event.clientY,
      actions,
    });
  };

  return {
    // Direct play actions
    playAlbum,
    playArtist,
    playGenre,
    playPlaylist,

    // Queue actions
    queueAlbum,
    queueArtist,
    queueGenre,
    queuePlaylist,

    // Context menu handlers
    handleAlbumRightClick,
    handleArtistRightClick,
    handleGenreRightClick,

    // Context menu action creators (for custom usage)
    createAlbumContextMenuActions,
    createArtistContextMenuActions,
    createGenreContextMenuActions,

    // Generic methods for feed components
    playCollection: playCollectionGeneric,
    showCollectionContextMenu,
  };
}

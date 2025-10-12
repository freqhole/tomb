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

  // Create deterministic UUID from string (for collections without IDs)
  const createDeterministicUUID = (input: string): string => {
    // Simple hash-based UUID generation for consistent IDs
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) & 0xffffffff;
    }
    const hex = Math.abs(hash).toString(16).padStart(32, "0");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-8${hex.slice(15, 18)}-${hex.slice(18, 30)}`;
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
      domainId: string;
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
      domainId,
      collectionName,
      shuffle = false,
      replaceQueue = true,
    } = options;
    const sessionId = getSessionId();

    // Track collection play analytics
    trackCollectionPlay(
      domainType,
      domainId, // Use the actual domainId passed in
      collectionName,
      songs.length,
      shuffle,
      sessionId,
      songs[0]?.id
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
        domainId: createDeterministicUUID(
          `album:${album.artist}:${album.album}`
        ),
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
        domainId: createDeterministicUUID(
          `album:${album.artist}:${album.album}`
        ),
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
        page_size: 1000,
      });

      playCollection(
        tracks.songs.map((song) => ({
          ...song,
          sub_genres: song.sub_genres || null,
        })),
        {
          domainType: "artist",
          domainId: createDeterministicUUID(`artist:${artist.artist}`),
          collectionName: artist.artist,
          shuffle,
          replaceQueue: true,
        }
      );
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
        page_size: 1000,
      });

      playCollection(
        tracks.songs.map((song) => ({
          ...song,
          sub_genres: song.sub_genres || null,
        })),
        {
          domainType: "artist",
          domainId: createDeterministicUUID(`artist:${artist.artist}`),
          collectionName: artist.artist,
          shuffle,
          replaceQueue: false,
        }
      );
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
        page_size: 1000,
      });

      playCollection(
        tracks.songs.map((song) => ({
          ...song,
          sub_genres: song.sub_genres || null,
        })),
        {
          domainType: "genre",
          domainId: createDeterministicUUID(`genre:${genre.slug}`),
          collectionName: genre.name,
          shuffle,
          replaceQueue: true,
        }
      );
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
        query: `genre:${genre.name}`,
        page_size: 1000,
      });

      playCollection(
        tracks.songs.map((song) => ({
          ...song,
          sub_genres: song.sub_genres || null,
        })),
        {
          domainType: "genre",
          domainId: createDeterministicUUID(`genre:${genre.slug}`),
          collectionName: genre.name,
          shuffle,
          replaceQueue: false,
        }
      );
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
        domainId: playlistId, // Playlists already have UUID IDs
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
        domainId: playlistId, // Playlists already have UUID IDs
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
  };
}

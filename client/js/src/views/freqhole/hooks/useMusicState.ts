/* @jsxImportSource solid-js */
import { createSignal, createEffect, createMemo } from "solid-js";
import { apiClient } from "../../../lib/api-client.js";
import type { SearchResult } from "../../../lib/search/types.js";
import type {
  Song,
  Album,
  ArtistSummary,
  Playlist,
  PlaylistSong,
} from "./usePlayerQueue.js";

export interface MusicState {
  // Current view
  currentView: "music" | "artists" | "albums" | "playlists";

  // Data collections with infinite scroll support
  songs: Song[];
  playlists: Playlist[];
  albums: Album[];
  artists: ArtistSummary[];

  // Infinite scroll states
  songsLoading: boolean;
  songsHasMore: boolean;
  playlistsLoading: boolean;
  playlistsHasMore: boolean;
  albumsLoading: boolean;
  albumsHasMore: boolean;
  artistsLoading: boolean;
  artistsHasMore: boolean;

  // Current selections
  currentPlaylist: Playlist | null;
  playlistSongs: PlaylistSong[];
  currentArtist: ArtistSummary | null;
  artistSongs: Song[];
  currentAlbum: Album | null;
  albumSongs: Song[];

  // Loading and error states
  loading: boolean;
  error: string | null;

  // Search and filters
  selectedArtist: string | null;
  selectedAlbum: string | null;
  searchQuery: string;
  searchResults: Song[];
  isSearchActive: boolean;
}

export interface MusicActions {
  // View navigation
  changeView: (view: "music" | "artists" | "albums" | "playlists") => void;

  // Data fetching
  fetchData: () => Promise<void>;
  ensurePlaylistsLoaded: () => Promise<void>;

  // Infinite scroll actions
  loadMoreSongs: () => Promise<void>;
  loadMoreArtists: () => Promise<void>;
  loadMoreAlbums: () => Promise<void>;
  loadMorePlaylists: () => Promise<void>;
  resetCurrentView: () => void;

  // Playlist operations
  viewPlaylist: (playlist: Playlist) => Promise<void>;
  createPlaylist: (data: {
    title: string;
    description: string;
    is_public: boolean;
  }) => Promise<void>;
  updatePlaylist: (
    id: string,
    data: { title: string; description: string; is_public: boolean }
  ) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addSongsToPlaylist: (playlistId: string, songs: Song[]) => Promise<void>;
  removeSongFromPlaylist: (playlistId: string, songId: string) => Promise<void>;

  // Artist operations
  viewArtist: (artist: ArtistSummary) => Promise<void>;

  // Album operations
  viewAlbum: (album: Album) => Promise<void>;

  // Search operations
  performSearch: (query: string) => Promise<void>;
  clearSearch: () => void;

  // Filters
  setSelectedArtist: (artist: string | null) => void;
  setSelectedAlbum: (album: string | null) => void;

  // Utility
  refreshCurrentView: () => Promise<void>;
  clearError: () => void;

  // Unified container ref for infinite scroll
  setScrollContainer: (el: HTMLElement | null) => void;
}

export const useMusicState = () => {
  console.log(
    "🎵 useMusicState hook created:",
    Math.random().toString(36).substr(2, 4)
  );

  // Current view state
  const [currentView, setCurrentView] = createSignal<
    "music" | "artists" | "albums" | "playlists"
  >("music");

  // Manual pagination state
  const [items, setItems] = createSignal<any[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [pagination, setPagination] = createSignal<any>(null);
  const [scrollContainer, setScrollContainer] =
    createSignal<HTMLElement | null>(null);

  // Derived state
  const hasMore = createMemo(() => {
    const pag = pagination();
    return pag ? pag.has_next : true; // Allow initial load when no pagination yet
  });

  // Load more data
  const loadMore = async () => {
    const currentLoading = loading();
    const currentHasMore = hasMore();
    const currentPagination = pagination();

    // Block if loading, or if we have pagination data and no more pages
    if (currentLoading || (currentPagination && !currentHasMore)) {
      console.log("🔄 Load more blocked:", {
        loading: currentLoading,
        hasMore: currentHasMore,
        hasPagination: !!currentPagination,
      });
      return;
    }

    try {
      console.log("🔄 Starting load more...");
      setLoading(true);

      const view = currentView();
      const currentPagination = pagination();
      const nextPage = currentPagination ? currentPagination.page + 1 : 1;

      console.log(`🔄 Fetching ${view} page ${nextPage}`);

      let result;
      switch (view) {
        case "music":
          const songsResult = await apiClient.getSongs({
            page: nextPage,
            page_size: 50,
          });
          result = {
            items: songsResult.songs.map(transformSong),
            pagination: songsResult.pagination,
          };
          break;

        case "artists":
          const artistsResult = await apiClient.getArtists({
            page: nextPage,
            page_size: 50,
          });
          result = {
            items: artistsResult.artists.map((artist) => ({
              ...artist,
              avg_rating: artist.avg_rating || undefined,
            })),
            pagination: artistsResult.pagination,
          };
          break;

        case "albums":
          const albumsResult = await apiClient.getAlbums({
            page: nextPage,
            page_size: 50,
          });
          result = {
            items: albumsResult.albums.map((album) => ({
              ...album,
              album: album.album || "",
              artist: album.artist || "",
              year: album.year || undefined,
              avg_rating: album.avg_rating || undefined,
              total_duration: parseFloat(album.total_duration || "0") || 0,
              genres: album.genres
                ? album.genres.split(",").map((g) => g.trim())
                : [],
              album_thumbnail_id: album.album_thumbnail_id || undefined,
            })),
            pagination: albumsResult.pagination,
          };
          break;

        case "playlists":
          const playlistsResult = await apiClient.getPlaylists({
            page: nextPage,
            page_size: 50,
          });
          result = {
            items: playlistsResult.playlists.map((playlist) => ({
              ...playlist,
              description: playlist.description || undefined,
              song_count: playlist.song_count || undefined,
            })),
            pagination: playlistsResult.pagination,
          };
          break;

        default:
          throw new Error(`Unknown view: ${view}`);
      }

      // Append new items
      setItems((prev) => [...prev, ...result.items]);
      setPagination(result.pagination);

      console.log(
        `🔄 Loaded ${result.items.length} new items, ${items().length} total`
      );
    } catch (err) {
      console.error("🔄 Load more error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Scroll handler
  const handleScroll = () => {
    const container = scrollContainer();
    if (!container || loading() || !hasMore()) return;

    const scrollHeight = container.scrollHeight;
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

    if (distanceFromBottom <= 200) {
      loadMore();
    }
  };

  // Set up scroll listener
  createEffect(() => {
    const container = scrollContainer();
    if (container) {
      container.addEventListener("scroll", handleScroll, { passive: true });
      return () => container.removeEventListener("scroll", handleScroll);
    }
    return undefined;
  });

  // View-specific data accessors
  const songs = () => (currentView() === "music" ? items() : []);
  const artists = () => (currentView() === "artists" ? items() : []);
  const albums = () => (currentView() === "albums" ? items() : []);
  const playlists = () => (currentView() === "playlists" ? items() : []);

  // Current selections
  const [currentPlaylist, setCurrentPlaylist] = createSignal<Playlist | null>(
    null
  );
  const [playlistSongs, setPlaylistSongs] = createSignal<PlaylistSong[]>([]);
  const [currentArtist, setCurrentArtist] = createSignal<ArtistSummary | null>(
    null
  );
  const [artistSongs, setArtistSongs] = createSignal<Song[]>([]);
  const [currentAlbum, setCurrentAlbum] = createSignal<Album | null>(null);
  const [albumSongs, setAlbumSongs] = createSignal<Song[]>([]);

  // Loading and error states for other operations (not pagination)
  const [otherLoading, setOtherLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Search and filters
  const [selectedArtist, setSelectedArtist] = createSignal<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<Song[]>([]);
  const [isSearchActive, setIsSearchActive] = createSignal(false);

  // Transform song data to match expected format
  const transformSong = (song: any): Song => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration_seconds: song.duration_seconds,
    thumbnail_blob_id: song.thumbnail_blob_id,
    media_blob_id: song.media_blob_id || song.id,
  });

  // Transform album track data
  const transformAlbumTrack = (track: any, album: Album): Song => ({
    id: track.song_id,
    title: track.title,
    artist: track.artist,
    album: album.album,
    duration_seconds: track.duration
      ? parseFloat(
          track.duration
            .split(":")
            .reduce((acc: number, time: string) => 60 * acc + +time)
        )
      : undefined,
    thumbnail_blob_id: track.thumbnail_id,
    media_blob_id: track.media_blob_id || track.song_id,
  });

  // Fetch data based on current view (reset and load first page)
  const fetchData = async () => {
    setError(null);
    setItems([]);
    setPagination(null);
    await loadMore();
  };

  // Ensure playlists are loaded for dropdown functionality
  const ensurePlaylistsLoaded = async () => {
    if (playlists().length === 0 && currentView() === "playlists") {
      await loadMore();
    }
  };

  // View playlist details
  const viewPlaylist = async (playlist: Playlist) => {
    try {
      setOtherLoading(true);
      const songs = await apiClient.getPlaylistSongs(playlist.id);
      setCurrentPlaylist(playlist);
      setPlaylistSongs(
        songs.map((song, index) => ({
          position: index + 1,
          song: transformSong(song),
          added_at: new Date().toISOString(),
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load playlist");
    } finally {
      setOtherLoading(false);
    }
  };

  // View artist details
  const viewArtist = async (artist: ArtistSummary) => {
    try {
      setOtherLoading(true);
      const result = await apiClient.getArtistSongs(artist.artist, {
        limit: 1000,
      });
      setCurrentArtist(artist);
      setArtistSongs(result.songs.map(transformSong));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load artist songs"
      );
    } finally {
      setOtherLoading(false);
    }
  };

  // View album details
  const viewAlbum = async (album: Album) => {
    try {
      setOtherLoading(true);
      const tracks = await apiClient.getAlbumTracks(
        album.album || "",
        album.artist || ""
      );
      setCurrentAlbum(album);
      setAlbumSongs(tracks.map((track) => transformAlbumTrack(track, album)));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load album tracks"
      );
    } finally {
      setOtherLoading(false);
    }
  };

  // Create new playlist
  const createPlaylist = async (data: {
    title: string;
    description: string;
    is_public: boolean;
  }) => {
    if (!data.title.trim()) {
      setError("Playlist title is required");
      return;
    }

    try {
      setLoading(true);
      await apiClient.createPlaylist({
        title: data.title,
        description: data.description || undefined,
        is_public: data.is_public,
      });

      // Refresh playlists
      await fetchData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create playlist"
      );
    } finally {
      setLoading(false);
    }
  };

  // Update existing playlist
  const updatePlaylist = async (
    id: string,
    data: { title: string; description: string; is_public: boolean }
  ) => {
    if (!data.title.trim()) {
      setError("Playlist title is required");
      return;
    }

    try {
      setLoading(true);
      await apiClient.updatePlaylist(id, {
        title: data.title,
        description: data.description || null,
        is_public: data.is_public,
      });

      // Refresh playlists
      await fetchData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update playlist"
      );
    } finally {
      setLoading(false);
    }
  };

  // Delete playlist
  const deletePlaylist = async (id: string) => {
    try {
      setLoading(true);
      await apiClient.deletePlaylist(id);

      // Refresh playlists
      await fetchData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete playlist"
      );
    } finally {
      setLoading(false);
    }
  };

  // Add songs to playlist
  const addSongsToPlaylist = async (playlistId: string, songs: Song[]) => {
    if (songs.length === 0) return;

    try {
      setLoading(true);
      for (const song of songs) {
        await apiClient.addSongsToPlaylist(playlistId, [song.id]);
      }

      // Refresh current playlist if it's the one being modified
      const current = currentPlaylist();
      if (current && current.id === playlistId) {
        await viewPlaylist(current);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to add songs to playlist"
      );
    } finally {
      setLoading(false);
    }
  };

  // Remove song from playlist
  const removeSongFromPlaylist = async (playlistId: string, songId: string) => {
    try {
      setLoading(true);
      await apiClient.removeSongsFromPlaylist(playlistId, [songId]);

      // Refresh current playlist if it's the one being modified
      const current = currentPlaylist();
      if (current && current.id === playlistId) {
        await viewPlaylist(current);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to remove song from playlist"
      );
    } finally {
      setLoading(false);
    }
  };

  // Perform search
  const performSearch = async (query: string) => {
    if (!query.trim()) {
      clearSearch();
      return;
    }

    try {
      setLoading(true);
      setSearchQuery(query);
      setIsSearchActive(true);

      // Use API search and filter out suggestions from main content
      const searchResult: SearchResult = await apiClient.searchMusic(query, {
        page_size: 50,
      });

      // Convert search results to Song format, excluding suggestions
      const songResults: Song[] = searchResult.results
        .filter((result) => result.result_type === "song")
        .map((result) => ({
          id: result.id,
          title: result.title,
          artist: result.metadata?.artist || "",
          album: result.metadata?.album || "",
          album_artist: result.metadata?.album_artist,
          track_number: result.metadata?.track_number,
          disc_number: result.metadata?.disc_number,
          genre: result.metadata?.genre,
          year: result.metadata?.year,
          bpm: result.metadata?.bpm,
          key_signature: result.metadata?.key_signature,
          rating: result.metadata?.rating,
          is_favorite: result.metadata?.is_favorite || false,
          tags: result.metadata?.tags || [],
          duration_seconds: result.metadata?.duration_seconds,
          thumbnail_blob_id: result.thumbnail_blob_id || undefined,
          media_blob_id: result.media_blob_id || result.id,
          waveform_blob_id: result.metadata?.waveform_blob_id || undefined,
          created_at: result.created_at.toISOString(),
          updated_at: result.updated_at.toISOString(),
        }));

      setSearchResults(songResults);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  // Clear search
  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
    setIsSearchActive(false);
  };

  // Handle view changes
  const changeView = (
    newView: "music" | "artists" | "albums" | "playlists"
  ) => {
    if (newView === currentView()) return;

    setCurrentView(newView);
    fetchData();

    // Clear selections when changing views
    setSelectedArtist(null);
    setSelectedAlbum(null);
    setCurrentPlaylist(null);
    setCurrentArtist(null);
    setCurrentAlbum(null);
    setArtistSongs([]);
    setAlbumSongs([]);
    setPlaylistSongs([]);
    clearSearch();
  };

  // Reset current view data
  const resetCurrentView = () => {
    setItems([]);
    setPagination(null);
  };

  // Refresh current view
  const refreshCurrentView = async () => {
    await fetchData();
  };

  // Clear error
  const clearError = () => {
    setError(null);
  };

  return {
    // State
    state: {
      currentView,
      songs,
      playlists,
      albums,
      artists,

      // Infinite scroll states - using createMemo for proper reactivity
      songsLoading: createMemo(() => {
        const result = currentView() === "music" ? loading() : false;
        console.log("🎵 songsLoading checked:", {
          currentView: currentView(),
          loading: loading(),
          result,
        });
        return result;
      }),
      songsHasMore: createMemo(() => {
        const result = currentView() === "music" ? hasMore() : false;
        console.log("🎵 songsHasMore checked:", {
          currentView: currentView(),
          hasMore: hasMore(),
          result,
        });
        return result;
      }),
      playlistsLoading: createMemo(() => {
        const result = currentView() === "playlists" ? loading() : false;
        console.log("📂 playlistsLoading checked:", {
          currentView: currentView(),
          loading: loading(),
          result,
        });
        return result;
      }),
      playlistsHasMore: createMemo(() => {
        const result = currentView() === "playlists" ? hasMore() : false;
        console.log("📂 playlistsHasMore checked:", {
          currentView: currentView(),
          hasMore: hasMore(),
          result,
        });
        return result;
      }),
      albumsLoading: createMemo(() => {
        const result = currentView() === "albums" ? loading() : false;
        console.log("💿 albumsLoading checked:", {
          currentView: currentView(),
          loading: loading(),
          result,
        });
        return result;
      }),
      albumsHasMore: createMemo(() => {
        const result = currentView() === "albums" ? hasMore() : false;
        console.log("💿 albumsHasMore checked:", {
          currentView: currentView(),
          hasMore: hasMore(),
          result,
        });
        return result;
      }),
      artistsLoading: createMemo(() => {
        const result = currentView() === "artists" ? loading() : false;
        console.log("🎤 artistsLoading checked:", {
          currentView: currentView(),
          loading: loading(),
          result,
        });
        return result;
      }),
      artistsHasMore: createMemo(() => {
        const result = currentView() === "artists" ? hasMore() : false;
        console.log("🎤 artistsHasMore checked:", {
          currentView: currentView(),
          hasMore: hasMore(),
          result,
        });
        return result;
      }),

      currentPlaylist,
      playlistSongs,
      currentArtist,
      artistSongs,
      currentAlbum,
      albumSongs,
      loading: otherLoading,
      error,
      selectedArtist,
      selectedAlbum,
      searchQuery,
      searchResults,
      isSearchActive,
    },

    // Actions
    actions: {
      changeView,
      fetchData,
      ensurePlaylistsLoaded,

      // Infinite scroll actions - unified
      loadMoreSongs: () =>
        currentView() === "music" ? loadMore() : Promise.resolve(),
      loadMoreArtists: () =>
        currentView() === "artists" ? loadMore() : Promise.resolve(),
      loadMoreAlbums: () =>
        currentView() === "albums" ? loadMore() : Promise.resolve(),
      loadMorePlaylists: () =>
        currentView() === "playlists" ? loadMore() : Promise.resolve(),
      resetCurrentView,

      viewPlaylist,
      createPlaylist,
      updatePlaylist,
      deletePlaylist,
      addSongsToPlaylist,
      removeSongFromPlaylist,
      viewArtist,
      viewAlbum,
      performSearch,
      clearSearch,
      setSelectedArtist,
      setSelectedAlbum,
      refreshCurrentView,
      clearError,

      // Unified container ref for infinite scroll
      setScrollContainer,
    },
  };
};

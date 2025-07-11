/* @jsxImportSource solid-js */
import { createSignal } from "solid-js";
import { apiClient } from "../../../lib/api-client.js";
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

  // Data collections
  songs: Song[];
  playlists: Playlist[];
  albums: Album[];
  artists: ArtistSummary[];

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
  fetchData: (view: string) => Promise<void>;
  ensurePlaylistsLoaded: () => Promise<void>;

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
}

export const useMusicState = () => {
  // Current view state
  const [currentView, setCurrentView] = createSignal<
    "music" | "artists" | "albums" | "playlists"
  >("music");

  // Data collections
  const [songs, setSongs] = createSignal<Song[]>([]);
  const [playlists, setPlaylists] = createSignal<Playlist[]>([]);
  const [albums, setAlbums] = createSignal<Album[]>([]);
  const [artists, setArtists] = createSignal<ArtistSummary[]>([]);

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

  // Loading and error states
  const [loading, setLoading] = createSignal(false);
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

  // Fetch data based on current view
  const fetchData = async (view: string) => {
    setLoading(true);
    setError(null);

    try {
      switch (view) {
        case "music":
          const songsData = await apiClient.getSongs(1000);
          setSongs(songsData.map(transformSong));
          break;

        case "artists":
          const artistsData = await apiClient.getArtists();
          setArtists(
            artistsData.map((artist) => ({
              ...artist,
              avg_rating: artist.avg_rating || undefined,
            }))
          );
          break;

        case "playlists":
          const playlistsData = await apiClient.getPlaylists(1000);
          setPlaylists(
            playlistsData.map((playlist) => ({
              ...playlist,
              description: playlist.description || undefined,
              song_count: playlist.song_count || undefined,
            }))
          );
          break;

        case "albums":
          const albumsData = await apiClient.getAlbums();
          setAlbums(
            albumsData.map((album) => ({
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
            }))
          );
          break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  // Ensure playlists are loaded for dropdown functionality
  const ensurePlaylistsLoaded = async () => {
    if (playlists().length === 0) {
      try {
        const playlistsData = await apiClient.getPlaylists(1000);
        setPlaylists(
          playlistsData.map((playlist) => ({
            ...playlist,
            description: playlist.description || undefined,
            song_count: playlist.song_count || undefined,
          }))
        );
      } catch (err) {
        console.error("Failed to load playlists:", err);
      }
    }
  };

  // View playlist details
  const viewPlaylist = async (playlist: Playlist) => {
    try {
      setLoading(true);
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
      setLoading(false);
    }
  };

  // View artist details
  const viewArtist = async (artist: ArtistSummary) => {
    try {
      setLoading(true);
      const songs = await apiClient.getArtistSongs(artist.artist, 1000);
      setCurrentArtist(artist);
      setArtistSongs(songs.map(transformSong));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load artist songs"
      );
    } finally {
      setLoading(false);
    }
  };

  // View album details
  const viewAlbum = async (album: Album) => {
    try {
      setLoading(true);
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
      setLoading(false);
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
      await fetchData("playlists");
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
      await fetchData("playlists");
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
      await fetchData("playlists");
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

      // For now, filter existing songs - could be enhanced with server-side search
      const results = songs().filter(
        (song) =>
          song.title.toLowerCase().includes(query.toLowerCase()) ||
          song.artist?.toLowerCase().includes(query.toLowerCase()) ||
          song.album?.toLowerCase().includes(query.toLowerCase())
      );

      setSearchResults(results);
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
    fetchData(newView);

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

  // Refresh current view
  const refreshCurrentView = async () => {
    await fetchData(currentView());
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
      currentPlaylist,
      playlistSongs,
      currentArtist,
      artistSongs,
      currentAlbum,
      albumSongs,
      loading,
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
    },
  };
};

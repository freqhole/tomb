/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import { createSignal, Show, For, onMount, onCleanup } from "solid-js";
import {
  SearchProvider,
  useSearchContext,
} from "../components/search/SearchContext.js";
import { SearchBox } from "../components/search/SearchBox.js";
import { ApiClient } from "../lib/api-client.js";

interface ZuneDemoProps {
  /** API base URL */
  apiBaseUrl?: string;
  /** Auto-connect to API */
  autoConnect?: boolean;
}

interface Song {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  album_artist?: string;
  track_number?: number;
  disc_number?: number;
  duration_seconds?: number;
  genre?: string;
  year?: number;
  bpm?: number;
  key_signature?: string;
  rating?: number;
  is_favorite: boolean;
  tags: string[];
  display_title: string;
  detailed_display_title: string;
  created_at: string;
  media_blob_id: string;
  thumbnail_blob_id?: string;
  waveform_blob_id?: string;
  thumbnail_blob_ids: string[];
}

interface PlaylistSong {
  position: number;
  song: Song;
  added_at: string;
}

interface QueueItem {
  song: Song;
  id: string;
}

interface ArtistSummary {
  artist: string;
  song_count: number;
  album_count: number;
  total_duration: number;
  genres: string[];
  avg_rating?: number;
  favorite_count: number;
}

interface Playlist {
  id: string;
  title: string;
  description?: string;
  is_public: boolean;
  is_collaborative: boolean;
  song_count?: number;
  created_at: string;
}

interface Album {
  album: string;
  artist: string;
  year?: number;
  track_count: number;
  disc_count: number;
  total_duration: number;
  genres: string[];
  avg_rating?: number;
  favorite_count: number;
  album_thumbnail_id?: string;
}

const createApiClient = (baseUrl: string): ApiClient => {
  return new ApiClient({ baseUrl });
};

// SVG Icons
const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const PauseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

const PrevIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
  </svg>
);

const NextIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
  </svg>
);

const QueueIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z" />
  </svg>
);

const AddIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
);

const VolumeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
);

const MusicIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
  </svg>
);

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
  </svg>
);

const DeleteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
  </svg>
);

const FreqholeIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 500 500"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M250 405L125 155L375 155L303.611 340.714L250 405Z"
      fill="#FF00FF"
    />
  </svg>
);
const DragIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
  </svg>
);

const MoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
  </svg>
);

function ZuneDemoContent() {
  const context = useSearchContext();
  const [currentView, setCurrentView] = createSignal<
    "music" | "artists" | "albums" | "playlists"
  >("music");
  const [songs, setSongs] = createSignal<Song[]>([]);
  const [playlists, setPlaylists] = createSignal<Playlist[]>([]);
  const [albums, setAlbums] = createSignal<Album[]>([]);
  const [artists, setArtists] = createSignal<ArtistSummary[]>([]);
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
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Playlist management state
  const [showPlaylistModal, setShowPlaylistModal] = createSignal(false);
  const [playlistModalMode, setPlaylistModalMode] = createSignal<
    "create" | "edit" | "add-songs"
  >("create");
  const [selectedSongs, setSelectedSongs] = createSignal<Song[]>([]);
  const [editingPlaylist, setEditingPlaylist] = createSignal<Playlist | null>(
    null
  );
  const [showPlaylistDropdown, setShowPlaylistDropdown] = createSignal<
    string | null
  >(null);

  // Player state
  const [currentSong, setCurrentSong] = createSignal<Song | null>(null);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [volume, setVolume] = createSignal(0.7);
  const [audioElement, setAudioElement] = createSignal<HTMLAudioElement | null>(
    null
  );

  // Play queue
  const [playQueue, setPlayQueue] = createSignal<QueueItem[]>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = createSignal(0);
  const [showQueue, setShowQueue] = createSignal(false);

  // Filters and search
  const [selectedArtist, setSelectedArtist] = createSignal<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<Song[]>([]);
  const [isSearchActive, setIsSearchActive] = createSignal(false);

  // Playlist management modal state
  const [playlistForm, setPlaylistForm] = createSignal({
    title: "",
    description: "",
    is_public: false,
  });

  // Animation states
  const [viewTransition, setViewTransition] = createSignal<
    "entering" | "exiting" | "idle"
  >("idle");

  const apiClient = createApiClient("http://localhost:8080");

  // Fetch data based on current view
  const fetchData = async (view: string) => {
    setLoading(true);
    setError(null);

    try {
      switch (view) {
        case "music":
          const songsResponse = await fetch("/api/media/songs?limit=1000");
          const songsData = await songsResponse.json();
          setSongs(songsData.songs || []);
          break;

        case "artists":
          const artistsResponse = await fetch("/api/media/artists");
          const artistsData = await artistsResponse.json();
          setArtists(artistsData.artists || []);
          break;

        case "playlists":
          const playlistsResponse = await fetch(
            "/api/media/playlists?limit=1000"
          );
          const playlistsData = await playlistsResponse.json();
          setPlaylists(playlistsData.playlists || []);
          break;

        case "albums":
          const albumsResponse = await fetch("/api/media/albums");
          const albumsData = await albumsResponse.json();
          setAlbums(albumsData || []);
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
        const playlistsResponse = await fetch(
          "/api/media/playlists?limit=1000"
        );
        const playlistsData = await playlistsResponse.json();
        setPlaylists(playlistsData.playlists || []);
      } catch (err) {
        console.error("Failed to load playlists:", err);
      }
    }
  };

  // Initialize audio element
  onMount(() => {
    const audio = new Audio();
    setAudioElement(audio);

    audio.addEventListener("loadedmetadata", () => {
      setDuration(audio.duration);
    });

    audio.addEventListener("timeupdate", () => {
      setCurrentTime(audio.currentTime);
    });

    audio.addEventListener("ended", () => {
      setIsPlaying(false);
      setCurrentTime(0);
      playNext();
    });

    fetchData(currentView());
    ensurePlaylistsLoaded(); // Load playlists on mount
  });

  onCleanup(() => {
    const audio = audioElement();
    if (audio) {
      audio.pause();
      audio.src = "";
    }
  });

  // Queue management
  const addToQueue = (song: Song) => {
    // Check if song is already in queue
    const existingItem = playQueue().find((item) => item.song.id === song.id);
    if (existingItem) return;

    const queueItem: QueueItem = {
      song,
      id: `queue-${song.id}-${Date.now()}`,
    };
    setPlayQueue((prev) => [...prev, queueItem]);
  };

  const playNext = () => {
    const queue = playQueue();
    const currentIndex = currentQueueIndex();
    if (currentIndex < queue.length - 1) {
      setCurrentQueueIndex(currentIndex + 1);
      const nextSong = queue[currentIndex + 1];
      if (nextSong) {
        playSong(nextSong.song, false);
      }
    }
  };

  const playPrevious = () => {
    const queue = playQueue();
    const currentIndex = currentQueueIndex();
    if (currentIndex > 0) {
      setCurrentQueueIndex(currentIndex - 1);
      const prevSong = queue[currentIndex - 1];
      if (prevSong) {
        playSong(prevSong.song, false);
      }
    }
  };

  const removeFromQueue = (queueId: string) => {
    setPlayQueue((prev) => prev.filter((item) => item.id !== queueId));
  };

  const clearQueue = () => {
    setPlayQueue([]);
    setCurrentQueueIndex(0);
  };

  // Handle view changes with animation
  const changeView = (
    newView: "music" | "artists" | "albums" | "playlists"
  ) => {
    if (newView === currentView()) return;

    setViewTransition("exiting");

    setTimeout(() => {
      setCurrentView(newView);
      setViewTransition("entering");
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

      setTimeout(() => {
        setViewTransition("idle");
      }, 200);
    }, 100);
  };

  // Player controls
  const togglePlayback = () => {
    const audio = audioElement();
    if (!audio || !currentSong()) return;

    if (isPlaying()) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play();
      setIsPlaying(true);
    }
  };

  const playSong = (song: Song, addToQueueIfEmpty = true) => {
    const audio = audioElement();
    if (!audio) return;

    setCurrentSong(song);
    audio.src = `/api/blobs/${song.media_blob_id}`;
    audio.volume = volume();
    audio.play();
    setIsPlaying(true);

    if (addToQueueIfEmpty && playQueue().length === 0) {
      const queueItem: QueueItem = {
        song,
        id: `queue-${song.id}-${Date.now()}`,
      };
      setPlayQueue([queueItem]);
      setCurrentQueueIndex(0);
    }
  };

  const viewPlaylist = async (playlist: Playlist) => {
    try {
      const response = await fetch(`/api/media/playlists/${playlist.id}/songs`);
      const data = await response.json();
      const songs = data.songs || [];

      setCurrentPlaylist(playlist);
      setPlaylistSongs(songs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load playlist");
    }
  };

  const viewArtist = async (artist: ArtistSummary) => {
    try {
      const response = await fetch(
        `/api/media/artists/${encodeURIComponent(artist.artist)}/songs?limit=1000`
      );
      const data = await response.json();
      const songs = data.songs || [];

      setCurrentArtist(artist);
      setArtistSongs(songs);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load artist songs"
      );
    }
  };

  const viewAlbum = async (album: Album) => {
    try {
      const albumParam = encodeURIComponent(album.album || "");
      const artistParam = album.artist
        ? `&artist=${encodeURIComponent(album.artist)}`
        : "";
      const response = await fetch(
        `/api/media/albums/${albumParam}/tracks?${artistParam}`
      );
      const data = await response.json();
      const songs = data.tracks || [];

      setCurrentAlbum(album);
      setAlbumSongs(
        songs.map((track: any) => ({
          id: track.song_id,
          title: track.title,
          artist: track.artist,
          album: album.album,
          track_number: track.track_number,
          disc_number: track.disc_number,
          duration_seconds: track.duration
            ? parseFloat(
                track.duration
                  .split(":")
                  .reduce((acc: number, time: string) => 60 * acc + +time)
              )
            : null,
          genre: track.genre,
          year: track.year,
          rating: track.rating,
          is_favorite: track.is_favorite,
          display_title: track.title,
          detailed_display_title: `${track.title} - ${track.artist}`,
          media_blob_id: track.media_blob_id,
          thumbnail_blob_id: track.thumbnail_id,
          waveform_blob_id: track.waveform_id,
          thumbnail_blob_ids: null,
          created_at: new Date().toISOString(),
        }))
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load album tracks"
      );
    }
  };

  const playPlaylist = async (playlist: Playlist) => {
    try {
      const response = await fetch(`/api/media/playlists/${playlist.id}/songs`);
      const data = await response.json();
      const songs = data.songs || [];

      if (songs.length > 0) {
        setCurrentPlaylist(playlist);
        setPlaylistSongs(songs);

        const newQueue: QueueItem[] = songs.map(
          (item: PlaylistSong, index: number) => ({
            song: item.song,
            id: `playlist-${playlist.id}-${index}`,
          })
        );

        setPlayQueue(newQueue);
        setCurrentQueueIndex(0);
        playSong(songs[0].song, false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load playlist");
    }
  };

  const playArtist = async (artist: ArtistSummary) => {
    try {
      const response = await fetch(
        `/api/media/artists/${encodeURIComponent(artist.artist)}/songs?limit=1000`
      );
      const data = await response.json();
      const songs = data.songs || [];

      if (songs.length > 0) {
        setCurrentArtist(artist);
        setArtistSongs(songs);

        const newQueue: QueueItem[] = songs.map(
          (song: Song, index: number) => ({
            song,
            id: `artist-${artist.artist}-${index}`,
          })
        );

        setPlayQueue(newQueue);
        setCurrentQueueIndex(0);
        playSong(songs[0], false);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load artist songs"
      );
    }
  };

  const playAlbum = async (album: Album) => {
    try {
      const albumParam = encodeURIComponent(album.album || "");
      const artistParam = album.artist
        ? `&artist=${encodeURIComponent(album.artist)}`
        : "";
      const response = await fetch(
        `/api/media/albums/${albumParam}/tracks?${artistParam}`
      );
      const data = await response.json();
      const tracks = data.tracks || [];

      if (tracks.length > 0) {
        const songs = tracks.map((track: any) => ({
          id: track.song_id,
          title: track.title,
          artist: track.artist,
          album: album.album,
          track_number: track.track_number,
          disc_number: track.disc_number,
          duration_seconds: track.duration
            ? parseFloat(
                track.duration
                  .split(":")
                  .reduce((acc: number, time: string) => 60 * acc + +time)
              )
            : null,
          genre: track.genre,
          year: track.year,
          rating: track.rating,
          is_favorite: track.is_favorite,
          display_title: track.title,
          detailed_display_title: `${track.title} - ${track.artist}`,
          media_blob_id: track.media_blob_id,
          thumbnail_blob_id: track.thumbnail_id,
          waveform_blob_id: track.waveform_id,
          thumbnail_blob_ids: null,
          created_at: new Date().toISOString(),
        }));

        setCurrentAlbum(album);
        setAlbumSongs(songs);

        const newQueue: QueueItem[] = songs.map(
          (song: Song, index: number) => ({
            song,
            id: `album-${album.album}-${index}`,
          })
        );

        setPlayQueue(newQueue);
        setCurrentQueueIndex(0);
        playSong(songs[0], false);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load album tracks"
      );
    }
  };

  // Playlist Management Functions
  const openCreatePlaylistModal = (songsToAdd?: Song[]) => {
    setPlaylistModalMode("create");
    setSelectedSongs(songsToAdd || []);
    setPlaylistForm({ title: "", description: "", is_public: false });
    setEditingPlaylist(null);
    setShowPlaylistModal(true);
  };

  const openEditPlaylistModal = (playlist: Playlist) => {
    setPlaylistModalMode("edit");
    setEditingPlaylist(playlist);
    setPlaylistForm({
      title: playlist.title,
      description: playlist.description || "",
      is_public: playlist.is_public,
    });
    setShowPlaylistModal(true);
  };

  const openAddSongsModal = (playlist: Playlist, songs: Song[]) => {
    setPlaylistModalMode("add-songs");
    setEditingPlaylist(playlist);
    setSelectedSongs(songs);
    setShowPlaylistModal(true);
  };

  const closePlaylistModal = () => {
    setShowPlaylistModal(false);
    setSelectedSongs([]);
    setEditingPlaylist(null);
    setPlaylistForm({ title: "", description: "", is_public: false });
  };

  const createPlaylist = async () => {
    if (!playlistForm().title.trim()) return;

    try {
      const response = await fetch("/api/media/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: playlistForm().title,
          description: playlistForm().description || null,
          is_public: playlistForm().is_public,
          is_collaborative: false,
          song_ids: selectedSongs().map((s) => s.id),
        }),
      });

      if (response.ok) {
        closePlaylistModal();
        if (currentView() === "playlists") {
          fetchData("playlists");
        }
      }
    } catch (err) {
      setError("Failed to create playlist");
    }
  };

  const updatePlaylist = async () => {
    if (!editingPlaylist() || !playlistForm().title.trim()) return;

    try {
      const response = await fetch(
        `/api/media/playlists/${editingPlaylist()!.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: playlistForm().title,
            description: playlistForm().description || null,
            is_public: playlistForm().is_public,
            is_collaborative: false,
          }),
        }
      );

      if (response.ok) {
        closePlaylistModal();
        if (currentView() === "playlists") {
          fetchData("playlists");
        }
      }
    } catch (err) {
      setError("Failed to update playlist");
    }
  };

  const addSongsToPlaylist = async () => {
    if (!editingPlaylist() || selectedSongs().length === 0) return;

    try {
      const response = await fetch(
        `/api/media/playlists/${editingPlaylist()!.id}/songs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            song_ids: selectedSongs().map((s) => s.id),
          }),
        }
      );

      if (response.ok) {
        closePlaylistModal();
        // Refresh playlist songs if we're viewing this playlist
        if (currentPlaylist()?.id === editingPlaylist()!.id) {
          viewPlaylist(currentPlaylist()!);
        }
      }
    } catch (err) {
      setError("Failed to add songs to playlist");
    }
  };

  const removeSongFromPlaylist = async (playlist: Playlist, songId: string) => {
    try {
      const response = await fetch(
        `/api/media/playlists/${playlist.id}/songs`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            song_ids: [songId],
          }),
        }
      );

      if (response.ok) {
        // Refresh playlist songs if we're viewing this playlist
        if (currentPlaylist()?.id === playlist.id) {
          viewPlaylist(playlist);
        }
      }
    } catch (err) {
      setError("Failed to remove song from playlist");
    }
  };

  const reorderPlaylistSongs = async (
    playlist: Playlist,
    songIds: string[]
  ) => {
    try {
      const response = await fetch(
        `/api/media/playlists/${playlist.id}/reorder`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            song_ids: songIds,
          }),
        }
      );

      if (response.ok) {
        // Refresh playlist songs
        viewPlaylist(playlist);
      }
    } catch (err) {
      setError("Failed to reorder playlist");
    }
  };

  const addSongToExistingPlaylist = async (song: Song, playlist: Playlist) => {
    try {
      const response = await fetch(
        `/api/media/playlists/${playlist.id}/songs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            song_ids: [song.id],
          }),
        }
      );

      if (response.ok) {
        setShowPlaylistDropdown(null);
        // Show success feedback
        console.log(`Added "${song.title}" to playlist "${playlist.title}"`);
      }
    } catch (err) {
      setError("Failed to add song to playlist");
    }
  };

  const deletePlaylist = async (playlist: Playlist) => {
    try {
      const response = await fetch(`/api/media/playlists/${playlist.id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        // Clear current playlist if it was deleted
        if (currentPlaylist()?.id === playlist.id) {
          setCurrentPlaylist(null);
          setPlaylistSongs([]);
        }
        // Refresh playlists
        if (currentView() === "playlists") {
          fetchData("playlists");
        }
      }
    } catch (err) {
      setError("Failed to delete playlist");
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const seekTo = (percentage: number) => {
    const audio = audioElement();
    if (!audio) return;

    audio.currentTime = (percentage / 100) * duration();
  };

  // Data filtering
  const getFilteredSongs = () => {
    // If we're in search mode and have search results, use those
    if (isSearchActive() && searchResults().length > 0) {
      return searchResults();
    }

    let filtered = songs();

    if (selectedArtist()) {
      filtered = filtered.filter((song) => song.artist === selectedArtist());
    }

    if (selectedAlbum()) {
      filtered = filtered.filter((song) => song.album === selectedAlbum());
    }

    if (searchQuery().trim() && !isSearchActive()) {
      const query = searchQuery().toLowerCase();
      filtered = filtered.filter(
        (song) =>
          song.title.toLowerCase().includes(query) ||
          song.artist?.toLowerCase().includes(query) ||
          song.album?.toLowerCase().includes(query)
      );
    }

    return filtered;
  };

  // Search integration
  const handleSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion);
    context.state.setQuery(suggestion);
    changeView("music");
    performSearch(suggestion);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    context.state.setQuery(query);
    changeView("music");
    if (query.trim()) {
      performSearch(query);
    } else {
      setIsSearchActive(false);
      setSearchResults([]);
    }
  };

  const performSearch = async (query: string) => {
    if (!query.trim()) {
      setIsSearchActive(false);
      setSearchResults([]);
      return;
    }

    setIsSearchActive(true);
    setLoading(true);

    try {
      // Use the search context to perform the search
      await context.performSearch();
      const results = context.search.results();

      // Extract songs from search results
      if (results?.results) {
        // Convert search results to songs format
        const searchSongs: Song[] = results.results
          .filter((result: any) => result.result_type === "song")
          .map((result: any) => ({
            id: result.id,
            title: result.title,
            artist: result.metadata?.artist || "",
            album: result.metadata?.album || "",
            album_artist: result.metadata?.album_artist,
            track_number: result.metadata?.track_number,
            disc_number: result.metadata?.disc_number,
            duration_seconds: result.metadata?.duration_seconds,
            genre: result.metadata?.genre,
            year: result.metadata?.year,
            bpm: result.metadata?.bpm,
            key_signature: result.metadata?.key_signature,
            rating: result.metadata?.rating,
            is_favorite: result.metadata?.is_favorite || false,
            tags: result.metadata?.tags || [],
            display_title: result.title,
            detailed_display_title: result.title,
            created_at: result.created_at,
            media_blob_id: result.media_blob_id || "",
            thumbnail_blob_id: result.thumbnail_blob_id,
            waveform_blob_id: result.waveform_blob_id,
            thumbnail_blob_ids: result.thumbnail_blob_ids || [],
          }));

        setSearchResults(searchSongs);
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error("Search failed:", err);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    context.state.setQuery("");
    setIsSearchActive(false);
    setSearchResults([]);
  };

  // Group suggestions by category
  const getGroupedSuggestions = () => {
    const suggestions = context.suggestions.suggestions();
    if (!suggestions.length) return [];

    const groups = new Map<string, any[]>();

    suggestions.forEach((suggestion) => {
      const category = suggestion.category || "general";
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(suggestion);
    });

    // Convert to array and sort by category priority
    const categoryOrder = ["word", "title", "playlist", "general"];
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const aIndex = categoryOrder.indexOf(a);
      const bIndex = categoryOrder.indexOf(b);
      const aOrder = aIndex === -1 ? categoryOrder.length : aIndex;
      const bOrder = bIndex === -1 ? categoryOrder.length : bIndex;
      return aOrder - bOrder;
    });
  };

  const getCategoryDisplayName = (category: string) => {
    const categoryNames: Record<string, string> = {
      word: "search suggestions",
      title: "songs",
      playlist: "playlists",
      general: "suggestions",
    };
    return categoryNames[category] || category;
  };

  // const getViewTitle = () => {
  //   if (currentPlaylist()) {
  //     return currentPlaylist()!.title;
  //   }

  //   switch (currentView()) {
  //     case "music":
  //       return selectedArtist() || selectedAlbum()
  //         ? `${selectedArtist() || selectedAlbum()}`
  //         : "music";
  //     case "artists":
  //       return "artists";
  //     case "albums":
  //       return "albums";
  //     case "playlists":
  //       return "playlists";
  //     default:
  //       return "music";
  //   }
  // };

  const getCurrentSongs = () => {
    if (currentPlaylist()) {
      return playlistSongs().map((item) => item.song);
    }
    if (currentArtist()) {
      return artistSongs();
    }
    if (currentAlbum()) {
      return albumSongs();
    }
    return getFilteredSongs();
  };

  const shouldShowSuggestions = () => {
    return isSearchActive() && context.suggestions.suggestions().length > 0;
  };

  const shouldShowSongsTable = () => {
    // Show songs table if we have songs AND either not searching or have search results
    return (
      getCurrentSongs().length > 0 &&
      (!isSearchActive() || searchResults().length > 0)
    );
  };

  return (
    <div class="zune-demo">
      {/* Header */}
      <div class="zune-header">
        <div class="zune-branding">
          <div class="zune-logo">
            <span class="zune-logo-text">
              freqh
              <FreqholeIcon />
              le
            </span>
          </div>

          <nav class="zune-nav">
            <button
              class={`zune-nav-item ${currentView() === "music" ? "active" : ""}`}
              onClick={() => changeView("music")}
            >
              music
            </button>
            <button
              class={`zune-nav-item ${currentView() === "artists" ? "active" : ""}`}
              onClick={() => changeView("artists")}
            >
              artists
            </button>
            <button
              class={`zune-nav-item ${currentView() === "albums" ? "active" : ""}`}
              onClick={() => changeView("albums")}
            >
              albums
            </button>
            <button
              class={`zune-nav-item ${currentView() === "playlists" ? "active" : ""}`}
              onClick={() => changeView("playlists")}
            >
              playlists
            </button>
          </nav>

          <div class="zune-search-container">
            <SearchBox
              placeholder="search music..."
              useInternalState={false}
              query={searchQuery()}
              onQueryChange={(query) => {
                setSearchQuery(query);
                context.state.setQuery(query);
                if (!query.trim()) {
                  setIsSearchActive(false);
                  setSearchResults([]);
                }
              }}
              onSearch={handleSearch}
              autoSearch={true}
              debounceMs={300}
              class="zune-search-box"
            />
            <Show when={searchQuery().trim()}>
              <button
                class="zune-search-clear"
                onClick={clearSearch}
                title="Clear search"
              >
                <CloseIcon />
              </button>
            </Show>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div class="zune-main">
        {/* Left Sidebar */}
        <div class="zune-sidebar">
          <Show when={currentView() === "playlists"}>
            <div class="zune-filter-sidebar">
              {/* <h3>playlists</h3> */}
              <div class="zune-filter-list">
                <For each={playlists()}>
                  {(playlist) => (
                    <div class="zune-filter-item-container">
                      <button
                        class={`zune-filter-item ${currentPlaylist()?.id === playlist.id ? "active" : ""}`}
                        onClick={() => viewPlaylist(playlist)}
                      >
                        {playlist.title}
                        <span class="zune-filter-count">
                          {playlist.song_count || 0}
                        </span>
                      </button>
                      <div class="zune-filter-actions">
                        <button
                          class="zune-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditPlaylistModal(playlist);
                          }}
                          title="Edit playlist"
                        >
                          <EditIcon />
                        </button>
                        <button
                          class="zune-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              confirm(`Delete playlist "${playlist.title}"?`)
                            ) {
                              deletePlaylist(playlist);
                            }
                          }}
                          title="Delete playlist"
                        >
                          <DeleteIcon />
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={currentView() === "artists"}>
            <div class="zune-filter-sidebar">
              <div class="zune-filter-list">
                <For each={artists()}>
                  {(artist) => (
                    <button
                      class={`zune-filter-item ${currentArtist()?.artist === artist.artist ? "active" : ""}`}
                      onClick={() => viewArtist(artist)}
                    >
                      {artist.artist}
                      <span class="zune-filter-count">
                        {artist.song_count || 0}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <Show when={currentView() === "albums"}>
            <div class="zune-filter-sidebar">
              <div class="zune-filter-list">
                <For each={albums()}>
                  {(album) => (
                    <button
                      class={`zune-filter-item ${currentAlbum()?.album === album.album ? "active" : ""}`}
                      onClick={() => viewAlbum(album)}
                    >
                      {album.album || "Unknown Album"}
                      <span class="zune-filter-count">
                        {album.track_count || 0}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>

        {/* Center Content */}
        <div class="zune-center">
          <div class="zune-content-header">
            {/* <h1 class="zune-title">{getViewTitle()}</h1> */}
            <div class="zune-stats">
              <Show when={isSearchActive()}>
                <Show when={searchResults().length > 0}>
                  {searchResults().length} search results
                </Show>
                <Show when={searchResults().length === 0 && !loading()}>
                  no results found
                </Show>
              </Show>
              <Show when={!isSearchActive()}>
                <Show
                  when={
                    currentView() === "music" ||
                    currentPlaylist() ||
                    currentArtist() ||
                    currentAlbum()
                  }
                >
                  {getCurrentSongs().length} songs
                </Show>
                <Show
                  when={currentView() === "playlists" && !currentPlaylist()}
                >
                  {playlists().length} playlists
                </Show>
                <Show when={currentView() === "albums" && !currentAlbum()}>
                  {albums().length} albums
                </Show>
                <Show when={currentView() === "artists" && !currentArtist()}>
                  {artists().length} artists
                </Show>
              </Show>
            </div>
            <Show when={currentPlaylist()}>
              <button
                class="zune-play-all-btn"
                onClick={() => playPlaylist(currentPlaylist()!)}
              >
                <PlayIcon />
                play all
              </button>
            </Show>
            <Show when={currentArtist()}>
              <button
                class="zune-play-all-btn"
                onClick={() => playArtist(currentArtist()!)}
              >
                <PlayIcon />
                play all
              </button>
            </Show>
            <Show when={currentAlbum()}>
              <button
                class="zune-play-all-btn"
                onClick={() => playAlbum(currentAlbum()!)}
              >
                <PlayIcon />
                play all
              </button>
            </Show>
            <Show when={currentView() === "playlists" && !currentPlaylist()}>
              <button
                class="zune-play-all-btn"
                onClick={() => openCreatePlaylistModal()}
              >
                <AddIcon />
                create playlist
              </button>
            </Show>
          </div>

          <div class={`zune-content-area ${viewTransition()}`}>
            <Show when={loading()}>
              <div class="zune-loading">
                <div class="zune-loading-spinner"></div>
                <p>loading...</p>
              </div>
            </Show>

            <Show when={error()}>
              <div class="zune-error">
                <p>error: {error()}</p>
                <button onClick={() => fetchData(currentView())}>retry</button>
              </div>
            </Show>

            <Show when={!loading() && !error()}>
              {/* Songs Table */}
              <Show
                when={
                  currentView() === "music" ||
                  currentPlaylist() ||
                  currentArtist() ||
                  currentAlbum()
                }
              >
                {/* Grouped Suggestions Table - show first when searching */}
                <Show when={shouldShowSuggestions()}>
                  <div class="zune-suggestions-table">
                    <div class="zune-table-header">
                      <div class="zune-table-cell zune-table-cell--category">
                        category
                      </div>
                      <div class="zune-table-cell zune-table-cell--suggestion">
                        suggestion
                      </div>
                      <div class="zune-table-cell zune-table-cell--frequency">
                        matches
                      </div>
                      <div class="zune-table-cell zune-table-cell--actions"></div>
                    </div>
                    <For each={getGroupedSuggestions()}>
                      {([category, suggestions]) => (
                        <>
                          <div class="zune-suggestion-group-header">
                            <div class="zune-table-cell zune-table-cell--category">
                              {getCategoryDisplayName(category)}
                            </div>
                            <div class="zune-table-cell"></div>
                            <div class="zune-table-cell"></div>
                            <div class="zune-table-cell"></div>
                          </div>
                          <For each={suggestions}>
                            {(suggestion) => (
                              <div
                                class="zune-table-row zune-suggestion-row"
                                onClick={() =>
                                  handleSuggestionSelect(suggestion.text)
                                }
                              >
                                <div class="zune-table-cell zune-table-cell--category"></div>
                                <div class="zune-table-cell zune-table-cell--suggestion">
                                  {suggestion.text}
                                </div>
                                <div class="zune-table-cell zune-table-cell--frequency">
                                  {suggestion.frequency}
                                </div>
                                <div class="zune-table-cell zune-table-cell--actions">
                                  <button
                                    class="zune-action-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSuggestionSelect(suggestion.text);
                                    }}
                                    title="Search this"
                                  >
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="currentColor"
                                    >
                                      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            )}
                          </For>
                        </>
                      )}
                    </For>
                  </div>
                </Show>

                {/* Songs Table - show when we have songs to display */}
                <Show when={shouldShowSongsTable()}>
                  <div class="zune-songs-table">
                    <div class="zune-table-header">
                      <div class="zune-table-cell zune-table-cell--play"></div>
                      <div class="zune-table-cell zune-table-cell--title">
                        title
                      </div>
                      <div class="zune-table-cell zune-table-cell--artist">
                        artist
                      </div>
                      <div class="zune-table-cell zune-table-cell--album">
                        album
                      </div>
                      <div class="zune-table-cell zune-table-cell--duration">
                        time
                      </div>
                      <div class="zune-table-cell zune-table-cell--actions"></div>
                    </div>
                    <For each={getCurrentSongs()}>
                      {(song, index) => (
                        <div
                          class={`zune-table-row ${currentSong()?.id === song.id ? "playing" : ""}`}
                          onDblClick={() => playSong(song)}
                        >
                          <div class="zune-table-cell zune-table-cell--play">
                            <Show
                              when={
                                currentSong()?.id === song.id && isPlaying()
                              }
                              fallback={
                                <span class="zune-track-number">
                                  {index() + 1}
                                </span>
                              }
                            >
                              <div class="zune-playing-indicator">
                                <div class="zune-wave"></div>
                                <div class="zune-wave"></div>
                                <div class="zune-wave"></div>
                              </div>
                            </Show>
                          </div>
                          <div class="zune-table-cell zune-table-cell--title">
                            <div class="zune-song-title-cell">
                              <Show when={song.thumbnail_blob_id}>
                                <img
                                  src={`/api/blobs/${song.thumbnail_blob_id}`}
                                  alt={song.title}
                                  class="zune-song-thumbnail"
                                />
                              </Show>
                              <div class="zune-song-info">
                                <span class="zune-song-title">
                                  {song.title}
                                </span>
                                <Show when={song.is_favorite}>
                                  <span class="zune-favorite-indicator">
                                    ♥
                                  </span>
                                </Show>
                              </div>
                            </div>
                          </div>
                          <div class="zune-table-cell zune-table-cell--artist">
                            {song.artist || "Unknown Artist"}
                          </div>
                          <div class="zune-table-cell zune-table-cell--album">
                            {song.album || "Unknown Album"}
                          </div>
                          <div class="zune-table-cell zune-table-cell--duration">
                            {song.duration_seconds
                              ? formatTime(song.duration_seconds)
                              : "--:--"}
                          </div>
                          <div class="zune-table-cell zune-table-cell--actions">
                            <button
                              class="zune-action-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                addToQueue(song);
                              }}
                              title="Add to queue"
                            >
                              <QueueIcon />
                            </button>

                            <Show when={!currentPlaylist()}>
                              <div
                                class="zune-playlist-dropdown-container"
                                style={{
                                  position: "relative",
                                  overflow: "visible",
                                }}
                              >
                                <button
                                  class="zune-action-btn"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await ensurePlaylistsLoaded();
                                    setShowPlaylistDropdown(
                                      showPlaylistDropdown() === song.id
                                        ? null
                                        : song.id
                                    );
                                  }}
                                  title="Add to playlist"
                                >
                                  <AddIcon />
                                </button>
                                <Show when={showPlaylistDropdown() === song.id}>
                                  <div class="zune-playlist-dropdown">
                                    <button
                                      class="zune-dropdown-item"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openCreatePlaylistModal([song]);
                                        setShowPlaylistDropdown(null);
                                      }}
                                    >
                                      <AddIcon />
                                      Create New Playlist
                                    </button>
                                    <div class="zune-dropdown-divider"></div>
                                    <For each={playlists()}>
                                      {(playlist) => (
                                        <button
                                          class="zune-dropdown-item"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            addSongToExistingPlaylist(
                                              song,
                                              playlist
                                            );
                                          }}
                                        >
                                          {playlist.title}
                                          <span class="zune-playlist-count">
                                            {playlist.song_count || 0}
                                          </span>
                                        </button>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </div>
                            </Show>

                            <Show when={currentPlaylist()}>
                              <button
                                class="zune-action-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeSongFromPlaylist(
                                    currentPlaylist()!,
                                    song.id
                                  );
                                }}
                                title="Remove from playlist"
                              >
                                <DeleteIcon />
                              </button>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>

              {/* Artists Grid */}
              <Show when={currentView() === "artists" && !currentArtist()}>
                <div class="zune-grid">
                  <For each={artists()}>
                    {(artist) => (
                      <div
                        class="zune-grid-card"
                        onClick={() => viewArtist(artist)}
                        onDblClick={() => playArtist(artist)}
                      >
                        <div class="zune-grid-icon">
                          <MusicIcon />
                        </div>
                        <h3>{artist.artist}</h3>
                        <p>{artist.song_count} songs</p>
                        <p>{artist.album_count} albums</p>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Albums Grid */}
              <Show when={currentView() === "albums" && !currentAlbum()}>
                <div class="zune-grid">
                  <For each={albums()}>
                    {(album) => (
                      <div
                        class="zune-grid-card"
                        onClick={() => viewAlbum(album)}
                        onDblClick={() => playAlbum(album)}
                      >
                        <div class="zune-grid-icon">
                          <MusicIcon />
                        </div>
                        <h3>{album.album}</h3>
                        <p>{album.artist}</p>
                        <p>{album.track_count} tracks</p>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              {/* Playlists Grid */}
              <Show when={currentView() === "playlists" && !currentPlaylist()}>
                <div class="zune-grid">
                  <For each={playlists()}>
                    {(playlist) => (
                      <div
                        class="zune-grid-card"
                        onClick={() => viewPlaylist(playlist)}
                        onDblClick={() => playPlaylist(playlist)}
                      >
                        <div class="zune-grid-icon">
                          <QueueIcon />
                        </div>
                        <h3>{playlist.title}</h3>
                        <p>{playlist.song_count || 0} songs</p>
                        <Show when={playlist.description}>
                          <p class="zune-description">{playlist.description}</p>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>

        {/* Right Sidebar - Queue */}
        <Show when={showQueue()}>
          <div class="zune-queue">
            <div class="zune-queue-header">
              <h3>queue</h3>
              <div class="zune-queue-controls">
                <button onClick={clearQueue}>clear</button>
                <button onClick={() => setShowQueue(false)}>
                  <CloseIcon />
                </button>
              </div>
            </div>
            <div class="zune-queue-list">
              <For each={playQueue()}>
                {(item, index) => (
                  <div
                    class={`zune-queue-item ${index() === currentQueueIndex() ? "current" : ""}`}
                    onClick={() => {
                      setCurrentQueueIndex(index());
                      playSong(item.song, false);
                    }}
                  >
                    <div class="zune-queue-info">
                      <h4>{item.song.title}</h4>
                      <p>{item.song.artist}</p>
                    </div>
                    <button
                      class="zune-queue-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromQueue(item.id);
                      }}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                )}
              </For>
              <Show when={playQueue().length === 0}>
                <div class="zune-queue-empty">queue is empty</div>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      {/* Player */}
      <Show when={currentSong()}>
        <div class="zune-player">
          <div class="zune-player-info">
            <div class="zune-player-artwork">
              <Show
                when={currentSong()?.thumbnail_blob_id}
                fallback={
                  <div class="zune-artwork-placeholder small">
                    <MusicIcon />
                  </div>
                }
              >
                <img
                  src={`/api/blobs/${currentSong()?.thumbnail_blob_id}`}
                  alt={currentSong()?.title}
                  class="zune-artwork-image small"
                />
              </Show>
            </div>
            <div class="zune-player-text">
              <h4 class="zune-player-title">{currentSong()?.title}</h4>
              <p class="zune-player-artist">{currentSong()?.artist}</p>
            </div>
          </div>

          <div class="zune-player-controls">
            <button
              class="zune-control-btn"
              onClick={playPrevious}
              disabled={currentQueueIndex() === 0}
            >
              <PrevIcon />
            </button>
            <button class="zune-control-btn primary" onClick={togglePlayback}>
              {isPlaying() ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button
              class="zune-control-btn"
              onClick={playNext}
              disabled={currentQueueIndex() >= playQueue().length - 1}
            >
              <NextIcon />
            </button>
            <button
              class="zune-control-btn"
              onClick={() => setShowQueue(!showQueue())}
              title="Show Queue"
            >
              <QueueIcon />
            </button>
          </div>

          <div class="zune-player-progress">
            <span class="zune-time">{formatTime(currentTime())}</span>
            <div
              class="zune-progress-bar"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const percentage = ((e.clientX - rect.left) / rect.width) * 100;
                seekTo(percentage);
              }}
            >
              <div
                class="zune-progress-fill"
                style={{
                  width: `${duration() > 0 ? (currentTime() / duration()) * 100 : 0}%`,
                }}
              ></div>
            </div>
            <span class="zune-time">{formatTime(duration())}</span>
          </div>

          <div class="zune-player-volume">
            <VolumeIcon />
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume()}
              onInput={(e) => {
                const newVolume = parseFloat(e.currentTarget.value);
                setVolume(newVolume);
                const audio = audioElement();
                if (audio) audio.volume = newVolume;
              }}
              class="zune-volume-slider"
            />
          </div>
        </div>
      </Show>

      {/* Click outside handler to close dropdown */}
      <Show when={showPlaylistDropdown()}>
        <div
          class="zune-dropdown-backdrop"
          onClick={() => setShowPlaylistDropdown(null)}
        />
      </Show>

      {/* Playlist Management Modal */}
      <Show when={showPlaylistModal()}>
        <div class="zune-modal-overlay" onClick={closePlaylistModal}>
          <div class="zune-modal" onClick={(e) => e.stopPropagation()}>
            <div class="zune-modal-header">
              <h3>
                {playlistModalMode() === "create"
                  ? "Create Playlist"
                  : playlistModalMode() === "edit"
                    ? "Edit Playlist"
                    : "Add to Playlist"}
              </h3>
              <button class="zune-modal-close" onClick={closePlaylistModal}>
                <CloseIcon />
              </button>
            </div>
            <div class="zune-modal-content">
              <Show when={playlistModalMode() !== "add-songs"}>
                <div class="zune-form-group">
                  <label>Title</label>
                  <input
                    type="text"
                    value={playlistForm().title}
                    onInput={(e) =>
                      setPlaylistForm({
                        ...playlistForm(),
                        title: e.currentTarget.value,
                      })
                    }
                    placeholder="Enter playlist title"
                    class="zune-input"
                  />
                </div>
                <div class="zune-form-group">
                  <label>Description (optional)</label>
                  <textarea
                    value={playlistForm().description}
                    onInput={(e) =>
                      setPlaylistForm({
                        ...playlistForm(),
                        description: e.currentTarget.value,
                      })
                    }
                    placeholder="Enter playlist description"
                    class="zune-textarea"
                    rows="3"
                  />
                </div>
                <div class="zune-form-group">
                  <label class="zune-checkbox-label">
                    <input
                      type="checkbox"
                      checked={playlistForm().is_public}
                      onChange={(e) =>
                        setPlaylistForm({
                          ...playlistForm(),
                          is_public: e.currentTarget.checked,
                        })
                      }
                    />
                    Make public
                  </label>
                </div>
              </Show>
              <Show when={selectedSongs().length > 0}>
                <div class="zune-form-group">
                  <label>
                    {playlistModalMode() === "add-songs"
                      ? "Adding"
                      : "Songs to add"}{" "}
                    ({selectedSongs().length})
                  </label>
                  <div class="zune-selected-songs">
                    <For each={selectedSongs()}>
                      {(song) => (
                        <div class="zune-selected-song">
                          <span class="zune-song-title">{song.title}</span>
                          <span class="zune-song-artist">
                            {song.artist || "Unknown Artist"}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
            <div class="zune-modal-actions">
              <button class="zune-btn-secondary" onClick={closePlaylistModal}>
                Cancel
              </button>
              <Show when={playlistModalMode() === "create"}>
                <button
                  class="zune-btn-primary"
                  onClick={createPlaylist}
                  disabled={!playlistForm().title.trim()}
                >
                  Create
                </button>
              </Show>
              <Show when={playlistModalMode() === "edit"}>
                <button
                  class="zune-btn-primary"
                  onClick={updatePlaylist}
                  disabled={!playlistForm().title.trim()}
                >
                  Save
                </button>
              </Show>
              <Show when={playlistModalMode() === "add-songs"}>
                <button class="zune-btn-primary" onClick={addSongsToPlaylist}>
                  Add Songs
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

        .zune-demo {
          min-height: 100vh;
          background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
          color: #ffffff;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-weight: 300;
          letter-spacing: 0.3px;

          display: flex;
          flex-direction: column;
        }

        /* Header */
        .zune-header {
          background: rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(20px);
          padding: 1.5rem 2rem;
          position: sticky;
          top: 0px;
          z-index: 1;
        }

        .zune-branding {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1.5rem;
        }

        .zune-logo {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .zune-logo-square {
          width: 28px;
          height: 28px;
          background: linear-gradient(135deg, #ff0080 0%, #ff4081 100%);
          border-radius: 2px;
        }

        .zune-logo-text {
          font-size: 1.5rem;
          font-weight: 300;
          color: #ffffff;
          text-transform: lowercase;
        }

        .zune-search-container {
          flex: 1;
          max-width: 400px;
          margin-left: 3rem;
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .zune-search-box {
          flex: 1;
        }

        .zune-search-clear {
          background: rgba(255, 255, 255, 0.1);
          border: none;
          color: rgba(255, 255, 255, 0.6);
          cursor: pointer;
          padding: 0.5rem;
          border-radius: 4px;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .zune-search-clear:hover {
          background: #ff0080;
          color: #ffffff;
        }

        /* Dark theme overrides for SearchBox */
        .zune-search-box .search-box__input {
          width: 100%;
          padding: 0.75rem 1rem;
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
          font-size: 1rem;
          font-weight: 300;
          transition: all 0.3s ease;
        }

        .zune-search-box .search-box__input:focus {
          border-color: #ff0080;
          box-shadow: 0 0 0 2px rgba(255, 0, 128, 0.2);
        }

        .zune-search-box .search-box__input::placeholder {
          color: rgba(255, 255, 255, 0.5);
        }

        /* Navigation */
        .zune-nav {
          display: flex;
          gap: 0.5rem;
          overflow-x: auto;
          scrollbar-width: none;
        }

        .zune-nav::-webkit-scrollbar {
          display: none;
        }

        .zune-nav-item {
          padding: 1rem 2rem;
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.6);
          font-size: 1.1rem;
          font-weight: 400;
          cursor: pointer;
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          text-transform: lowercase;
          white-space: nowrap;
          position: relative;
          overflow: hidden;
        }

        .zune-nav-item::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
          transition: left 0.6s ease;
        }

        .zune-nav-item:hover::before {
          left: 100%;
        }

        .zune-nav-item:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.05);
        }

        .zune-nav-item.active {
          color: #ff0080;
          background: rgba(255, 0, 128, 0.1);
          font-weight: 500;
        }

        /* Main Layout */
        .zune-main {
          display: flex;
          flex: 1;
          min-height: 0;
        }

        .zune-sidebar, .zune-center {
          height: calc(100dvh - 124px);
          padding: 2rem 2rem 86px 2rem;
        }

        /* Sidebar */
        .zune-sidebar {
          width: 300px;
          background: rgba(0, 0, 0, 0.2);
          overflow-y: auto;
          scrollbar-width: thin;
          min-height: 0;
        }

        .zune-filter-section h3 {
          margin: 0 0 1rem 0;
          font-size: 1.2rem;
          font-weight: 500;
          color: #ffffff;
          text-transform: lowercase;
        }

        .zune-filter-list {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .zune-filter-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          padding: 0.75rem 1rem;
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.7);
          font-size: 0.9rem;
          font-weight: 300;
          text-align: left;
          cursor: pointer;
          transition: all 0.3s ease;
          border-radius: 4px;
          text-transform: lowercase;
        }

        .zune-filter-item:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        .zune-filter-item.active {
          background: rgba(255, 0, 128, 0.2);
          color: #ff0080;
        }

        .zune-filter-count {
          font-size: 0.8rem;
          opacity: 0.7;
        }

        /* Center Content */
        .zune-center {
          flex: 1;
          overflow-y: auto;
          display: flex;
          min-height: 0;
          flex-direction: column;
        }

        .zune-content-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2rem;
          flex-shrink: 0;
        }

        .zune-title {
          font-size: 3rem;
          font-weight: 300;
          margin: 0;
          color: #ffffff;
          text-transform: lowercase;
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .zune-stats {
          color: rgba(255, 255, 255, 0.6);
          font-size: 1rem;
          font-weight: 300;
        }

        .zune-play-all-btn {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          background: linear-gradient(135deg, #ff0080 0%, #ff4081 100%);
          border: none;
          color: #ffffff;
          font-size: 0.9rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s ease;
          border-radius: 4px;
          text-transform: lowercase;
        }

        .zune-play-all-btn:hover {
          background: linear-gradient(135deg, #ff1a8a 0%, #ff5a8a 100%);
        }

        .zune-content-area {
          flex: 1;
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          overflow-y: auto;
        }

        .zune-content-area.exiting {
          opacity: 0;
          transform: translateX(-30px);
        }

        .zune-content-area.entering {
          opacity: 0;
          transform: translateX(30px);
        }

        /* Loading & Error States */
        .zune-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          padding: 3rem;
          color: rgba(255, 255, 255, 0.6);
        }

        .zune-loading-spinner {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(255, 255, 255, 0.1);
          border-top: 3px solid #ff0080;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .zune-error {
          text-align: center;
          padding: 3rem;
          color: #ff6b6b;
        }

        .zune-error button {
          margin-top: 1rem;
          padding: 0.75rem 1.5rem;
          background: #ff0080;
          border: none;
          color: white;
          border-radius: 4px;
          cursor: pointer;
        }

        /* Songs Table */
        .zune-songs-table,
        .zune-suggestions-table {
          display: flex;
          flex-direction: column;
          background: rgba(255, 255, 255, 0.02);
          border-radius: 8px;
        }

        .zune-table-header {
          display: grid;
          grid-template-columns: 60px 1fr 200px 200px 80px 60px;
          padding: 1rem;
          background: rgba(255, 255, 255, 0.05);
          font-size: 0.8rem;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.7);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          position: sticky;
          top: 0;
          background: rgba(0, 0, 0, 0.9);
          z-index: 1;
        }

        .zune-suggestions-table .zune-table-header {
          grid-template-columns: 150px 1fr 100px 60px;
        }

        .zune-table-row {
          display: grid;
          grid-template-columns: 60px 1fr 200px 200px 80px 60px;
          padding: 1rem;
          cursor: pointer;
          transition: background 0.3s ease;
          align-items: center;
        }

        .zune-suggestions-table .zune-table-row {
          grid-template-columns: 150px 1fr 100px 60px;
        }

        .zune-suggestion-group-header {
          display: grid;
          grid-template-columns: 150px 1fr 100px 60px;
          padding: 0.75rem 1rem;
          background: rgba(255, 0, 128, 0.1);
          font-weight: 500;
          color: #ff0080;
          text-transform: lowercase;
        }

        .zune-suggestion-row:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .zune-table-row:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .zune-table-row.playing {
          background: rgba(255, 0, 128, 0.1);
        }

        .zune-table-cell {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 0.9rem;
        }

        .zune-track-number {
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.8rem;
          text-align: center;
        }

        .zune-playing-indicator {
          display: flex;
          gap: 2px;
          align-items: center;
          justify-content: center;
        }

        .zune-wave {
          width: 3px;
          height: 12px;
          background: #ff0080;
          border-radius: 1px;
          animation: wave 1s infinite ease-in-out;
        }

        .zune-wave:nth-child(2) {
          animation-delay: 0.2s;
        }

        .zune-wave:nth-child(3) {
          animation-delay: 0.4s;
        }

        @keyframes wave {
          0%, 100% { height: 6px; }
          50% { height: 12px; }
        }

        .zune-song-title-cell {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .zune-song-thumbnail {
          width: 40px;
          height: 40px;
          border-radius: 4px;
          object-fit: cover;
        }

        .zune-song-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          overflow: hidden;
        }

        .zune-song-title {
          font-weight: 500;
          color: #ffffff;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .zune-favorite-indicator {
          color: #ff0080;
          font-size: 0.8rem;
        }

        .zune-action-btn {
          width: 32px;
          height: 32px;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          color: rgba(255, 255, 255, 0.7);
          border-radius: 50%;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .zune-action-btn:hover {
          background: #ff0080;
          color: #ffffff;
        }

        /* Grid Layout */
        .zune-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1.5rem;
        }

        .zune-grid-card {
          background: rgba(255, 255, 255, 0.05);
          padding: 1.5rem;
          cursor: pointer;
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          border-radius: 8px;
          text-align: center;
        }

        .zune-grid-card:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: translateY(-4px);
        }

        .zune-grid-icon {
          color: #ff0080;
          margin-bottom: 1rem;
          display: flex;
          justify-content: center;
        }

        .zune-grid-card h3 {
          font-size: 1.1rem;
          font-weight: 500;
          margin: 0 0 0.5rem 0;
          color: #ffffff;
        }

        .zune-grid-card p {
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.7);
          margin: 0 0 0.25rem 0;
        }

        .zune-description {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.5);
          font-style: italic;
        }

        /* Queue Panel */
        .zune-queue {
          width: 350px;
          background: rgba(0, 0, 0, 0.3);
          display: flex;
          flex-direction: column;
          animation: slideInRight 0.3s ease;
        }

        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }

        .zune-queue-header {
          padding: 1.5rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(0, 0, 0, 0.2);
        }

        .zune-queue-header h3 {
          margin: 0;
          color: #ffffff;
          font-size: 1.1rem;
          font-weight: 500;
          text-transform: lowercase;
        }

        .zune-queue-controls {
          display: flex;
          gap: 0.5rem;
        }

        .zune-queue-controls button {
          background: rgba(255, 255, 255, 0.1);
          border: none;
          color: #ffffff;
          padding: 0.5rem;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.8rem;
          transition: background 0.3s ease;
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .zune-queue-controls button:hover {
          background: #ff0080;
        }

        .zune-queue-list {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
        }

        .zune-queue-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.75rem;
          cursor: pointer;
          transition: background 0.3s ease;
          border-radius: 4px;
          margin-bottom: 0.5rem;
        }

        .zune-queue-item:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .zune-queue-item.current {
          background: rgba(255, 0, 128, 0.2);
        }

        .zune-queue-info h4 {
          margin: 0;
          font-size: 0.9rem;
          font-weight: 500;
          color: #ffffff;
        }

        .zune-queue-info p {
          margin: 0.25rem 0 0 0;
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.7);
        }

        .zune-queue-remove {
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.5);
          cursor: pointer;
          padding: 0.25rem;
          transition: color 0.3s ease;
          display: flex;
          align-items: center;
        }

        .zune-queue-remove:hover {
          color: #ff0080;
        }

        .zune-queue-empty {
          text-align: center;
          padding: 2rem;
          color: rgba(255, 255, 255, 0.5);
        }

        /* Player */
        .zune-player {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(20px);
          padding: 1rem 2rem;
          display: flex;
          align-items: center;
          gap: 2rem;
          z-index: 1000;
          animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }

        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .zune-player-info {
          display: flex;
          align-items: center;
          gap: 1rem;
          min-width: 250px;
          width: 100%;
        }

        .zune-artwork-placeholder {
          width: 50px;
          height: 50px;
          background: linear-gradient(135deg, #333 0%, #555 100%);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: rgba(255, 255, 255, 0.3);
        }

        .zune-artwork-image {
          width: 50px;
          height: 50px;
          border-radius: 4px;
          object-fit: cover;
        }

        .zune-player-text {
          flex: 1;
        }

        .zune-player-title {
          font-size: 1rem;
          font-weight: 500;
          margin: 0;
          color: #ffffff;
        }

        .zune-player-artist {
          font-size: 0.9rem;
          font-weight: 300;
          margin: 0;
          color: rgba(255, 255, 255, 0.7);
        }

        .zune-player-controls {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .zune-control-btn {
          width: 44px;
          height: 44px;
          border: none;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .zune-control-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          transform: scale(1.1);
        }

        .zune-control-btn.primary {
          background: linear-gradient(135deg, #ff0080 0%, #ff4081 100%);
          width: 52px;
          height: 52px;
        }

        .zune-control-btn.primary:hover {
          background: linear-gradient(135deg, #ff1a8a 0%, #ff5a8a 100%);
        }

        .zune-control-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          transform: none;
        }

        .zune-player-progress {
          display: flex;
          align-items: center;
          gap: 1rem;
          flex: 1;
          max-width: 400px;
        }

        .zune-time {
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 300;
          min-width: 40px;
        }

        .zune-progress-bar {
          flex: 1;
          height: 6px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
          overflow: hidden;
          cursor: pointer;
          transition: height 0.2s ease;
          min-width: 100px;
        }

        .zune-progress-bar:hover {
          height: 8px;
        }

        .zune-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #ff0080 0%, #ff4081 100%);
          transition: width 0.1s ease;
        }

        .zune-player-volume {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .zune-volume-slider {
          width: 100px;
          height: 4px;
          background: rgba(255, 255, 255, 0.2);
          border: none;
          border-radius: 2px;
          outline: none;
          appearance: none;
          cursor: pointer;
        }

        .zune-volume-slider::-webkit-slider-thumb {
          width: 16px;
          height: 16px;
          background: #ff0080;
          border: none;
          border-radius: 50%;
          cursor: pointer;
        }

        .zune-volume-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: #ff0080;
          border: none;
          border-radius: 50%;
          cursor: pointer;
        }

        /* Scrollbar styling */
        .zune-sidebar::-webkit-scrollbar,
        .zune-center::-webkit-scrollbar,
        .zune-queue-list::-webkit-scrollbar {
          width: 8px;
        }

        .zune-sidebar::-webkit-scrollbar-track,
        .zune-center::-webkit-scrollbar-track,
        .zune-queue-list::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.1);
        }

        .zune-sidebar::-webkit-scrollbar-thumb,
        .zune-center::-webkit-scrollbar-thumb,
        .zune-queue-list::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.3);
          border-radius: 4px;
        }

        /* Responsive Design */
        @media (max-width: 768px) {
          .zune-header {
            padding: 1rem;
          }

          .zune-branding {
            flex-direction: column;
            gap: 1rem;
            margin-bottom: 1rem;
          }

          .zune-search-container {
            margin-left: 0;
            max-width: 100%;
          }

          .zune-nav {
            justify-content: space-between;
          }

          .zune-nav-item {
            padding: 0.75rem 1rem;
            font-size: 1rem;
          }

          .zune-main {
            flex-direction: column;
            height: auto;
          }

          .zune-sidebar {
            width: 100%;
            padding: 1rem;
          }

          .zune-center {
            padding: 1rem;
          }

          .zune-title {
            font-size: 2rem;
          }

          .zune-table-header,
          .zune-table-row {
            grid-template-columns: 50px 1fr 60px;
          }

          .zune-table-cell--artist,
          .zune-table-cell--album,
          .zune-table-cell--duration {
            display: none;
          }

          .zune-grid {
            grid-template-columns: 1fr;
          }

          .zune-queue {
            width: 100%;
            height: 50vh;
          }

          .zune-player {
            padding: 1rem;
            flex-direction: column;
            gap: 1rem;
          }

          .zune-player-info {
            min-width: auto;
          }

          .zune-player-progress {
            max-width: 100%;
          }
        }

        /* Modal Styles */
        .zune-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: fadeIn 0.2s ease;
        }

        .zune-modal {
          background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
          border-radius: 12px;
          padding: 0;
          max-width: 500px;
          width: 90%;
          max-height: 80vh;
          overflow: hidden;
          animation: slideUp 0.3s ease;
        }

        .zune-modal-header {
          padding: 1.5rem;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .zune-modal-header h3 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 600;
          color: #ffffff;
        }

        .zune-modal-close {
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          padding: 8px;
          border-radius: 6px;
          transition: all 0.2s ease;
        }

        .zune-modal-close:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        .zune-modal-content {
          padding: 1.5rem;
          max-height: 50vh;
          overflow-y: auto;
        }

        .zune-modal-actions {
          padding: 1rem 1.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          display: flex;
          gap: 0.75rem;
          justify-content: flex-end;
        }

        .zune-form-group {
          margin-bottom: 1.5rem;
        }

        .zune-form-group label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 500;
          color: #ffffff;
          font-size: 0.9rem;
        }

        .zune-input, .zune-textarea {
          width: 100%;
          padding: 0.75rem;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          color: #ffffff;
          font-size: 0.9rem;
          transition: all 0.2s ease;
        }

        .zune-input:focus, .zune-textarea:focus {
          outline: none;
          border-color: #ff0080;
          box-shadow: 0 0 0 2px rgba(255, 0, 128, 0.2);
        }

        .zune-checkbox-label {
          display: flex !important;
          align-items: center;
          gap: 0.5rem;
          cursor: pointer;
        }

        .zune-checkbox-label input[type="checkbox"] {
          width: auto;
          margin: 0;
        }

        .zune-selected-songs {
          max-height: 150px;
          overflow-y: auto;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 6px;
          padding: 0.75rem;
        }

        .zune-selected-song {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5rem 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .zune-selected-song:last-child {
          border-bottom: none;
        }

        .zune-song-title {
          font-weight: 500;
          color: #ffffff;
          font-size: 0.9rem;
        }

        .zune-song-artist {
          color: rgba(255, 255, 255, 0.7);
          font-size: 0.8rem;
        }

        .zune-btn-primary, .zune-btn-secondary {
          padding: 0.75rem 1.5rem;
          border-radius: 6px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          border: none;
          font-size: 0.9rem;
        }

        .zune-btn-primary {
          background: linear-gradient(135deg, #ff0080 0%, #ff4081 100%);
          color: #ffffff;
        }

        .zune-btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(255, 0, 128, 0.3);
        }

        .zune-btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .zune-btn-secondary {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
        }

        .zune-btn-secondary:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .zune-filter-item-container {
          position: relative;
          display: flex;
          align-items: center;
        }

        .zune-filter-item-container .zune-filter-item {
          flex: 1;
        }

        .zune-filter-actions {
          display: none;
          gap: 0.25rem;
          padding-left: 0.5rem;
        }

        .zune-filter-item-container:hover .zune-filter-actions {
          display: flex;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(30px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        /* Playlist Dropdown Styles */
        .zune-playlist-dropdown-container {
          position: relative;
          display: inline-block;
        }

        .zune-playlist-dropdown {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 0.5rem 0;
          z-index: 1000;
          min-width: 220px;
          max-width: 300px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(10px);
          animation: fadeIn 0.2s ease;
          white-space: nowrap;
        }

        .zune-dropdown-item {
          width: 100%;
          padding: 0.75rem 1rem;
          background: none;
          border: none;
          color: #ffffff;
          cursor: pointer;
          text-align: left;
          transition: background-color 0.2s ease;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
        }

        .zune-dropdown-item:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .zune-dropdown-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
          margin: 0.5rem 0;
        }

        .zune-playlist-count {
          margin-left: auto;
          color: rgba(255, 255, 255, 0.6);
          font-size: 0.8rem;
        }

        .zune-dropdown-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 900;
        }

        .zune-table-cell--actions {
          overflow: visible !important;
          display: flex;
          gap: 8px;
        }
      `}</style>
    </div>
  );
}

function ZuneDemo(props: ZuneDemoProps) {
  const apiClient = createApiClient(
    props.apiBaseUrl || "http://localhost:8080"
  );

  return (
    <SearchProvider
      apiClient={apiClient}
      searchOptions={{
        enableSuggestions: true,
        enableHistory: false,
        autoSearch: false,
        integrationMode: "standalone",
      }}
    >
      <ZuneDemoContent />
    </SearchProvider>
  );
}

class ZuneDemoElement extends HTMLElement {
  private dispose: (() => void) | null = null;

  connectedCallback() {
    const apiBaseUrl =
      this.getAttribute("api-base-url") || "http://localhost:8080";
    const autoConnect = this.getAttribute("auto-connect") === "true";

    this.dispose = render(
      () => <ZuneDemo apiBaseUrl={apiBaseUrl} autoConnect={autoConnect} />,
      this
    );
  }

  disconnectedCallback() {
    if (this.dispose) {
      this.dispose();
    }
  }
}

customElements.define("zune-demo", ZuneDemoElement);

export { ZuneDemo, ZuneDemoElement };
export default ZuneDemo;

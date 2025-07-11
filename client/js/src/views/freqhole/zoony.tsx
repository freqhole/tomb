/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import { createSignal, Show, For, onMount, onCleanup } from "solid-js";
import {
  SearchProvider,
  useSearchContext,
} from "../../components/search/SearchContext.js";

import { apiClient } from "../../lib/api-client.js";
import type {
  Song,
  Album,
  ArtistSummary,
  Playlist,
  PlaylistSong,
  QueueItem,
} from "../../lib/music/types.js";
import { Header } from "./components/header";
import { Player } from "./components/player";
import { FreqholeProvider, useFreqhole } from "./context/FreqholeContext";
import {
  AddIcon,
  CloseIcon,
  EditIcon,
  DeleteIcon,
  QueueIcon,
  PlayIcon,
  MusicIcon,
} from "./components/icons";

interface ZoonyProps {
  /** API base URL */
  apiBaseUrl?: string;
  /** Auto-connect to API */
  autoConnect?: boolean;
}

// Using Song interface from API schema

// Using ArtistSummary interface from API schema

// Using Playlist interface from API schema

// Using Album interface from API schema

// Remove unused ApiClient constructor

// SVG Icons are now imported from centralized icons file

function ZoonyContent() {
  const context = useSearchContext();
  const freqhole = useFreqhole();

  // Use the new context-based state
  const { music, player, view } = freqhole;

  // Local state for compatibility with existing UI
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<Song[]>([]);
  const [isSearchActive, setIsSearchActive] = createSignal(false);

  // Initialize on mount
  onMount(async () => {
    await freqhole.actions.initialize();
  });

  onCleanup(() => {
    freqhole.actions.cleanup();
  });

  // Use the context-based actions
  const viewPlaylist = (playlist: Playlist) =>
    music.actions.viewPlaylist(playlist);
  const viewArtist = (artist: ArtistSummary) =>
    music.actions.viewArtist(artist);
  const viewAlbum = (album: Album) => music.actions.viewAlbum(album);
  const playPlaylist = (playlist: Playlist) =>
    freqhole.actions.playPlaylistAndView(playlist);
  const playArtist = (artist: ArtistSummary) =>
    freqhole.actions.playArtistAndView(artist);
  const playAlbum = (album: Album) => freqhole.actions.playAlbumAndView(album);
  const playSong = (song: Song) => freqhole.actions.playAndQueue(song);

  // Playlist Management Functions - use context-based actions
  const openCreatePlaylistModal = (songsToAdd?: Song[]) => {
    view.actions.openCreatePlaylistModal(songsToAdd || []);
  };

  const openEditPlaylistModal = (playlist: Playlist) => {
    view.actions.openEditPlaylistModal(playlist);
  };

  const closePlaylistModal = () => {
    view.actions.closePlaylistModal();
  };

  const createPlaylist = async () => {
    await freqhole.actions.createPlaylistWithModal();
  };

  const updatePlaylist = async () => {
    await freqhole.actions.updatePlaylistWithModal();
  };

  const addSongsToPlaylist = async () => {
    await freqhole.actions.addSongsToPlaylistWithModal();
  };

  const removeSongFromPlaylist = async (playlist: Playlist, songId: string) => {
    await music.actions.removeSongFromPlaylist(playlist.id, songId);
  };

  const addSongToExistingPlaylist = async (song: Song, playlist: Playlist) => {
    await music.actions.addSongsToPlaylist(playlist.id, [song]);
    view.actions.closePlaylistDropdown();
  };

  const deletePlaylist = async (playlist: Playlist) => {
    await music.actions.deletePlaylist(playlist.id);
  };

  // Data filtering - use context-based data
  const getFilteredSongs = () => {
    // If we're in search mode and have search results, use those
    if (isSearchActive() && searchResults().length > 0) {
      return searchResults();
    }

    let filtered = music.state.songs();

    if (music.state.selectedArtist()) {
      filtered = filtered.filter(
        (song) => song.artist === music.state.selectedArtist()
      );
    }

    if (music.state.selectedAlbum()) {
      filtered = filtered.filter(
        (song) => song.album === music.state.selectedAlbum()
      );
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
    music.actions.changeView("music");
    performSearch(suggestion);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    context.state.setQuery(query);
    music.actions.changeView("music");
    if (query.trim()) {
      performSearch(query);
    } else {
      setIsSearchActive(false);
      setSearchResults([]);
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setIsSearchActive(false);
    setSearchResults([]);
    context.state.setQuery("");
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

  // Data helper functions
  const getCurrentSongs = () => {
    // If viewing a specific playlist, artist, or album, show those songs
    if (music.state.currentPlaylist()) {
      return music.state.playlistSongs().map((ps) => ps.song);
    }
    if (music.state.currentArtist()) {
      return music.state.artistSongs();
    }
    if (music.state.currentAlbum()) {
      return music.state.albumSongs();
    }
    // Otherwise show filtered songs
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
      <Header
        currentView={music.state.currentView()}
        onViewChange={music.actions.changeView}
        searchQuery={searchQuery()}
        onSearchQueryChange={(query) => {
          setSearchQuery(query);
          if (!query.trim()) {
            setIsSearchActive(false);
            setSearchResults([]);
          } else {
            performSearch(query);
          }
        }}
        onSearch={handleSearch}
        onClearSearch={clearSearch}
        searchContext={context}
      />

      {/* Main Content */}
      <div class="zune-main">
        {/* Left Sidebar */}
        <div class="zune-sidebar">
          <Show when={music.state.currentView() === "playlists"}>
            <div class="zune-filter-sidebar">
              <h3>playlists</h3>
              <div class="zune-filter-list">
                <For each={music.state.playlists()}>
                  {(playlist) => (
                    <div class="zune-filter-item-container">
                      <button
                        class={`zune-filter-item ${music.state.currentPlaylist()?.id === playlist.id ? "active" : ""}`}
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

          <Show when={music.state.currentView() === "artists"}>
            <div class="zune-filter-sidebar">
              <div class="zune-filter-list">
                <For each={music.state.artists()}>
                  {(artist) => (
                    <button
                      class={`zune-filter-item ${music.state.currentArtist()?.artist === artist.artist ? "active" : ""}`}
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

          <Show when={music.state.currentView() === "albums"}>
            <div class="zune-filter-sidebar">
              <div class="zune-filter-list">
                <For each={music.state.albums()}>
                  {(album) => (
                    <button
                      class={`zune-filter-item ${music.state.currentAlbum()?.album === album.album ? "active" : ""}`}
                      onClick={() => viewAlbum(album)}
                    >
                      {album.album}
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
            <Show when={music.state.currentPlaylist()}>
              <button
                class="zune-play-all-btn"
                onClick={() => playPlaylist(music.state.currentPlaylist()!)}
              >
                <PlayIcon />
                play all
              </button>
            </Show>
            <Show when={music.state.currentArtist()}>
              <button
                class="zune-play-all-btn"
                onClick={() => playArtist(music.state.currentArtist()!)}
              >
                <PlayIcon />
                play all
              </button>
            </Show>
            <Show when={music.state.currentAlbum()}>
              <button
                class="zune-play-all-btn"
                onClick={() => playAlbum(music.state.currentAlbum()!)}
              >
                <PlayIcon />
                play all
              </button>
            </Show>
            <Show
              when={
                music.state.currentView() === "playlists" &&
                !music.state.currentPlaylist()
              }
            >
              <button
                class="zune-play-all-btn"
                onClick={() => openCreatePlaylistModal()}
              >
                <AddIcon />
                <span>Create Playlist</span>
              </button>
            </Show>
          </div>

          <div class={`zune-content-area ${view.state.viewTransition()}`}>
            <Show when={freqhole.isLoading()}>
              <div class="zune-loading">
                <div class="zune-loading-spinner"></div>
                <p>Loading...</p>
              </div>
            </Show>

            <Show when={freqhole.getError()}>
              <div class="zune-error">
                <p>Error: {freqhole.getError()}</p>
                <button
                  onClick={() =>
                    music.actions.fetchData(music.state.currentView())
                  }
                >
                  Try Again
                </button>
              </div>
            </Show>

            <Show when={!freqhole.isLoading() && !freqhole.getError()}>
              {/* Music Table */}
              <Show
                when={
                  (music.state.currentView() === "music" &&
                    !music.state.currentArtist() &&
                    !music.state.currentAlbum() &&
                    !music.state.currentPlaylist()) ||
                  music.state.currentPlaylist() ||
                  music.state.currentArtist() ||
                  music.state.currentAlbum()
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
                          class={`zune-table-row ${player.currentSong()?.id === song.id ? "playing" : ""}`}
                          onDblClick={() => playSong(song)}
                        >
                          <div class="zune-table-cell zune-table-cell--play">
                            <Show
                              when={
                                player.currentSong()?.id === song.id &&
                                player.isPlaying()
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
                                  src={`${apiClient.getBaseUrl()}/api/blobs/${song.thumbnail_blob_id}`}
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
                              ? player.formatTime(song.duration_seconds)
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
                                    await music.actions.ensurePlaylistsLoaded();
                                    view.actions.setShowPlaylistDropdown(
                                      view.state.showPlaylistDropdown() ===
                                        song.id
                                        ? null
                                        : song.id
                                    );
                                  }}
                                  title="Add to playlist"
                                >
                                  <AddIcon />
                                </button>
                                <Show
                                  when={
                                    view.state.showPlaylistDropdown() ===
                                    song.id
                                  }
                                >
                                  <div class="zune-playlist-dropdown">
                                    <button
                                      class="zune-dropdown-item"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openCreatePlaylistModal([song]);
                                        view.actions.setShowPlaylistDropdown(
                                          null
                                        );
                                      }}
                                    >
                                      <AddIcon />
                                      Create New Playlist
                                    </button>
                                    <div class="zune-dropdown-divider"></div>
                                    <For each={music.state.playlists()}>
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

                            <Show when={music.state.currentPlaylist()}>
                              <button
                                class="zune-action-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeSongFromPlaylist(
                                    music.state.currentPlaylist()!,
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
              <Show
                when={
                  music.state.currentView() === "artists" &&
                  !music.state.currentArtist()
                }
              >
                <div class="zune-grid">
                  <For each={music.state.artists()}>
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
              <Show
                when={
                  music.state.currentView() === "albums" &&
                  !music.state.currentAlbum()
                }
              >
                <div class="zune-grid">
                  <For each={music.state.albums()}>
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
              <Show
                when={
                  music.state.currentView() === "playlists" &&
                  !music.state.currentPlaylist()
                }
              >
                <div class="zune-grid">
                  <For each={music.state.playlists()}>
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
      <Player />

      {/* Click outside handler to close dropdown */}
      <Show when={view.state.showPlaylistDropdown()}>
        <div
          class="zune-dropdown-backdrop"
          onClick={() => view.actions.setShowPlaylistDropdown(null)}
        />
      </Show>

      {/* Playlist Management Modal */}
      <Show when={view.state.showPlaylistModal()}>
        <div class="zune-modal-overlay" onClick={closePlaylistModal}>
          <div class="zune-modal" onClick={(e) => e.stopPropagation()}>
            <div class="zune-modal-header">
              <h3>
                {view.state.playlistModalMode() === "create"
                  ? "Create Playlist"
                  : view.state.playlistModalMode() === "edit"
                    ? "Edit Playlist"
                    : "Add to Playlist"}
              </h3>
              <button class="zune-modal-close" onClick={closePlaylistModal}>
                <CloseIcon />
              </button>
            </div>
            <div class="zune-modal-content">
              <Show when={view.state.playlistModalMode() !== "add-songs"}>
                <div class="zune-form-group">
                  <label>Title</label>
                  <input
                    type="text"
                    value={view.state.playlistForm().title}
                    onInput={(e) =>
                      view.actions.setPlaylistForm({
                        ...view.state.playlistForm(),
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
                    value={view.state.playlistForm().description}
                    onInput={(e) =>
                      view.actions.setPlaylistForm({
                        ...view.state.playlistForm(),
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
                      checked={view.state.playlistForm().is_public}
                      onChange={(e) =>
                        view.actions.setPlaylistForm({
                          ...view.state.playlistForm(),
                          is_public: e.currentTarget.checked,
                        })
                      }
                    />
                    Make public
                  </label>
                </div>
              </Show>
              <Show when={view.state.selectedSongs().length > 0}>
                <div class="zune-form-group">
                  <label>
                    {view.state.playlistModalMode() === "add-songs"
                      ? "Adding"
                      : "Songs to add"}{" "}
                    ({view.state.selectedSongs().length})
                  </label>
                  <div class="zune-selected-songs">
                    <For each={view.state.selectedSongs()}>
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
              <Show when={view.state.playlistModalMode() === "create"}>
                <button
                  class="zune-btn-primary"
                  onClick={createPlaylist}
                  disabled={!view.state.playlistForm().title.trim()}
                >
                  Create
                </button>
              </Show>
              <Show when={view.state.playlistModalMode() === "edit"}>
                <button
                  class="zune-btn-primary"
                  onClick={updatePlaylist}
                  disabled={!view.state.playlistForm().title.trim()}
                >
                  Save
                </button>
              </Show>
              <Show when={view.state.playlistModalMode() === "add-songs"}>
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

        .zune-logo-text svg {
          display: inline;
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

        .zune-sidebar, .zune-center, .zune-queue {
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

          .hidden-sm {
            display: none;
          }



          .zune-branding {

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
            height: auto;
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

function Zoony(props: ZoonyProps) {
  const apiClient = createApiClient(
    props.apiBaseUrl || "http://localhost:8080"
  );

  return (
    <SearchProvider
      apiClient={apiClient}
      searchOptions={{
        enableSuggestions: true,
        enableHistory: false,
        maxSuggestions: 10,
      }}
    >
      <FreqholeProvider options={{ apiBaseUrl: props.apiBaseUrl }}>
        <ZoonyContent />
      </FreqholeProvider>
    </SearchProvider>
  );
}

class ZoonyElement extends HTMLElement {
  private dispose: (() => void) | null = null;

  connectedCallback() {
    const apiBaseUrl =
      this.getAttribute("api-base-url") || "http://localhost:8080";
    const autoConnect = this.getAttribute("auto-connect") === "true";

    this.dispose = render(
      () => <Zoony apiBaseUrl={apiBaseUrl} autoConnect={autoConnect} />,
      this
    );
  }

  disconnectedCallback() {
    if (this.dispose) {
      this.dispose();
    }
  }
}

customElements.define("zune-demo", ZoonyElement);

export { Zoony, ZoonyElement };
export default Zoony;

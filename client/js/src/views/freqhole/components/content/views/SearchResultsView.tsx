import {
  For,
  Show,
  createSignal,
  createResource,
  createEffect,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useStore } from "../../../store";
import { useGlobalEvents } from "../../../hooks/useGlobalEvents";
import { useSongInteractions } from "../../../services/songInteractions";
import { apiClient } from "../../../../../lib/api-client";
import type { RouteSectionProps } from "@solidjs/router";
import type {
  SearchResultItem,
  SongSearchResult,
} from "../../../../../lib/search/types";
import type { Song } from "../../../../../lib/music/schemas";

interface SearchResultsViewProps {
  class?: string;
}

type ResultFilter = "all" | "songs" | "artists" | "albums";

export function SearchResultsView(
  props: RouteSectionProps<unknown> & SearchResultsViewProps = {} as any
) {
  const [store] = useStore();
  const events = useGlobalEvents();
  const navigate = useNavigate();
  const songInteractions = useSongInteractions();

  const [activeFilter, setActiveFilter] = createSignal<ResultFilter>("all");
  const [currentQuery, setCurrentQuery] = createSignal("");

  // Track the search query from the store
  createEffect(() => {
    if (store.search.query !== currentQuery()) {
      setCurrentQuery(store.search.query);
    }
  });

  // Search all content types
  const [searchResource] = createResource(
    () => currentQuery(),
    async (query: string) => {
      if (!query || query.trim().length === 0) return null;

      try {
        const response = await apiClient.searchMusic(query, {
          page_size: 50,
        });
        return response;
      } catch (error) {
        console.error("❌ Search failed:", error);
        return null;
      }
    }
  );

  // Search songs specifically for better song results
  const [songsResource] = createResource(
    () => currentQuery(),
    async (query: string) => {
      if (!query || query.trim().length === 0) return null;

      try {
        const response = await apiClient.searchSongs(query, {
          page_size: 50,
        });
        return response;
      } catch (error) {
        console.error("❌ Song search failed:", error);
        return null;
      }
    }
  );

  const convertToSong = (song: Song | SongSearchResult): Song => {
    // Convert SongSearchResult to Song format if needed
    return {
      id: song.id,
      title: song.title,
      artist: song.artist || null,
      album: song.album || null,
      album_artist: song.album_artist || null,
      track_number: song.track_number || null,
      disc_number: song.disc_number || null,
      duration_seconds: null, // Not available in search result
      genre: song.genre || null,
      year: song.year || null,
      bpm: song.bpm || null,
      key_signature: song.key_signature || null,
      rating: song.rating || null,
      is_favorite: song.is_favorite || false,
      tags: song.tags || [],
      display_title: song.title,
      detailed_display_title: song.title,
      created_at: song.created_at,
      media_blob_id: song.media_blob_id,
      thumbnail_blob_id: song.thumbnail_blob_id || null,
      waveform_blob_id: song.waveform_blob_id || null,
      thumbnail_blob_ids: [],
    };
  };

  const handleSongDoubleClick = (song: Song | SongSearchResult) => {
    const normalizedSong = convertToSong(song);
    songInteractions.playSong(normalizedSong, true);
  };

  const handleGenericResultClick = (result: SearchResultItem) => {
    // Handle different result types
    if (result.result_type === "song") {
      // Try to convert to song format and play
      const song: Song = {
        id: result.id,
        title: result.title,
        artist: result.subtitle || null,
        album: null,
        album_artist: null,
        track_number: null,
        disc_number: null,
        duration_seconds: null,
        genre: null,
        year: null,
        bpm: null,
        key_signature: null,
        rating: null,
        is_favorite: false,
        tags: [],
        display_title: result.title,
        detailed_display_title: result.title,
        created_at: result.created_at.toISOString(),
        media_blob_id: result.media_blob_id || "",
        thumbnail_blob_id: result.thumbnail_blob_id || null,
        waveform_blob_id: null,
        thumbnail_blob_ids: [],
      };
      events.emit("song:play", { song, replaceQueue: false });
    } else if (result.result_type === "artist") {
      // Navigate to artist view and pre-select the artist
      navigate("/artists");
      // Try to find and select the artist by name
      const artistName = result.title;
      setTimeout(() => {
        // Emit artist selection to pre-select it in the view
        events.emit("artist:selected", {
          artist: { artist: artistName, name: artistName },
        });
      }, 100);
    } else if (result.result_type === "album") {
      // Navigate to album view and potentially pre-select the album
      navigate("/albums");
      const albumName = result.title;
      setTimeout(() => {
        // Emit album selection if we have enough info
        events.emit("album:selected", {
          album: {
            album: albumName,
            title: albumName,
            artist: result.subtitle,
          },
        });
      }, 100);
    }
  };

  const getFilteredResults = () => {
    const searchResults = searchResource();
    const songResults = songsResource();

    if (!searchResults && !songResults) return [];

    // TODO: The server search API currently only returns songs and playlists,
    // not separate artist/album entities. This is a temporary workaround that
    // extracts artists and albums from song results. The server API should be
    // enhanced to return proper artist and album search results.
    // Extract unique artists and albums from song results
    const songs = songResults?.songs || [];
    const uniqueArtists = new Map();
    const uniqueAlbums = new Map();

    songs.forEach((song) => {
      if (song.artist && !uniqueArtists.has(song.artist)) {
        uniqueArtists.set(song.artist, {
          id: `artist-${song.artist}`,
          result_type: "artist",
          title: song.artist,
          subtitle: "Artist",
          description: null,
          thumbnail_blob_id: song.thumbnail_blob_id,
          media_blob_id: null,
          relevance_score: 0.8,
          metadata: {},
          created_at: new Date(song.created_at),
          updated_at: new Date(song.updated_at || song.created_at),
        });
      }

      if (song.album && !uniqueAlbums.has(`${song.album}-${song.artist}`)) {
        uniqueAlbums.set(`${song.album}-${song.artist}`, {
          id: `album-${song.album}-${song.artist}`,
          result_type: "album",
          title: song.album,
          subtitle: song.artist,
          description: "Album",
          thumbnail_blob_id: song.thumbnail_blob_id,
          media_blob_id: null,
          relevance_score: 0.7,
          metadata: {},
          created_at: new Date(song.created_at),
          updated_at: new Date(song.updated_at || song.created_at),
        });
      }
    });

    const extractedArtists = Array.from(uniqueArtists.values());
    const extractedAlbums = Array.from(uniqueAlbums.values());

    switch (activeFilter()) {
      case "songs":
        return songs;
      case "artists":
        return extractedArtists;
      case "albums":
        return extractedAlbums;
      default:
        // Combine all results
        const allResults = [...(searchResults?.results || [])];
        // Add songs from song search
        const songSearchResults = songs.map((song) => ({
          id: song.id,
          result_type: "song",
          title: song.title,
          subtitle: song.artist,
          description: song.album,
          thumbnail_blob_id: song.thumbnail_blob_id,
          media_blob_id: song.media_blob_id,
          relevance_score: song.search_rank || 0,
          metadata: {},
          created_at: new Date(song.created_at),
          updated_at: new Date(song.updated_at || song.created_at),
        }));
        return [
          ...allResults,
          ...songSearchResults,
          ...extractedArtists,
          ...extractedAlbums,
        ];
    }
  };

  const getResultCounts = () => {
    const searchResults = searchResource();
    const songResults = songsResource();

    const songs = songResults?.songs?.length || 0;

    // Extract unique artists and albums from song results
    const songsData = songResults?.songs || [];
    const uniqueArtists = new Set();
    const uniqueAlbums = new Set();

    songsData.forEach((song) => {
      if (song.artist) uniqueArtists.add(song.artist);
      if (song.album) uniqueAlbums.add(`${song.album}-${song.artist}`);
    });

    const artists = uniqueArtists.size;
    const albums = uniqueAlbums.size;
    const total = songs + artists + albums;

    return { total, songs, artists, albums };
  };

  const getImageUrl = (item: any) => {
    if (item.thumbnail_blob_id) {
      return `${apiClient.getBaseUrl()}/api/blobs/${item.thumbnail_blob_id}`;
    }
    return null;
  };

  const formatResultType = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  return (
    <div class={`h-full bg-black text-white ${props.class || ""}`}>
      <Show when={currentQuery()} fallback={<div class="flex-1"></div>}>
        <div class="h-full flex flex-col">
          {/* Header */}
          <div class="flex-shrink-0 p-6 border-b border-magenta-800/30">
            <h1 class="text-2xl font-semibold text-white mb-2">
              search results for "{currentQuery()}"
            </h1>

            <Show
              when={!searchResource.loading && !songsResource.loading}
              fallback={<p class="text-magenta-300 text-sm">searching...</p>}
            >
              <p class="text-magenta-300 text-sm mb-4">
                {getResultCounts().total} results found
              </p>
            </Show>

            {/* Filter Tabs */}
            <div class="flex space-x-1 bg-magenta-950/30 rounded-lg p-1">
              <button
                class={`px-4 py-2 rounded text-sm font-medium transition-all ${
                  activeFilter() === "all"
                    ? "bg-magenta-600 text-black"
                    : "text-magenta-300 hover:text-white hover:bg-magenta-600/30"
                }`}
                onClick={() => setActiveFilter("all")}
              >
                all ({getResultCounts().total})
              </button>
              <button
                class={`px-4 py-2 rounded text-sm font-medium transition-all ${
                  activeFilter() === "songs"
                    ? "bg-magenta-600 text-black"
                    : "text-magenta-300 hover:text-white hover:bg-magenta-600/30"
                }`}
                onClick={() => setActiveFilter("songs")}
              >
                songs ({getResultCounts().songs})
              </button>
              <button
                class={`px-4 py-2 rounded text-sm font-medium transition-all ${
                  activeFilter() === "artists"
                    ? "bg-magenta-600 text-black"
                    : "text-magenta-300 hover:text-white hover:bg-magenta-600/30"
                }`}
                onClick={() => setActiveFilter("artists")}
              >
                artists ({getResultCounts().artists})
              </button>
              <button
                class={`px-4 py-2 rounded text-sm font-medium transition-all ${
                  activeFilter() === "albums"
                    ? "bg-magenta-600 text-black"
                    : "text-magenta-300 hover:text-white hover:bg-magenta-600/30"
                }`}
                onClick={() => setActiveFilter("albums")}
              >
                albums ({getResultCounts().albums})
              </button>
            </div>
          </div>

          {/* Results */}
          <div class="flex-1 overflow-y-auto p-6">
            <Show
              when={!searchResource.loading && !songsResource.loading}
              fallback={
                <div class="space-y-4">
                  <For each={Array.from({ length: 10 })}>
                    {() => (
                      <div class="animate-pulse">
                        <div class="h-16 bg-magenta-800/30 rounded-lg"></div>
                      </div>
                    )}
                  </For>
                </div>
              }
            >
              <Show
                when={getFilteredResults().length > 0}
                fallback={
                  <div class="text-center py-12">
                    <div class="text-white text-xl mb-2">no results found</div>
                    <div class="text-magenta-400">
                      try a different search term or check your spelling
                    </div>
                  </div>
                }
              >
                <div class="space-y-3">
                  <For each={getFilteredResults()}>
                    {(result: any) => (
                      <div
                        class="flex items-center p-4 bg-magenta-950/30 rounded-lg hover:bg-magenta-600/20 transition-colors cursor-pointer group"
                        onClick={() => {
                          // Only handle click for non-songs (navigate to artists/albums)
                          if (
                            activeFilter() !== "songs" &&
                            result.result_type !== "song"
                          ) {
                            handleGenericResultClick(result);
                          }
                        }}
                        onDblClick={() => {
                          // Only handle double-click for songs
                          if (
                            activeFilter() === "songs" ||
                            result.result_type === "song"
                          ) {
                            handleSongDoubleClick(result);
                          }
                        }}
                      >
                        {/* Thumbnail */}
                        <div class="w-12 h-12 bg-magenta-800/30 rounded flex-shrink-0 overflow-hidden mr-4">
                          <Show
                            when={getImageUrl(result)}
                            fallback={
                              <div class="w-full h-full flex items-center justify-center">
                                <svg
                                  class="w-6 h-6 text-magenta-400"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                                </svg>
                              </div>
                            }
                          >
                            <img
                              src={getImageUrl(result)!}
                              alt={result.title}
                              class="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </Show>
                        </div>

                        {/* Content */}
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center space-x-2 mb-1">
                            <div class="text-white font-medium truncate group-hover:text-magenta-300 transition-colors">
                              {result.title}
                            </div>
                            <span class="px-2 py-0.5 bg-magenta-600/30 rounded text-xs text-magenta-300 flex-shrink-0">
                              {formatResultType(result.result_type || "song")}
                            </span>
                          </div>
                          <div class="text-magenta-400 text-sm truncate">
                            {result.subtitle || result.artist}
                            {result.description || result.album ? (
                              <span class="ml-2">
                                • {result.description || result.album}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {/* Actions */}
                        <div class="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity ml-4">
                          <Show
                            when={
                              activeFilter() === "songs" ||
                              result.result_type === "song"
                            }
                          >
                            <button
                              class="p-2 rounded-full hover:bg-magenta-600/30 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                const normalizedSong = convertToSong(result);
                                songInteractions.playSong(
                                  normalizedSong,
                                  false
                                );
                              }}
                              title="Play song"
                            >
                              <svg
                                class="w-4 h-4 text-magenta-400"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </button>
                            <button
                              class="p-2 rounded-full hover:bg-magenta-600/30 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                const normalizedSong = convertToSong(result);
                                songInteractions.queueSong(normalizedSong);
                              }}
                              title="Add to queue"
                            >
                              <svg
                                class="w-4 h-4 text-magenta-400"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
                              </svg>
                            </button>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

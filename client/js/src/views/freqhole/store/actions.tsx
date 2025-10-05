import { createResource, batch } from "solid-js";
import { produce } from "solid-js/store";
import type { FreqholeStore } from "./index";
import type { SetStoreFunction } from "solid-js/store";
import { eventBus } from "../hooks/useGlobalEvents";

// basic resources without view coupling
export interface BasicStoreResources {
  songs: any;
  artists: any;
  albums: any;
  playlists: any;
  recentPlaylists: any;
  availableTags: any;
  genres: any;
  genreDetails: any;
}

// store actions factory with reactive primitives
export function createStoreActions(
  store: FreqholeStore,
  setStore: SetStoreFunction<FreqholeStore>,
  apiClient: typeof import("../../../lib/api-client").apiClient
) {
  // Loading guard to prevent duplicate pagination requests
  let isLoadingMore = false;
  // Use stable getSongs for main list, POST search only for tag filtering
  const [songsResource, { refetch: refetchSongs, mutate: mutateSongs }] =
    createResource(
      () => {
        const deps = {
          tags: [...store.filters.tags], // spread to track changes properly
          query: store.search.query?.trim() || "",
          sortField: store.sort.field,
          sortDirection: store.sort.direction,
          favoritesOnly: store.filters.favoritesOnly,
        };

        return deps;
      },
      async (params) => {
        const filters: any = {};
        if (params.tags.length > 0) {
          filters.tags = params.tags;
        }
        if (params.favoritesOnly) {
          filters.is_favorite = true;
        }

        const requestBody = {
          query: params.query || undefined,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
          sort_by: params.sortField,
          sort_direction: params.sortDirection,
          page_size: 100,
        };

        return await apiClient.searchPost(requestBody);
      }
    );

  const [artistsResource, { refetch: refetchArtists, mutate: mutateArtists }] =
    createResource(
      () => {
        const deps = {
          tags: [...store.filters.tags], // spread to track changes properly
          query: store.search.query?.trim() || "",
          sortField: store.sort.field,
          sortDirection: store.sort.direction,
        };
        return deps;
      },
      async (params) => {
        // Use unified filterArtists API for everything
        return await apiClient.filterArtists({
          query: params.query || undefined,
          tags: params.tags.length > 0 ? params.tags : undefined,
          sort_by: params.sortField,
          sort_direction: params.sortDirection,
          page_size: 100,
        });
      }
    );

  const [albumsResource, { refetch: refetchAlbums, mutate: mutateAlbums }] =
    createResource(
      () => {
        const deps = {
          tags: [...store.filters.tags], // spread to track changes properly
          query: store.search.query?.trim() || "",
          sortField: store.sort.field,
          sortDirection: store.sort.direction,
        };
        return deps;
      },
      async (params) => {
        // Use unified filterAlbums API for everything
        return await apiClient.filterAlbums({
          query: params.query || undefined,
          tags: params.tags.length > 0 ? params.tags : undefined,
          sort_by: params.sortField,
          sort_direction: params.sortDirection,
          page_size: 100,
        });
      }
    );

  const [playlistsResource, { refetch: refetchPlaylists }] = createResource(
    () => true, // simple fetch - components decide when to access
    async () => {
      // TODO: implement getPlaylists API method
      return [];
    }
  );

  // recent playlists for navigation (always loaded - lightweight)
  const [recentPlaylistsResource, { refetch: refetchRecentPlaylists }] =
    createResource(
      () => true, // always load for nav
      () => {
        // TODO: implement getRecentPlaylists API method
        return [];
      }
    );

  // available tags - load once, then use mutate for updates
  const [availableTagsResource, { mutate: mutateAvailableTags }] =
    createResource(
      () => true, // load once initially, then use mutate for performance
      async () => {
        try {
          const filterOptions = await apiClient.getFilterOptions();
          return filterOptions.tags.items || [];
        } catch (error) {
          console.error("failed to fetch available tags:", error);
          return [];
        }
      }
    );

  const [suggestionsResource] = createResource(
    () => store.search.query?.trim() || "",
    async (query) => {
      if (!query || query.length < 2) {
        return [];
      }
      try {
        const result = await apiClient.getMusicSuggestions(query);
        return result.suggestions || [];
      } catch (error) {
        console.error("failed to fetch suggestions:", error);
        return [];
      }
    }
  );

  // genre list resource - shows all genres with stats, integrates with global search
  const [genresResource, { refetch: refetchGenres }] = createResource(
    () => {
      const deps = {
        tags: [...store.filters.tags], // spread to track changes properly
        query: store.search.query?.trim() || "",
        sortField: store.sort.field,
        sortDirection: store.sort.direction,
        with_songs_only: true, // filter out genres with zero counts
      };
      return deps;
    },
    async (params) => {
      try {
        // For genres, we use getGenres for basic listing
        // and searchGenres for when there's a query or filters
        if (params.query || params.tags.length > 0) {
          const searchRequest = {
            q: params.query || undefined,
            tags: params.tags.length > 0 ? params.tags : undefined,
            sort_by: params.sortField,
            sort_direction: params.sortDirection,
            page: 1,
            page_size: 100,
          };
          const result = await apiClient.searchGenres(searchRequest);
          // Convert search result to genre stats format
          if ("artists" in result) {
            // Extract unique genres from artist results
            const genreMap = new Map();
            result.artists.forEach((artist) => {
              artist.genres.forEach((genreName) => {
                if (!genreMap.has(genreName)) {
                  genreMap.set(genreName, {
                    name: genreName,
                    song_count: 0,
                    album_count: 0,
                    artist_count: 0,
                    total_duration: 0,
                  });
                }
                const genre = genreMap.get(genreName);
                genre.song_count += artist.song_count;
                genre.album_count += artist.album_count;
                genre.artist_count += 1;
                genre.total_duration += artist.total_duration;
              });
            });
            return {
              genres: Array.from(genreMap.values()),
              total: genreMap.size,
            };
          }
          return { genres: [], total: 0 };
        } else {
          return await apiClient.getGenres({
            with_songs_only: params.with_songs_only,
          });
        }
      } catch (error) {
        console.error("failed to fetch genres:", error);
        return { genres: [], total: 0 };
      }
    }
  );

  // genre details resource - shows artists/albums for selected genre
  const [genreDetailsResource, { refetch: refetchGenreDetails }] =
    createResource(
      () => {
        // Simple dependency tracking - just return selectedGenre directly
        const selectedGenre = store.genres.selectedGenre;
        console.log("Genre details resource key:", selectedGenre);
        return selectedGenre;
      },
      async (selectedGenre) => {
        if (!selectedGenre) {
          return null;
        }

        try {
          const searchRequest = {
            genre: selectedGenre,
            q: store.search.query?.trim() || undefined,
            tags:
              store.filters.tags.length > 0 ? store.filters.tags : undefined,
            sort_by: store.sort.field,
            sort_direction: store.sort.direction,
            page: store.genres.currentPage,
            page_size: 50,
          };

          console.log("Fetching genre details for:", selectedGenre);
          return await apiClient.searchGenres(searchRequest);
        } catch (error) {
          console.error("failed to fetch genre details:", error);
          return null;
        }
      }
    );

  return {
    // resources for components to consume
    resources: {
      songs: songsResource,
      artists: artistsResource,
      albums: albumsResource,
      playlists: playlistsResource,
      recentPlaylists: recentPlaylistsResource,
      availableTags: availableTagsResource,
      suggestions: suggestionsResource,
      genres: genresResource,
      genreDetails: genreDetailsResource,
    },

    // expose mutate functions for coordinated updates
    mutateAvailableTags,

    // targeted song updates for efficiency
    updateSongsInPlace: (updatedSongs: any[]) => {
      mutateSongs((current) => {
        if (!current || !Array.isArray(current.songs)) return current;

        // create a map of updated songs by ID for fast lookup
        const updatedSongsMap = new Map(
          updatedSongs.map((song) => [song.id, song])
        );

        // update existing songs in place
        const newSongs = current.songs.map((song) => {
          const updated = updatedSongsMap.get(song.id);
          return updated ? updated : song;
        });

        return {
          ...current,
          songs: newSongs,
        };
      });
    },

    // reactive filter actions with proper produce patterns
    setFavoritesFilter: (enabled: boolean) => {
      setStore("filters", "favoritesOnly", enabled);

      eventBus.dispatchEvent(
        new CustomEvent("favorites:toggled", {
          detail: { enabled },
        })
      );
    },

    toggleFavoritesFilter: () => {
      const newValue = !store.filters.favoritesOnly;
      setStore("filters", "favoritesOnly", newValue);

      eventBus.dispatchEvent(
        new CustomEvent("favorites:toggled", {
          detail: { enabled: newValue },
        })
      );
    },

    addTagFilter: (tag: string) => {
      setStore(
        "filters",
        produce((draft) => {
          if (!draft.tags.includes(tag)) {
            draft.tags.push(tag);
          }
        })
      );

      // resources automatically refetch based on reactive dependencies

      eventBus.dispatchEvent(
        new CustomEvent("tag:added", {
          detail: { tag },
        })
      );
    },

    removeTagFilter: (tag: string) => {
      setStore(
        "filters",
        produce((draft) => {
          draft.tags = draft.tags.filter((t: string) => t !== tag);
        })
      );

      // resources auto-update - no manual coordination needed

      eventBus.dispatchEvent(
        new CustomEvent("tag:removed", {
          detail: { tag },
        })
      );
    },

    clearTagFilters: () => {
      setStore("filters", "tags", []);

      eventBus.dispatchEvent(
        new CustomEvent("tags:cleared", {
          detail: {},
        })
      );
    },

    // @deprecated LEGACY: view tracking removed - router handles this now

    // cross-view synchronization with optimistic updates
    toggleSongFavorite: (songId: string, isFavorite: boolean) => {
      // TODO: implement optimistic updates in future phase
      // for now, just make API call and let resources refetch

      // api call with error handling
      apiClient.toggleSongFavorite(songId, isFavorite).catch((error) => {
        console.error("failed to update song preference", error);
      });

      // event for currently playing indicators and other listeners
      eventBus.dispatchEvent(
        new CustomEvent("song:favorite-changed", {
          detail: { songId, isFavorite },
        })
      );
    },

    // set currently playing song with cross-view synchronization
    setCurrentlyPlaying: (song: any | null) => {
      const previousSong = store.player.currentSong;

      setStore("player", "currentSong", song);

      // emit events for "now playing" indicators across the app
      eventBus.dispatchEvent(
        new CustomEvent("player:song-changed", {
          detail: { currentSong: song, previousSong },
        })
      );
    },

    // playlist updates with cross-view synchronization
    updatePlaylist: async (playlistId: string, updates: any) => {
      // TODO: implement optimistic updates in future phase
      // for now, make API call and let resources handle updates

      try {
        const updatedPlaylist = await apiClient.updatePlaylist(
          playlistId,
          updates
        );

        // refresh resources that might be affected
        refetchPlaylists();
        refetchRecentPlaylists();

        // success event for nav and other listeners
        eventBus.dispatchEvent(
          new CustomEvent("playlist:updated", {
            detail: { playlist: updatedPlaylist },
          })
        );
      } catch (error) {
        console.error("failed to update playlist", error);
        throw error;
      }
    },

    // add song to playlist with nav synchronization
    addSongToPlaylist: async (playlistId: string, songId: string) => {
      // TODO: implement optimistic updates in future phase

      try {
        await apiClient.addSongsToPlaylist(playlistId, [songId]);

        // refresh playlists to get updated counts
        refetchPlaylists();
        refetchRecentPlaylists();

        eventBus.dispatchEvent(
          new CustomEvent("playlist:song-added", {
            detail: { playlistId, songId },
          })
        );
      } catch (error) {
        console.error("failed to add song to playlist", error);
        throw error;
      }
    },

    // Fixed pagination support - handle different endpoint return types
    loadMoreSongs: async () => {
      // Prevent duplicate requests
      if (isLoadingMore) {
        return;
      }

      const currentResult = songsResource();
      if (!currentResult) return;

      isLoadingMore = true;

      // Both endpoints now return SongListResponse format
      let hasNext = false;
      let currentPage = 1;

      // POST search response format
      hasNext = currentResult.has_next || false;
      currentPage = currentResult.page || 1;

      if (!hasNext) {
        isLoadingMore = false;
        return;
      }

      const nextPage = currentPage + 1;
      let nextPageResult;

      try {
        // Use EXACT same parameters as main resource to ensure consistency
        const params = {
          tags: [...store.filters.tags], // spread to match main resource
          query: store.search.query?.trim() || "",
          favoritesOnly: store.filters.favoritesOnly,
        };

        const filters: any = {};
        if (params.tags.length > 0) {
          filters.tags = params.tags;
        }
        if (params.favoritesOnly) {
          filters.is_favorite = true;
        }

        nextPageResult = await apiClient.searchPost({
          query: params.query || undefined,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
          sort_by: store.sort.field,
          sort_direction: store.sort.direction,
          page: nextPage,
          page_size: 100,
        });
      } catch (error) {
        isLoadingMore = false;
        return;
      }

      // Append new songs - both endpoints now return SongListResponse format
      mutateSongs((current) => {
        if (!current || !nextPageResult) return nextPageResult;

        const currentSongs = current.songs;
        const newSongs = nextPageResult.songs;

        // Consistent SongListResponse format merging
        // POST search format
        return {
          ...current,
          songs: [...currentSongs, ...newSongs],
          page: nextPageResult.page,
          has_next: nextPageResult.has_next,
        };
      });

      // Reset loading guard
      isLoadingMore = false;
    },

    // Fixed pagination support for albums
    loadMoreAlbums: async () => {
      // Prevent duplicate requests
      if (isLoadingMore) {
        return;
      }

      const currentResult = albumsResource();
      if (!currentResult) return;

      isLoadingMore = true;

      // Albums API returns { albums, pagination } structure
      const hasNext = currentResult.pagination?.has_next || false;
      const currentPage = currentResult.pagination?.page || 1;

      if (!hasNext) {
        isLoadingMore = false;
        return;
      }

      const nextPage = currentPage + 1;
      let nextPageResult;

      try {
        // Use EXACT same parameters as main resource to ensure consistency
        const params = {
          tags: [...store.filters.tags], // spread to match main resource
          query: store.search.query?.trim() || "",
        };

        nextPageResult = await apiClient.filterAlbums({
          query: params.query || undefined,
          tags: params.tags.length > 0 ? params.tags : undefined,
          sort_by: store.sort.field,
          sort_direction: store.sort.direction,
          page: nextPage,
          page_size: 100,
        });
      } catch (error) {
        isLoadingMore = false;
        return;
      }

      // Append new albums to existing ones
      mutateAlbums((current) => {
        if (!current || !nextPageResult) return nextPageResult;

        const currentAlbums = current.albums;
        const newAlbums = nextPageResult.albums;

        return {
          albums: [...currentAlbums, ...newAlbums],
          pagination: {
            ...nextPageResult.pagination,
            page: nextPageResult.pagination.page,
            has_next: nextPageResult.pagination.has_next,
          },
        };
      });

      // Reset loading guard
      isLoadingMore = false;
    },

    // Fixed pagination support for artists
    loadMoreArtists: async () => {
      // Prevent duplicate requests
      if (isLoadingMore) {
        return;
      }

      const currentResult = artistsResource();
      if (!currentResult) return;

      isLoadingMore = true;

      // Artists API returns { artists, pagination } structure
      const hasNext = currentResult.pagination?.has_next || false;
      const currentPage = currentResult.pagination?.page || 1;

      if (!hasNext) {
        isLoadingMore = false;
        return;
      }

      const nextPage = currentPage + 1;
      let nextPageResult;

      try {
        // Use EXACT same parameters as main resource to ensure consistency
        const params = {
          tags: [...store.filters.tags], // spread to match main resource
          query: store.search.query?.trim() || "",
        };

        nextPageResult = await apiClient.filterArtists({
          query: params.query || undefined,
          tags: params.tags.length > 0 ? params.tags : undefined,
          sort_by: store.sort.field,
          sort_direction: store.sort.direction,
          page: nextPage,
          page_size: 100,
        });
      } catch (error) {
        isLoadingMore = false;
        return;
      }

      // Append new artists to existing ones
      mutateArtists((current) => {
        if (!current || !nextPageResult) return nextPageResult;

        const currentArtists = current.artists;
        const newArtists = nextPageResult.artists;

        return {
          artists: [...currentArtists, ...newArtists],
          pagination: {
            ...nextPageResult.pagination,
            page: nextPageResult.pagination.page,
            has_next: nextPageResult.pagination.has_next,
          },
        };
      });

      // Reset loading guard
      isLoadingMore = false;
    },

    // selective refresh methods - components can call what they need
    refreshSongs: () => refetchSongs(),
    refreshArtists: () => refetchArtists(),
    refreshAlbums: () => refetchAlbums(),
    refreshPlaylists: () => refetchPlaylists(),

    // sort management
    setSort: (field: string, direction: "asc" | "desc") => {
      setStore("sort", { field, direction });

      // songs resource will automatically refetch due to reactive dependencies
    },

    // tag lifecycle management with optimistic updates
    addTagToSongs: async (songIds: string[], tagName: string) => {
      // optimistic update to available tags
      mutateAvailableTags((current) => {
        if (!current) return current;
        const existing = current.find((tag) => tag.value === tagName);
        if (existing) {
          // increment count for existing tag
          return current.map((tag) =>
            tag.value === tagName
              ? { ...tag, count: tag.count + songIds.length }
              : tag
          );
        } else {
          // add new tag to list
          return [
            ...current,
            { value: tagName, label: tagName, count: songIds.length },
          ];
        }
      });

      try {
        await apiClient.addTagsToSongs(songIds, [tagName]);

        eventBus.dispatchEvent(
          new CustomEvent("song:tags-updated", {
            detail: { songIds, tagAdded: tagName },
          })
        );
      } catch (error) {
        // rollback optimistic update
        mutateAvailableTags((current) => {
          if (!current) return current;
          const existing = current.find((tag) => tag.value === tagName);
          if (existing && existing.count <= songIds.length) {
            // remove tag if count would be zero or negative
            return current.filter((tag) => tag.value !== tagName);
          } else if (existing) {
            // decrement count
            return current.map((tag) =>
              tag.value === tagName
                ? { ...tag, count: tag.count - songIds.length }
                : tag
            );
          }
          return current;
        });
        console.error("failed to add tag to songs:", error);
        throw error;
      }
    },

    removeTagFromSongs: async (songIds: string[], tagName: string) => {
      // optimistic update to available tags
      mutateAvailableTags((current) => {
        if (!current) return current;
        return current
          .map((tag) =>
            tag.value === tagName
              ? { ...tag, count: Math.max(0, tag.count - songIds.length) }
              : tag
          )
          .filter((tag) => tag.count > 0);
      });

      try {
        await apiClient.removeTagsFromSongs(songIds, [tagName]);

        eventBus.dispatchEvent(
          new CustomEvent("song:tags-updated", {
            detail: { songIds, tagRemoved: tagName },
          })
        );
      } catch (error) {
        // rollback optimistic update
        mutateAvailableTags((current) => {
          if (!current) return current;
          const existing = current.find((tag) => tag.value === tagName);
          if (existing) {
            // restore count
            return current.map((tag) =>
              tag.value === tagName
                ? { ...tag, count: tag.count + songIds.length }
                : tag
            );
          } else {
            // re-add tag that was removed
            return [
              ...current,
              { value: tagName, label: tagName, count: songIds.length },
            ];
          }
        });
        console.error("failed to remove tag from songs:", error);
        throw error;
      }
    },

    // genre actions
    selectGenre: (genreName: string | null) => {
      batch(() => {
        setStore("genres", "selectedGenre", genreName);
        setStore("navigation", "selectedGenre", genreName);
        // reset to first page when changing genre
        if (genreName !== store.genres.selectedGenre) {
          setStore("genres", "currentPage", 1);
        }
      });
    },

    setGenreViewMode: (mode: "artists" | "albums") => {
      batch(() => {
        setStore("genres", "viewMode", mode);
        // reset to first page when changing view mode
        setStore("genres", "currentPage", 1);
      });
    },

    setGenrePage: (page: number) => {
      setStore("genres", "currentPage", page);
    },

    // genre search method for fetching albums/artists within genres
    searchGenres: async (request: any) => {
      try {
        return await apiClient.searchGenres(request);
      } catch (error) {
        console.error("failed to search genres:", error);
        throw error;
      }
    },

    // selective refresh methods - components can call what they need
    refreshGenres: () => refetchGenres(),
    refreshGenreDetails: () => refetchGenreDetails(),

    // force refresh all (only when needed)
    refreshAll: () => {
      batch(() => {
        refetchSongs();
        refetchArtists();
        refetchAlbums();
        refetchPlaylists();
        refetchRecentPlaylists();
        refetchGenres();
        refetchGenreDetails();
        // note: availableTags uses mutate pattern, doesn't need refetch
      });
    },
  };
}

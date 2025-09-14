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
        };

        return deps;
      },
      async (params) => {
        const requestBody = {
          query: params.query || undefined,
          filters: params.tags.length > 0 ? { tags: params.tags } : undefined,
          sort_by: params.sortField,
          sort_direction: params.sortDirection,
          page_size: 100,
        };

        return await apiClient.searchPost(requestBody);
      }
    );

  const [artistsResource, { refetch: refetchArtists }] = createResource(
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
        console.log("albums resource API call:", {
          sort_by: params.sortField,
          sort_direction: params.sortDirection,
          query: params.query,
          tags: params.tags,
        });

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
    },

    // expose mutate functions for coordinated updates
    mutateAvailableTags,

    // reactive filter actions with proper produce patterns
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

      if ("pagination" in currentResult) {
        // GET songs response
        hasNext = currentResult.pagination?.has_next || false;
        currentPage = currentResult.pagination?.page || 1;
      } else {
        // POST search response (now also SongListResponse format)
        hasNext = currentResult.has_next || false;
        currentPage = currentResult.page || 1;
      }

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

        nextPageResult = await apiClient.searchPost({
          query: params.query || undefined,
          filters: params.tags.length > 0 ? { tags: params.tags } : undefined,
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
        if ("pagination" in current) {
          // GET songs format - preserve pagination structure
          return {
            ...current,
            songs: [...currentSongs, ...newSongs],
            pagination: {
              ...current.pagination,
              page: nextPageResult.pagination?.page || current.pagination?.page,
              has_next: nextPageResult.pagination?.has_next || false,
            },
          };
        } else {
          // POST search format (now also SongListResponse)
          return {
            ...current,
            songs: [...currentSongs, ...newSongs],
            page: nextPageResult.page,
            has_next: nextPageResult.has_next,
          };
        }
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

        console.log("loadMoreAlbums API call:", {
          sort_by: store.sort.field,
          sort_direction: store.sort.direction,
          page: nextPage,
        });

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

    // force refresh all (only when needed)
    refreshAll: () => {
      batch(() => {
        refetchSongs();
        refetchArtists();
        refetchAlbums();
        refetchPlaylists();
        refetchRecentPlaylists();
        // note: availableTags uses mutate pattern, doesn't need refetch
      });
    },
  };
}

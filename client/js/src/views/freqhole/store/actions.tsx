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
  // basic resource fetching for phase 1 - let components decide when to load
  const [songsResource, { refetch: refetchSongs }] = createResource(
    () => ({
      tags: store.filters.tags,
      query: store.search.query,
    }),
    async (params) => {
      // simple fetching - components control when this runs
      if (params.query) {
        return apiClient.searchMusic(params.query);
      } else if (params.tags.length > 0) {
        // TODO: implement tag filtering in phase 2-3
        return apiClient.getSongs();
      }
      return apiClient.getSongs();
    }
  );

  const [artistsResource, { refetch: refetchArtists }] = createResource(
    () => store.filters.tags,
    async (tags) => {
      // simple fetch - components decide when to use this resource
      if (tags.length > 0) {
        // TODO: implement filterArtists in phase 3
        return apiClient.getArtists();
      }
      return apiClient.getArtists();
    }
  );

  const [albumsResource, { refetch: refetchAlbums }] = createResource(
    () => store.filters.tags,
    async (tags) => {
      // simple fetch - components decide when to use this resource
      if (tags.length > 0) {
        // TODO: implement filterAlbums in phase 3
        return apiClient.getAlbums();
      }
      return apiClient.getAlbums();
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

  // available tags with reactive updates when tags are created/deleted
  const [availableTagsResource] = createResource(
    () => store.ui.tagListVersion, // increment this to force refresh
    async () => {
      try {
        // TODO: implement proper tag fetching in phase 2
        // For now return empty array until we have proper API
        return [];
      } catch (error) {
        console.error("failed to fetch available tags:", error);
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
    },

    // smart filter actions with selective updates
    addTagFilter: (tag: string) => {
      setStore(
        produce((draft: any) => {
          if (!draft.filters.tags.includes(tag)) {
            draft.filters.tags.push(tag);
          }
        })
      );
      // resources automatically refetch based on reactive dependencies
      // no manual refetch needed - performance optimized!

      // event for any remaining listeners
      eventBus.dispatchEvent(
        new CustomEvent("tag:added", {
          detail: { tag },
        })
      );
    },

    removeTagFilter: (tag: string) => {
      setStore(
        produce((draft: any) => {
          draft.filters.tags = draft.filters.tags.filter(
            (t: string) => t !== tag
          );
        })
      );
      // again, resources auto-update - no manual coordination needed

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

    // remove view tracking - let router handle this

    // cross-view synchronization with optimistic updates
    toggleSongFavorite: (songId: string, isFavorite: boolean) => {
      // optimistic update in current resource
      // TODO: implement optimistic updates once mutate import is fixed
      // mutate(songsResource, (songs: any) => {
      //   const song = songs?.find((s: any) => s.id === songId);
      //   if (song) song.is_favorite = isFavorite;
      // });

      // api call with rollback on error
      apiClient.toggleSongFavorite(songId, isFavorite).catch(() => {
        // revert optimistic updates
        // TODO: implement optimistic rollback once mutate import is fixed
        // mutate(songsResource, (songs: any) => {
        //   const song = songs?.find((s: any) => s.id === songId);
        //   if (song) song.is_favorite = !isFavorite;
        // });
        console.error("failed to update song preference");
      });

      // event for "currently playing" indicators and other listeners
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
      // optimistic update in main playlists resource
      // TODO: implement optimistic updates once mutate import is fixed
      // mutate(playlistsResource, (playlists: any) => {
      //   const playlist = playlists?.find((p: any) => p.id === playlistId);
      //   if (playlist) {
      //     Object.assign(playlist, updates);
      //   }
      // });

      // also update recent playlists in nav
      // mutate(recentPlaylistsResource, (recent: any) => {
      //   const playlist = recent?.find((p: any) => p.id === playlistId);
      //   if (playlist) {
      //     Object.assign(playlist, updates);
      //   }
      // });

      try {
        const updatedPlaylist = await apiClient.updatePlaylist(
          playlistId,
          updates
        );

        // success event for nav and other listeners
        eventBus.dispatchEvent(
          new CustomEvent("playlist:updated", {
            detail: { playlist: updatedPlaylist },
          })
        );
      } catch (error) {
        // revert optimistic updates on error
        refetchPlaylists();
        refetchRecentPlaylists();
        throw error;
      }
    },

    // add song to playlist with nav synchronization
    addSongToPlaylist: async (playlistId: string, songId: string) => {
      // optimistic update to playlist song count
      // TODO: implement optimistic updates once mutate import is fixed
      // mutate(recentPlaylistsResource, (recent: any) => {
      //   const playlist = recent?.find((p: any) => p.id === playlistId);
      //   if (playlist) {
      //     playlist.song_count = (playlist.song_count || 0) + 1;
      //   }
      // });

      try {
        await apiClient.addSongsToPlaylist(playlistId, [songId]);

        eventBus.dispatchEvent(
          new CustomEvent("playlist:song-added", {
            detail: { playlistId, songId },
          })
        );
      } catch (error) {
        // revert optimistic update
        // TODO: implement optimistic rollback once mutate import is fixed
        // mutate(recentPlaylistsResource, (recent: any) => {
        //   const playlist = recent?.find((p: any) => p.id === playlistId);
        //   if (playlist) {
        //     playlist.song_count = Math.max(0, (playlist.song_count || 1) - 1);
        //   }
        // });
        throw error;
      }
    },

    // selective refresh methods - components can call what they need
    refreshSongs: () => refetchSongs(),
    refreshArtists: () => refetchArtists(),
    refreshAlbums: () => refetchAlbums(),
    refreshPlaylists: () => refetchPlaylists(),

    // tag lifecycle management - using bulk song update for now
    addTagToSongs: async (songIds: string[], tagName: string) => {
      try {
        // use existing bulk update API to add tags
        await apiClient.addTagsToSongs(songIds, [tagName]);

        // increment version to trigger availableTagsResource refresh
        // TODO: fix tagListVersion access once UI type is corrected
        // setStore("ui", "tagListVersion", (v: number) => v + 1);

        eventBus.dispatchEvent(
          new CustomEvent("song:tags-updated", {
            detail: { songIds, tagAdded: tagName },
          })
        );
      } catch (error) {
        console.error("failed to add tag to songs:", error);
        throw error;
      }
    },

    removeTagFromSongs: async (songIds: string[], tagName: string) => {
      try {
        await apiClient.removeTagsFromSongs(songIds, [tagName]);

        // increment version to trigger availableTagsResource refresh
        // TODO: fix tagListVersion access once UI type is corrected
        // setStore("ui", "tagListVersion", (v: number) => v + 1);

        eventBus.dispatchEvent(
          new CustomEvent("song:tags-updated", {
            detail: { songIds, tagRemoved: tagName },
          })
        );
      } catch (error) {
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
        // TODO: fix tagListVersion access once UI type is corrected
        // setStore("ui", "tagListVersion", (v: number) => v + 1); // refresh tags too
      });
    },
  };
}

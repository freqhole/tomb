import { batch } from "solid-js";
import type { FreqholeStore } from "./index";
import type { SetStoreFunction } from "solid-js/store";

// search actions for genre and playlist grouping
export function createSearchActions(
  store: FreqholeStore,
  setStore: SetStoreFunction<FreqholeStore>,
  apiClient: typeof import("../../../lib/api-client").apiClient
) {
  return {
    // main enhanced search function
    performSearch: async (
      searchParams?: Partial<FreqholeStore["search"]["params"]>
    ) => {
      setStore("search", "loading", true);

      try {
        // merge provided params with current store params
        const currentParams = store.search.params;
        const params = { ...currentParams, ...searchParams };

        // update params in store
        setStore("search", "params", params);

        const requestBody = {
          query: store.search.query || undefined,
          page: params.page,
          page_size: params.page_size,
          sort_by: params.sort_by,
          sort_direction: params.sort_direction,
          include_genres: params.include_genres,
          include_playlists: params.include_playlists,
        };

        const result = await apiClient.searchPost(requestBody);

        batch(() => {
          // update search results
          setStore("search", "results", {
            songs: result.songs || [],
            artists: extractArtistsFromSongs(result.songs || []),
            albums: extractAlbumsFromSongs(result.songs || []),
            genres: result.genres || [],
            playlists: result.playlists || [],
          });

          // update pagination info
          setStore("search", "pagination", {
            total_count: result.total_count || 0,
            total_pages: result.total_pages || 0,
            has_next: result.has_next || false,
            has_prev: result.has_prev || false,
            current_page: result.page || 1,
          });

          // update query time
          setStore("search", "query_time_ms", result.query_time_ms || 0);
        });

        return result;
      } catch (error) {
        console.error("failed to perform enhanced search:", error);
        throw error;
      } finally {
        setStore("search", "loading", false);
      }
    },

    // search parameter actions
    setSearchParams: (params: Partial<FreqholeStore["search"]["params"]>) => {
      setStore("search", "params", params);
    },

    enableGenreGrouping: () => {
      setStore("search", "params", "include_genres", true);
    },

    disableGenreGrouping: () => {
      setStore("search", "params", "include_genres", false);
    },

    enablePlaylistGrouping: () => {
      setStore("search", "params", "include_playlists", true);
    },

    disablePlaylistGrouping: () => {
      setStore("search", "params", "include_playlists", false);
    },

    toggleGenreGrouping: () => {
      const current = store.search.params.include_genres;
      setStore("search", "params", "include_genres", !current);
    },

    togglePlaylistGrouping: () => {
      const current = store.search.params.include_playlists;
      setStore("search", "params", "include_playlists", !current);
    },

    // pagination actions that work with enhanced search
    searchNextPage: async (actions: any) => {
      const currentPage = store.search.pagination.current_page;
      if (store.search.pagination.has_next && !store.search.loading) {
        return await actions.performSearch({
          page: currentPage + 1,
        });
      }
    },

    searchPrevPage: async (actions: any) => {
      const currentPage = store.search.pagination.current_page;
      if (store.search.pagination.has_prev && !store.search.loading) {
        return await actions.performSearch({
          page: currentPage - 1,
        });
      }
    },

    searchToPage: async (actions: any, page: number) => {
      if (
        page !== store.search.pagination.current_page &&
        !store.search.loading
      ) {
        return await actions.performSearch({
          page: page,
        });
      }
    },
  };
}

// helper function to extract unique artists from songs
function extractArtistsFromSongs(songs: any[]): any[] {
  const artistMap = new Map();

  songs.forEach((song) => {
    if (song.artist && !artistMap.has(song.artist)) {
      artistMap.set(song.artist, {
        name: song.artist,
        song_count: 1,
        albums: song.album ? [song.album] : [],
      });
    } else if (song.artist && artistMap.has(song.artist)) {
      const artist = artistMap.get(song.artist);
      artist.song_count++;
      if (song.album && !artist.albums.includes(song.album)) {
        artist.albums.push(song.album);
      }
    }
  });

  return Array.from(artistMap.values());
}

// helper function to extract unique albums from songs
function extractAlbumsFromSongs(songs: any[]): any[] {
  const albumMap = new Map();

  songs.forEach((song) => {
    const albumKey = `${song.album_artist || song.artist}-${song.album}`;
    if (song.album && !albumMap.has(albumKey)) {
      albumMap.set(albumKey, {
        title: song.album,
        artist: song.album_artist || song.artist,
        song_count: 1,
        year: song.year,
        thumbnail_blob_id: song.thumbnail_blob_id,
      });
    } else if (song.album && albumMap.has(albumKey)) {
      const album = albumMap.get(albumKey);
      album.song_count++;
    }
  });

  return Array.from(albumMap.values());
}

// mutation hooks for updating artists and albums
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { toast } from "../../components/feedback/Toast";
import { getDataSource } from "../data";
import { queryKeys } from "./queryKeys";

interface UpdateArtistData {
  artist_id: string;
  name?: string;
  bio?: string;
  entity_urls?: Array<{ id?: string | null; name?: string | null; url: string }>;
}

interface UpdateAlbumData {
  album_id: string;
  title?: string;
  artist_id?: string;
  artist_name?: string;
  album_type?: string;
  release_date?: string;
  label?: string;
  genre_ids?: string[];
  genres?: string[]; // new genre names to create
  entity_urls?: Array<{ id?: string | null; name?: string | null; url: string }>;
  merge_into_album_id?: string;
}

export function useUpdateArtistMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (data: UpdateArtistData) => {
      const dataSource = getDataSource();
      if (!dataSource.updateArtist) {
        throw new Error("current data source does not support updating artists");
      }

      await dataSource.updateArtist(data);
    },
    onSuccess: (_, variables) => {
      // invalidate related queries to refresh data
      queryClient.invalidateQueries({
        queryKey: queryKeys.artists.detail(variables.artist_id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });

      toast.success("artist updated");
    },
    onError: (error) => {
      console.error("failed to update artist:", error);
      toast.error("failed to update artist");
    },
  }));
}

export function useUpdateAlbumMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (data: UpdateAlbumData) => {
      const dataSource = getDataSource();
      if (!dataSource.updateAlbum) {
        throw new Error("current data source does not support updating albums");
      }

      const result = await dataSource.updateAlbum(data);
      // normalize: data sources may return `{ album_id }` (server canonical
      // id, which can differ from input after a rekey) or `void` (legacy).
      const newId = (result as { album_id?: string } | void)?.album_id ?? data.album_id;
      return { album_id: newId };
    },
    onSuccess: (result, variables) => {
      // invalidate related queries to refresh data
      queryClient.invalidateQueries({
        queryKey: queryKeys.albums.detail(variables.album_id),
      });
      // if the server rekeyed the album, invalidate the new id too so
      // any view that just navigated to it gets fresh data.
      if (result?.album_id && result.album_id !== variables.album_id) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.albums.detail(result.album_id),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.albums.songs(result.album_id),
        });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });

      // if this was a merge, also invalidate the target album detail and its songs
      if (variables.merge_into_album_id) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.albums.detail(variables.merge_into_album_id),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.albums.songs(variables.merge_into_album_id),
        });
      }

      toast.success(variables.merge_into_album_id ? "album merged" : "album updated");
    },
    onError: (error) => {
      console.error("failed to update album:", error);
      toast.error("failed to update album");
    },
  }));
}
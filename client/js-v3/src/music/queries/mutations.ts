// mutation hooks for updating artists and albums
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import { toast } from "../../components/feedback/Toast";
import { getDataSource } from "../data";
import { updateAlbumInCache, updateArtistInCache } from "./cacheUpdates";
import { queryKeys } from "./queryKeys";

interface UpdateArtistData {
  artist_id: string;
  name?: string;
  bio?: string;
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

      await dataSource.updateAlbum(data);
    },
    onSuccess: (_, variables) => {
      // invalidate related queries to refresh data
      queryClient.invalidateQueries({
        queryKey: queryKeys.albums.detail(variables.album_id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });

      toast.success("album updated");
    },
    onError: (error) => {
      console.error("failed to update album:", error);
      toast.error("failed to update album");
    },
  }));
}
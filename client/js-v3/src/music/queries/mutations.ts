// mutation hooks for updating artists and albums
import { createMutation, useQueryClient } from "@tanstack/solid-query";
import * as apiClient from "freqhole-api-client";
import { toast } from "../../components/feedback/Toast";
import { getCurrentRemote } from "../data";
import { updateAlbumInCache, updateArtistInCache } from "./cacheUpdates";
import { queryKeys } from "./queryKeys";

interface UpdateArtistData {
  artist_id: string;
  name?: string;
  image?: File;
}

interface UpdateAlbumData {
  album_id: string;
  title?: string;
  artist_id?: string;
  artist_name?: string;
  album_type?: string;
  release_date?: string;
  label?: string;
  genre_id?: string;
  genre?: string;
  sub_genre_ids?: string[];
  sub_genres?: string[];
  image?: File;
}

export function useUpdateArtistMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (data: UpdateArtistData) => {
      const remote = getCurrentRemote();
      if (!remote) throw new Error("no remote connected");

      console.log("updateArtist request:", data);

      // upload image first if provided
      if (data.image) {
        const formData = new FormData();
        formData.append("file", data.image);
        formData.append("entity_type", "artist");
        formData.append("entity_id", data.artist_id);

        const uploadResult = await apiClient.music.uploadImage(
          remote.base_url,
          formData,
        );

        console.log("image upload result:", uploadResult);

        if (!uploadResult.success) {
          throw new Error("failed to upload artist image");
        }
      }

      // build update request (only include changed fields)
      const request: apiClient.UpdateArtistRequest = {
        artist_id: data.artist_id,
        name: data.name ?? null,
        updated_by: null,
      };

      const result = await apiClient.music.updateArtist(
        remote.base_url,
        request,
      );

      console.log("updateArtist result:", result);

      if (!result.success) {
        console.error("updateArtist failed:", result);
        throw new Error("failed to update artist");
      }

      return result.data;
    },
    onSuccess: (updatedArtist) => {
      // update cache with new artist data
      updateArtistInCache(queryClient, updatedArtist.id, updatedArtist);

      // invalidate related queries to refresh data
      queryClient.invalidateQueries({
        queryKey: queryKeys.artists.detail(updatedArtist.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.artists.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.albums.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.all });

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
      const remote = getCurrentRemote();
      if (!remote) throw new Error("no remote connected");

      console.log("updateAlbum request:", data);

      // upload image first if provided
      if (data.image) {
        const formData = new FormData();
        formData.append("file", data.image);
        formData.append("entity_type", "album");
        formData.append("entity_id", data.album_id);

        const uploadResult = await apiClient.music.uploadImage(
          remote.base_url,
          formData,
        );

        console.log("image upload result:", uploadResult);

        if (!uploadResult.success) {
          throw new Error("failed to upload album image");
        }
      }

      // build update request (only include changed fields)
      const request: apiClient.UpdateAlbumRequest = {
        album_id: data.album_id,
        title: data.title ?? null,
        artist_id: data.artist_id ?? null,
        artist_name: data.artist_name ?? null,
        album_type: data.album_type ?? null,
        release_date: data.release_date ?? null,
        label: data.label ?? null,
        genre_id: data.genre_id ?? null,
        genre: data.genre ?? null,
        sub_genre_ids: data.sub_genre_ids ?? null,
        sub_genres: data.sub_genres ?? null,
        updated_by: null,
      };

      const result = await apiClient.music.updateAlbum(
        remote.base_url,
        request,
      );

      console.log("updateAlbum result:", result);

      if (!result.success) {
        console.error("updateAlbum failed:", result);
        throw new Error("failed to update album");
      }

      return result.data;
    },
    onSuccess: (updatedAlbum) => {
      // update cache with new album data
      updateAlbumInCache(queryClient, updatedAlbum.id, updatedAlbum);

      // invalidate related queries to refresh data
      queryClient.invalidateQueries({
        queryKey: queryKeys.albums.detail(updatedAlbum.id),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.albums.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.artists.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.all });

      toast.success("album updated");
    },
    onError: (error) => {
      console.error("failed to update album:", error);
      toast.error("failed to update album");
    },
  }));
}

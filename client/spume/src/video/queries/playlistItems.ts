// query + mutation hooks for video-typed items inside a (possibly mixed
// audio+video) playlist. remote: both songs and videos now live in the
// same domain-generic `playlist_itemz` table (grimoire's `entities` api),
// with one shared position space - this hook resolves just the
// `entity_type = "video"` slice of it to full video metadata.
//
// local (no remote) fallback: mirrors the remote shape using the unified
// local indexeddb `playlist_items` junction store (shared with songs -
// see music/services/storage/playlists.ts), since `Playlist` rows
// themselves only exist in that db locally.
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getRemoteClient } from "../../music/data";
import { queryKeys } from "../../music/queries/queryKeys";
import { initMusicDB } from "../../music/services/storage/db/init";
import {
  addVideoToLocalPlaylist,
  getLocalPlaylistVideoItems,
  removeVideoFromLocalPlaylist,
  reorderLocalPlaylistItems,
} from "../../music/services/storage/playlists";
import { getVideoDataSource } from "../data";
import type { VideoSummary } from "../data/types";
import { PlaylistItemDuplicateError } from "../../music/data/types";
import { videoQueryKeys } from "./queryKeys";

export interface PlaylistVideoItem {
  itemId: string;
  position: number;
  addedAt: number;
  video: VideoSummary;
}

function errorMessage(error: { issues?: { message?: string }[]; message?: string }): string {
  return error.issues?.[0]?.message || error.message || "request failed";
}

// the error_type is encoded as a path entry in the ZodError issues (see
// @freqhole/api-client's buildErrorIssue) - mirrors the same lookup
// UserProfileView.tsx already uses for `user_already_exists`.
function errorType(error: { issues?: { path?: unknown[] }[] }): string | undefined {
  return error.issues?.[0]?.path?.find(
    (p): p is string => typeof p === "string" && p !== "__auth_expired__"
  );
}

/** every video-typed item in a playlist, resolved to full video metadata
 * client-side. `list_playlist_items` intentionally returns lightweight
 * `{entity_type, entity_id}` refs only (no single-table JOIN is possible
 * since `entity_type` varies row-to-row), so each ref is resolved via a
 * per-id lookup here, the same fan-out-and-merge-client-side pattern
 * cross-remote search already uses. */
export function usePlaylistVideoItemsQuery(playlistId: Accessor<string | undefined>) {
  return createQuery(() => ({
    queryKey: videoQueryKeys.playlistItems.list(playlistId()),
    enabled: !!playlistId(),
    queryFn: async (): Promise<PlaylistVideoItem[]> => {
      const id = playlistId();
      if (!id) return [];
      const dataSource = getVideoDataSource();
      const client = await getRemoteClient();

      if (!client) {
        const db = await initMusicDB();
        const localItems = await getLocalPlaylistVideoItems(db, id);
        if (localItems.length === 0) return [];

        const resolved = await Promise.all(
          localItems.map(async (ref) => {
            const video = await dataSource.getVideoById(ref.video_id);
            if (!video) return null;
            const item: PlaylistVideoItem = {
              itemId: `${ref.playlist_id}:${ref.video_id}`,
              position: ref.position,
              addedAt: ref.added_at,
              video,
            };
            return item;
          })
        );

        return resolved
          .filter((item): item is PlaylistVideoItem => item !== null)
          .sort((a, b) => a.position - b.position);
      }

      const result = await client.entities.listPlaylistItems({ playlist_id: id });
      if (!result.success) return [];

      const videoRefs = result.data.filter((item) => item.entity_type === "video");
      if (videoRefs.length === 0) return [];

      const resolved = await Promise.all(
        videoRefs.map(async (ref) => {
          const video = await dataSource.getVideoById(ref.entity_id);
          if (!video) return null;
          const item: PlaylistVideoItem = {
            itemId: ref.id,
            position: ref.position,
            addedAt: ref.added_at,
            video,
          };
          return item;
        })
      );

      return resolved
        .filter((item): item is PlaylistVideoItem => item !== null)
        .sort((a, b) => a.position - b.position);
    },
  }));
}

export function useAddVideoToPlaylistMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: { playlistId: string; videoId: string }) => {
      const client = await getRemoteClient();
      if (!client) {
        const db = await initMusicDB();
        await addVideoToLocalPlaylist(db, params.playlistId, params.videoId);
        return;
      }
      const result = await client.entities.addPlaylistItem({
        playlist_id: params.playlistId,
        entity_type: "video",
        entity_id: params.videoId,
        position: null,
      });
      if (!result.success) {
        const message = errorMessage(result.error);
        if (errorType(result.error) === "duplicate_playlist_item") {
          throw new PlaylistItemDuplicateError(message);
        }
        throw new Error(message);
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: videoQueryKeys.playlistItems.list(variables.playlistId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all() });
    },
  }));
}

export function useRemoveVideoFromPlaylistMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: { playlistId: string; videoId: string }) => {
      const client = await getRemoteClient();
      if (!client) {
        const db = await initMusicDB();
        await removeVideoFromLocalPlaylist(db, params.playlistId, params.videoId);
        return;
      }
      const result = await client.entities.removePlaylistItem({
        playlist_id: params.playlistId,
        entity_type: "video",
        entity_id: params.videoId,
      });
      if (!result.success) throw new Error(errorMessage(result.error));
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: videoQueryKeys.playlistItems.list(variables.playlistId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all() });
    },
  }));
}

/** reorder every item (songs AND videos) in a playlist in one shared
 * position space. `orderedItems` must contain every item currently in
 * the playlist, in the desired new order (see grimoire's
 * ReorderPlaylistItemsRequest doc comment for why a full ordered list,
 * rather than a move-to-position delta, is required). invalidates both
 * the video-items query and the music songs query since either or both
 * may have moved. */
export function useReorderPlaylistItemsMutation() {
  const queryClient = useQueryClient();

  return createMutation(() => ({
    mutationFn: async (params: {
      playlistId: string;
      orderedItems: Array<{ entity_type: "song" | "video"; entity_id: string }>;
    }) => {
      const client = await getRemoteClient();
      if (!client) {
        const db = await initMusicDB();
        await reorderLocalPlaylistItems(db, params.playlistId, params.orderedItems);
        return;
      }
      const result = await client.entities.reorderPlaylistItems({
        playlist_id: params.playlistId,
        ordered_entity_refs: params.orderedItems,
      });
      if (!result.success) throw new Error(errorMessage(result.error));
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: videoQueryKeys.playlistItems.list(variables.playlistId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.playlists.songs(variables.playlistId),
      });
    },
  }));
}

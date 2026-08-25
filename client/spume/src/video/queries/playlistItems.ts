// query + mutation hooks for video-typed items inside a (possibly mixed
// audio+video) playlist. songs still live in the older, song-only
// `playlist_songz` table (see music/queries/playlists.ts); videos live in
// the newer, domain-generic `playlist_itemz` table exposed via grimoire's
// `entities` api when a remote is active — see
// docs/video-domain-round2-plan.md's "gap agent D" section for why these
// are two separate storage paths rather than one merged query/table.
//
// local (no remote) fallback: mirrors the remote shape using a local
// indexeddb junction table (`playlist_video_items`, in the music domain's
// local db alongside `playlist_songs` — see
// music/services/storage/playlists.ts), since `Playlist` rows themselves
// only exist in that db locally.
import { createMutation, createQuery, useQueryClient } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";
import { getRemoteClient } from "../../music/data";
import { queryKeys } from "../../music/queries/queryKeys";
import { initMusicDB } from "../../music/services/storage/db/init";
import {
  addVideoToLocalPlaylist,
  getLocalPlaylistVideoItems,
  removeVideoFromLocalPlaylist,
} from "../../music/services/storage/playlists";
import { getVideoDataSource } from "../data";
import type { VideoSummary } from "../data/types";
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

/** every video-typed item in a playlist, resolved to full video metadata
 * client-side. `list_playlist_items` intentionally returns lightweight
 * `{entity_type, entity_id}` refs only (no single-table JOIN is possible
 * since `entity_type` varies row-to-row) — see
 * docs/video-domain-phase2-3-api-routes.md's "open design point" note —
 * so each ref is resolved via a per-id lookup here, the same
 * fan-out-and-merge-client-side pattern cross-remote search already
 * uses. */
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

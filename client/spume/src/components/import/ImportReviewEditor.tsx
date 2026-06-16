// wrapper that connects ImportAlbumEditorPanel to the live api inside
// ImportReviewModal's renderAlbumEditor render prop.
//
// owns:
//   - per-album edit state (title, artist, songs, etc.)
//   - image upload against the remote
//
// "looks good" is handled by the modal footer which calls onMarkReviewed in
// App.tsx. that in turn calls patchAlbum (which saves edits + marks reviewed
// in one shot server-side). edit state here is kept live so patchAlbum always
// sends the current user-visible state.

import { createSignal, createEffect, createResource, onCleanup } from "solid-js";
import {
  ImportAlbumEditorPanel,
  type ImportAlbumEdit,
  type AlbumType,
} from "./ImportAlbumEditorPanel";
import type { AlbumEditorRenderProps } from "../modals/ImportReviewModal";
import { mbBrowserClient } from "../../lib/musicbrainzBrowserClient";
import { getClientForRemote } from "../../app/api/client";
import { toast } from "../feedback/Toast";
import type { CurrentRemoteInfo } from "../../music/data/currentState";
import type { ImportReviewHandle } from "../../music/hooks/useImportReview";
import type { ImportReviewAlbum } from "./ImportGroupingView";

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

function albumToEdit(album: ImportReviewAlbum): ImportAlbumEdit {
  return {
    title: album.title,
    artistName: album.artist ?? "",
    albumType: "album" as AlbumType,
    artworkBlobId: null,
    // artworkPreview is for newly-uploaded local data-URLs only;
    // existing remote artwork is shown via the existingArtwork* props below
    artworkPreview: null,
    entityUrls: (album.entityUrls ?? []).map((u) => ({
      id: u.id,
      name: u.name ?? "",
      url: u.url,
      isNew: false,
      isDeleted: false,
    })),
    images: album.images, // pass through so EntityImages can manage them
    songs: album.songs.map((s) => ({
      id: s.id,
      title: s.title,
      trackNumber: s.trackNumber ?? null,
      discNumber: s.discNumber ?? null,
      artistName: null,
      durationSeconds: s.durationSeconds ?? null,
    })),
  };
}

// -------------------------------------------------------------------------
// component
// -------------------------------------------------------------------------

export interface ImportReviewEditorProps extends AlbumEditorRenderProps {
  remote: CurrentRemoteInfo;
  reviewHandle: ImportReviewHandle;
  sessionId: string;
  /**
   * called on mount and whenever the album changes with the current save fn.
   * App.tsx uses this to flush edits before marking an album reviewed.
   */
  onRegisterSave: (albumId: string, save: () => Promise<void>) => void;
  onUnregisterSave: (albumId: string) => void;
}

export function ImportReviewEditor(props: ImportReviewEditorProps) {
  const [edit, setEdit] = createSignal<ImportAlbumEdit>(albumToEdit(props.album));

  // build the api client for the review's remote once - used by taxons editor
  // and other sub-components so they don't fall back to getCurrentRemote()
  const [reviewClient] = createResource(
    () => props.remote,
    (remote) => getClientForRemote(remote)
  );

  // reset edit state when the album changes
  createEffect(() => {
    setEdit(albumToEdit(props.album));
  });

  // register a save fn keyed by albumId so App.tsx can flush before marking reviewed
  createEffect(() => {
    const albumId = props.album.id;
    const saveFn = async () => {
      const e = edit();
      await props.reviewHandle.patchAlbum(albumId, {
        title: e.title || null,
        artist_name: e.artistName || null,
        album_type: e.albumType ?? null,
        release_date: null,
        label: null,
        songs: e.songs.map((s) => ({
          song_id: s.id,
          title: s.title ?? null,
          track_number: s.trackNumber ?? null,
          disc_number: s.discNumber ?? null,
          track_artist: s.artistName ?? null,
        })),
      });
    };
    props.onRegisterSave(albumId, saveFn);
    onCleanup(() => props.onUnregisterSave(albumId));
  });

  async function handleArtworkFilePicked(file: File) {
    try {
      const client = await getClientForRemote(props.remote);
      const result = await client.upload.image(file, {
        associate: {
          entity_type: "album",
          entity_id: props.album.id,
          is_primary: true,
        },
      });
      if (!result.success) {
        toast.error("artwork upload failed");
        return;
      }
      setEdit((prev) => ({
        ...prev,
        artworkBlobId: result.data.blob_id,
      }));
      // refetch to get updated images list
      props.reviewHandle.refetch();
    } catch (err) {
      toast.error(`artwork upload failed: ${(err as Error).message}`);
    }
  }

  async function handleImageUpload(file: File) {
    try {
      const client = await getClientForRemote(props.remote);
      const result = await client.upload.image(file, {
        associate: {
          entity_type: "album",
          entity_id: props.album.id,
          is_primary: (edit().images ?? []).length === 0,
        },
      });
      if (!result.success) {
        toast.error("image upload failed");
        return;
      }
      props.reviewHandle.refetch();
    } catch (err) {
      toast.error(`image upload failed: ${(err as Error).message}`);
    }
  }

  async function handleImageDelete(index: number) {
    const images = edit().images ?? [];
    const img = images[index];
    const blobId = img?.remote_blob_id ?? img?.local_blob_id;
    if (!blobId) return;
    try {
      const client = await getClientForRemote(props.remote);
      await client.music.deleteImage({
        entity_type: "album",
        entity_id: props.album.id,
        blob_id: blobId,
      });
      props.reviewHandle.refetch();
    } catch (err) {
      toast.error(`failed to remove image: ${(err as Error).message}`);
    }
  }

  async function handleImageSetPrimary(index: number) {
    const images = edit().images ?? [];
    const img = images[index];
    const blobId = img?.remote_blob_id ?? img?.local_blob_id;
    if (!blobId) return;
    try {
      const client = await getClientForRemote(props.remote);
      await client.music.setPrimaryImage({
        entity_type: "album",
        entity_id: props.album.id,
        blob_id: blobId,
      });
      props.reviewHandle.refetch();
    } catch (err) {
      toast.error(`failed to set primary image: ${(err as Error).message}`);
    }
  }

  return (
    <ImportAlbumEditorPanel
      value={edit()}
      onChange={setEdit}
      albumId={props.album.id}
      artistId={props.album.artistId ?? ""}
      existingArtworkUrl={props.album.artworkUrl ?? null}
      existingArtworkBlobId={props.album.artworkBlobId ?? null}
      existingArtworkServerId={props.album.remoteServerId ?? null}
      apiClient={reviewClient()}
      onArtworkFilePicked={(file) => void handleArtworkFilePicked(file)}
      onImageUpload={(file) => void handleImageUpload(file)}
      onImageDelete={(index) => void handleImageDelete(index)}
      onImageSetPrimary={(index) => void handleImageSetPrimary(index)}
      mbSearchFn={async (params) => {
        try {
          return await mbBrowserClient.searchReleases({
            artist: params.artist ?? undefined,
            release: params.release ?? undefined,
            limit: params.limit,
            offset: params.offset ?? undefined,
          });
        } catch {
          return null;
        }
      }}
      mbGetReleaseFn={(mbid) => mbBrowserClient.getRelease(mbid)}
      onAlbumUpdated={() => props.reviewHandle.refetch()}
    />
  );
}

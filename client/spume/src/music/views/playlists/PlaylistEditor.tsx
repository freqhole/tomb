// playlist editor - handles editing playlist metadata, images, and deletion
import { createSignal, Show } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { Button } from "../../../components/buttons/Button";
import { ConfirmDialog } from "../../../components/dialogs/ConfirmDialog";
import { toast } from "../../../components/feedback/Toast";
import { useDeletePlaylistMutation, useUpdatePlaylistMutation } from "../../queries/playlists";
import { queryKeys } from "../../queries/queryKeys";
import { getDataSource, getCurrentRemote } from "../../data";
import { getRemoteMediaUrl } from "../../../utils/urls";
import { canUpdatePlaylist, canDeletePlaylist } from "../../data/permissions";
import { pollJobUntilComplete } from "../../../app/services/jobs/jobService";
import type { Playlist, ImageMetadata } from "../../services/storage/types";
import { EntityImages } from "../../../components/layout/EntityImages";
import { EntityUrlz, type EntityUrlFormItem } from "../../../components/forms/EntityUrlz";

export interface PlaylistEditorProps {
  playlist: Playlist;
  onSaved?: () => void;
  onDeleted?: () => void;
  onCancelled?: () => void;
}

export function PlaylistEditor(props: PlaylistEditorProps) {
  const [editTitle, setEditTitle] = createSignal(props.playlist.title);
  const [editDescription, setEditDescription] = createSignal(props.playlist.description || "");
  const [playlistImages, setPlaylistImages] = createSignal(props.playlist.images || []);
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [uploadingImage, setUploadingImage] = createSignal(false);

  // entity URLs management - convert from storage type (id optional) to form type
  const [entityUrls, setEntityUrls] = createSignal<EntityUrlFormItem[]>(
    (props.playlist.urls || []).map((u) => ({ ...u, name: u.name || "" }))
  );
  const [initialEntityUrls, _setInitialEntityUrls] = createSignal<EntityUrlFormItem[]>(
    (props.playlist.urls || []).map((u) => ({ ...u, name: u.name || "" }))
  );

  const updatePlaylistMutation = useUpdatePlaylistMutation();
  const deletePlaylistMutation = useDeletePlaylistMutation();
  const queryClient = useQueryClient();

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("please select an image file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("image must be smaller than 10MB");
      return;
    }

    setUploadingImage(true);

    try {
      const datasource = getDataSource();
      const result = await datasource.uploadImage?.({
        file,
        entityType: "playlist",
        entityId: props.playlist.playlist_id,
      });

      if (!result) {
        toast.error("failed to upload image");
        return;
      }

      const { blob_id, job_id } = result;

      // poll for job completion
      const remote = getCurrentRemote();
      if (remote) {
        const pollResult = await pollJobUntilComplete(remote, job_id, 60_000);
        if (pollResult === "failed") {
          toast.error("image processing failed");
          return;
        }
        if (pollResult === "timeout") {
          toast.info("image processing taking a long time — check back later", {
            title: "processing queued",
          });
          return;
        }
      }

      // construct proper image metadata based on data source
      const currentImages = playlistImages();
      const isPrimary = currentImages.length === 0;
      let newImage: ImageMetadata;
      if (remote) {
        // remote upload - always use remote_blob_id + remote_server_id
        // only set remote_url for standard HTTP (not tauri-managed, which uses IPC)
        const remoteUrl =
          remote.base_url && !remote.is_charnel_managed
            ? getRemoteMediaUrl(remote.base_url, blob_id)
            : undefined;
        newImage = {
          remote_blob_id: blob_id,
          remote_url: remoteUrl,
          remote_server_id: remote.remote_id,
          is_primary: isPrimary,
          blob_type: "thumbnail",
        };
      } else {
        // local upload - use local field
        newImage = {
          local_blob_id: blob_id,
          is_primary: isPrimary,
          blob_type: "thumbnail",
        };
      }
      const updatedImages = [...currentImages, newImage];
      setPlaylistImages(updatedImages);

      // invalidate and refetch all playlist queries to show updated images
      await queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all() });
      await queryClient.refetchQueries({ queryKey: queryKeys.playlists.all() });
    } catch (error) {
      console.error("failed to upload image:", error);
      toast.error("failed to upload image");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleTogglePrimary = async (index: number) => {
    const imageToSet = playlistImages()[index];
    const blobId = imageToSet.remote_blob_id || imageToSet.local_blob_id;

    if (!blobId) {
      toast.error("no blob ID found for this image");
      return;
    }

    try {
      const datasource = getDataSource();
      await datasource.setPrimaryImage?.({
        entityType: "playlist",
        entityId: props.playlist.playlist_id,
        blobId,
      });

      const updated = playlistImages().map((img, i) => ({
        ...img,
        is_primary: i === index,
      }));
      setPlaylistImages(updated);

      // invalidate and refetch all playlist queries to show updated images
      await queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all() });
      await queryClient.refetchQueries({ queryKey: queryKeys.playlists.all() });
    } catch (err) {
      console.error("failed to update primary image:", err);
      toast.error("failed to update primary image");
    }
  };

  const handleRemoveImage = async (index: number) => {
    const imageToRemove = playlistImages()[index];
    const blobId = imageToRemove.remote_blob_id || imageToRemove.local_blob_id;

    if (!blobId) {
      toast.error("no blob ID found for this image");
      return;
    }

    try {
      const datasource = getDataSource();
      await datasource.removeImage?.({
        entityType: "playlist",
        entityId: props.playlist.playlist_id,
        blobId,
      });

      const updated = playlistImages().filter((_, i) => i !== index);

      if (updated.length > 0 && !updated.some((img) => img.is_primary)) {
        updated[0].is_primary = true;
      }

      setPlaylistImages(updated);

      // invalidate and refetch all playlist queries to show updated images
      await queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all() });
      await queryClient.refetchQueries({ queryKey: queryKeys.playlists.all() });
    } catch (err) {
      console.error("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  const handleSave = async () => {
    // helper to check if entity URLs have changed
    const urlsChanged = () => {
      const current = entityUrls();
      const initial = initialEntityUrls();
      const hasNewUrls = current.some((u) => u.isNew);
      const hasDeletedUrls = current.some((u) => u.isDeleted);
      if (hasNewUrls || hasDeletedUrls) return true;
      if (current.length !== initial.length) return true;
      return current.some((u, i) => {
        const prevUrl = initial[i];
        return !prevUrl || u.name !== prevUrl.name || u.url !== prevUrl.url;
      });
    };

    try {
      await updatePlaylistMutation.mutateAsync({
        playlistId: props.playlist.playlist_id,
        title: editTitle() || null,
        description: editDescription() || null,
        images: playlistImages(),
        // send entity URLs if changed (filter out deleted, map with null id for new)
        entity_urls: urlsChanged()
          ? entityUrls()
              .filter((u) => !u.isDeleted)
              .map((u) => ({ id: u.id || null, name: u.name || null, url: u.url }))
          : undefined,
      });

      props.onSaved?.();
    } catch (error) {
      console.error("failed to update playlist:", error);
      toast.error(error instanceof Error ? error.message : "failed to save changes", {
        title: "save failed",
      });
    }
  };

  const handleCancel = () => {
    props.onCancelled?.();
  };

  const handleDelete = async () => {
    const remote = getCurrentRemote();
    const playlistId = props.playlist?.playlist_id;
    const playlistTitle = props.playlist?.title;
    if (!playlistId) return;

    setIsDeleting(true);

    try {
      if (remote) {
        // delete remote playlist
        await deletePlaylistMutation.mutateAsync(playlistId);
      } else {
        // delete local playlist
        const dataSource = getDataSource();
        await dataSource.deletePlaylist?.(playlistId);

        // invalidate queries
        await queryClient.invalidateQueries({ queryKey: ["playlists"] });
      }

      toast.success(`deleted "${playlistTitle}"`, {
        title: "playlist deleted",
      });

      props.onDeleted?.();
    } catch (error) {
      console.error("failed to delete playlist:", error);
      toast.error(error instanceof Error ? error.message : "failed to delete playlist", {
        title: "delete failed",
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <>
      <div class="space-y-2 mb-3">
        <input
          type="text"
          class="w-full px-2 py-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-primary)] text-xl font-bold focus:outline-none focus:border-[var(--color-accent-500)]"
          value={editTitle()}
          onInput={(e) => setEditTitle(e.currentTarget.value)}
          placeholder="playlist title"
        />
        <textarea
          class="w-full px-2 py-1 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded text-[var(--color-text-secondary)] text-sm focus:outline-none focus:border-[var(--color-accent-500)] resize-none"
          rows="2"
          value={editDescription()}
          onInput={(e) => setEditDescription(e.currentTarget.value)}
          placeholder="description (optional)"
        />
        <div class="flex gap-2">
          <Show when={canUpdatePlaylist(props.playlist.created_by_id ?? null)}>
            <Button variant="primary" onClick={handleSave}>
              save
            </Button>
          </Show>
          <Button variant="secondary" onClick={handleCancel}>
            cancel
          </Button>
          <div class="flex-1" />
          <Show when={canDeletePlaylist(props.playlist.created_by_id ?? null)}>
            <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
              delete
            </Button>
          </Show>
        </div>
      </div>

      {/* images management */}
      <div class="mt-4">
        <EntityImages
          images={playlistImages()}
          onUpload={handleImageUpload}
          onDelete={handleRemoveImage}
          onSetPrimary={handleTogglePrimary}
          uploading={uploadingImage()}
          compact={true}
        />
      </div>

      {/* entity URLs */}
      <div class="mt-4">
        <EntityUrlz urls={entityUrls()} onChange={setEntityUrls} />
      </div>

      {/* delete confirmation dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm()}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="delete playlist"
        message={`are you sure you want to delete "${props.playlist?.title}"? this action cannot be undone.`}
        confirmText="delete"
        cancelText="cancel"
        variant="danger"
        loading={isDeleting()}
        alertVariant="warning"
      />
    </>
  );
}

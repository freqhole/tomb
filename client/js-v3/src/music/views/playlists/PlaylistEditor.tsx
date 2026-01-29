// playlist editor - handles editing playlist metadata, images, and deletion
import { createSignal, Show } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import { Button } from "../../../components/buttons/Button";
import { ConfirmDialog } from "../../../components/dialogs/ConfirmDialog";
import { toast } from "../../../components/feedback/Toast";
import {
  useDeletePlaylistMutation,
  useUpdatePlaylistMutation,
} from "../../queries/playlists";
import { getDataSource, getCurrentRemote } from "../../data";
import type { Playlist } from "../../services/storage/types";
import { EntityImages } from "../../../components/layout/EntityImages";

export interface PlaylistEditorProps {
  playlist: Playlist;
  onSaved?: () => void;
  onDeleted?: () => void;
  onCancelled?: () => void;
}

export function PlaylistEditor(props: PlaylistEditorProps) {
  const [editTitle, setEditTitle] = createSignal(props.playlist.title);
  const [editDescription, setEditDescription] = createSignal(
    props.playlist.description || "",
  );
  const [playlistImages, setPlaylistImages] = createSignal(
    props.playlist.images || [],
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = createSignal(false);
  const [isDeleting, setIsDeleting] = createSignal(false);
  const [uploadingImage, setUploadingImage] = createSignal(false);

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
      const blobId = await datasource.uploadImage?.({
        file,
        entityType: "playlist",
        entityId: props.playlist.playlist_id,
      });

      if (!blobId) {
        toast.error("failed to upload image");
        return;
      }

      const currentImages = playlistImages();
      const newImage: import("../../services/storage/types").ImageMetadata = {
        local_blob_id: blobId,
        remote_url: null,
        is_primary: currentImages.length === 0,
        blob_type: "thumbnail",
      };
      const updatedImages = [...currentImages, newImage];
      setPlaylistImages(updatedImages);

      toast.success("image uploaded successfully");

      await queryClient.invalidateQueries({
        queryKey: ["playlists"],
      });
    } catch (error) {
      console.error("failed to upload image:", error);
      toast.error("failed to upload image");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleTogglePrimary = async (index: number) => {
    const updated = playlistImages().map((img, i) => ({
      ...img,
      is_primary: i === index,
    }));
    setPlaylistImages(updated);

    // TODO: implement setPrimaryImage API endpoint
    try {
      toast.success("primary image updated");

      await queryClient.invalidateQueries({ queryKey: ["playlists"] });
    } catch (err) {
      console.error("failed to update primary image:", err);
      toast.error("failed to update primary image");
    }
  };

  const handleRemoveImage = async (index: number) => {
    const updated = playlistImages().filter((_, i) => i !== index);

    if (updated.length > 0 && !updated.some((img) => img.is_primary)) {
      updated[0].is_primary = true;
    }

    setPlaylistImages(updated);

    // TODO: implement removeImage API endpoint for playlists
    try {
      toast.success("image removed");

      await queryClient.invalidateQueries({ queryKey: ["playlists"] });
    } catch (err) {
      console.error("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  const handleSave = async () => {
    try {
      await updatePlaylistMutation.mutateAsync({
        playlistId: props.playlist.playlist_id,
        title: editTitle() || null,
        description: editDescription() || null,
      });

      toast.success("playlist updated", {
        title: "changes saved",
      });

      props.onSaved?.();
    } catch (error) {
      console.error("failed to update playlist:", error);
      toast.error(
        error instanceof Error ? error.message : "failed to save changes",
        { title: "save failed" },
      );
    }
  };

  const handleCancel = () => {
    props.onCancelled?.();
  };

  const handleDelete = async () => {
    const remote = getCurrentRemote();
    setIsDeleting(true);

    try {
      if (remote) {
        // delete remote playlist
        await deletePlaylistMutation.mutateAsync(props.playlist.playlist_id);
      } else {
        // delete local playlist
        const dataSource = getDataSource();
        await dataSource.deletePlaylist?.(props.playlist.playlist_id);

        // invalidate queries
        await queryClient.invalidateQueries({ queryKey: ["playlists"] });
      }

      toast.success(`deleted "${props.playlist.title}"`, {
        title: "playlist deleted",
      });

      props.onDeleted?.();
    } catch (error) {
      console.error("failed to delete playlist:", error);
      toast.error(
        error instanceof Error ? error.message : "failed to delete playlist",
        { title: "delete failed" },
      );
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
          <Button variant="primary" onClick={handleSave}>
            save
          </Button>
          <Button variant="secondary" onClick={handleCancel}>
            cancel
          </Button>
          <div class="flex-1" />
          <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
            delete
          </Button>
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

      {/* delete confirmation dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm()}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="delete playlist"
        message={`are you sure you want to delete "${props.playlist.title}"? this action cannot be undone.`}
        confirmText="delete"
        cancelText="cancel"
        variant="danger"
        loading={isDeleting()}
        alertVariant="warning"
      />
    </>
  );
}

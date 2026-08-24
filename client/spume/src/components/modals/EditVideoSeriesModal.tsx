// edit video series modal — title/description plus multi-image support
// (entity_imagez-backed, mirrors AlbumEditorModal.tsx's image handling).
// no legacy single-poster upload control: poster_blob_id now just mirrors
// whichever image is primary, kept in sync server-side.
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { Button } from "../buttons/Button";
import { TextInput } from "../forms/TextInput";
import { EntityImages } from "../layout/EntityImages";
import { toast } from "../feedback/Toast";
import { canUpdateVideo } from "../../video/data/permissions";
import { getVideoDataSource } from "../../video/data";
import { getCurrentRemote } from "../../music/data";
import { pollJobUntilComplete } from "../../app/services/jobs/jobService";
import type { ImageMetadata } from "../../music/services/storage/types";
import {
  useVideoSeriesDetailQuery,
  useUpdateVideoSeriesMutation,
} from "../../video/queries/series";
import { Modal } from "./Modal";

export interface EditVideoSeriesModalProps {
  seriesId: string;
  onClose: () => void;
  onSave?: () => void;
}

interface FormData {
  title: string;
  description: string;
}

export function EditVideoSeriesModal(props: EditVideoSeriesModalProps) {
  const detailQuery = useVideoSeriesDetailQuery(() => props.seriesId);
  const updateMutation = useUpdateVideoSeriesMutation();

  const [formData, setFormData] = createSignal<FormData>({ title: "", description: "" });
  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [loadedSeriesId, setLoadedSeriesId] = createSignal<string | null>(null);

  // images — fetched/mutated immediately (not deferred to save), mirrors
  // AlbumEditorModal.tsx's image handling
  const [images, setImages] = createSignal<ImageMetadata[]>([]);
  const [imageProcessing, setImageProcessing] = createSignal<string | null>(null);

  const fetchImages = async (seriesId: string) => {
    const dataSource = getVideoDataSource();
    if (!dataSource.getEntityImages) {
      setImages([]);
      return;
    }
    try {
      const imgs = await dataSource.getEntityImages({
        entityType: "video_series",
        entityId: seriesId,
      });
      setImages(imgs);
    } catch (err) {
      console.error("failed to fetch series images:", err);
      setImages([]);
    }
  };

  createEffect(() => {
    const series = detailQuery.data?.series;
    if (series && loadedSeriesId() !== props.seriesId) {
      const data: FormData = {
        title: series.title,
        description: series.description ?? "",
      };
      setFormData(data);
      setInitialData(data);
      setLoadedSeriesId(props.seriesId);
      void fetchImages(props.seriesId);
    }
  });

  const hasChanges = createMemo(() => {
    const initial = initialData();
    if (!initial) return false;
    const current = formData();
    return current.title !== initial.title || current.description !== initial.description;
  });

  const handleFieldChange = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // shared image upload logic for both File and file path (mirrors
  // AlbumEditorModal.tsx's handleImageUpload)
  const handleImageUpload = async (params: { file?: File; filePath?: string }) => {
    try {
      const dataSource = getVideoDataSource();
      if (!dataSource.uploadImage) {
        toast.error("image upload not supported");
        return;
      }

      setImageProcessing("uploading image...");

      const { job_id } = await dataSource.uploadImage({
        ...params,
        entityType: "video_series",
        entityId: props.seriesId,
        isPrimary: images().length === 0,
      });

      const remote = getCurrentRemote();
      if (remote && job_id) {
        setImageProcessing("processing image...");
        const pollResult = await pollJobUntilComplete(remote, job_id, 60_000, {
          onStage: (_stage, message) => setImageProcessing(message ?? "processing image..."),
        });
        if (pollResult === "failed") {
          toast.error("image processing failed");
          setImageProcessing(null);
          return;
        }
        if (pollResult === "timeout") {
          toast.info("image processing taking a long time — check back later", {
            title: "processing queued",
          });
          setImageProcessing(null);
          return;
        }
      }

      setImageProcessing(null);
      await fetchImages(props.seriesId);
    } catch (err) {
      console.error("failed to upload image:", err);
      toast.error("failed to upload image");
      setImageProcessing(null);
    }
  };

  const handleImageSelectPath = async (filePath: string) => {
    await handleImageUpload({ filePath });
  };

  const handleTogglePrimary = async (index: number) => {
    const image = images()[index];
    const blobId = image.remote_blob_id || image.local_blob_id;
    if (!blobId) {
      toast.error("no blob id found for this image");
      return;
    }

    try {
      const dataSource = getVideoDataSource();
      await dataSource.setPrimaryImage?.({
        entityType: "video_series",
        entityId: props.seriesId,
        blobId,
      });
      await fetchImages(props.seriesId);
    } catch (err) {
      console.error("failed to update primary image:", err);
      toast.error("failed to update primary image");
    }
  };

  const handleRemoveImage = async (index: number) => {
    const image = images()[index];
    const blobId = image.remote_blob_id || image.local_blob_id;
    if (!blobId) {
      toast.error("cannot delete image: missing blob id");
      return;
    }

    try {
      const dataSource = getVideoDataSource();
      if (!dataSource.removeImage) {
        toast.error("image removal not supported");
        return;
      }
      await dataSource.removeImage({
        entityType: "video_series",
        entityId: props.seriesId,
        blobId,
      });
      await fetchImages(props.seriesId);
    } catch (err) {
      console.error("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  const handleSave = async () => {
    const data = formData();
    try {
      await updateMutation.mutateAsync({
        series_id: props.seriesId,
        title: data.title,
        description: data.description || null,
      });
      toast.success("series updated");
      props.onSave?.();
    } catch (err) {
      console.error("failed to update video series:", err);
      toast.error("failed to update series");
    }
  };

  return (
    <Modal isOpen={true} onClose={props.onClose} title="edit series" size="lg" disableBackdropClose>
      <Show
        when={initialData()}
        fallback={
          <div class="flex items-center justify-center py-8 text-[var(--color-text-secondary)]">
            loading...
          </div>
        }
      >
        <div
          class="flex flex-col gap-6 p-4 overflow-y-auto"
          style={{ "max-height": "calc(80vh - 120px)" }}
        >
          <div>
            <label class="block text-sm text-[var(--color-text-secondary)] mb-1">title *</label>
            <TextInput
              value={formData().title}
              oninput={(e) => handleFieldChange("title", e.currentTarget.value)}
              placeholder="series title"
            />
          </div>

          <div>
            <label class="block text-sm text-[var(--color-text-secondary)] mb-1">description</label>
            <textarea
              value={formData().description}
              oninput={(e) => handleFieldChange("description", e.currentTarget.value)}
              placeholder="series description..."
              rows={4}
              class="w-full px-3 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] resize-none"
            />
          </div>

          {/* images */}
          <div class="border-t border-[var(--color-border-default)] pt-4">
            <EntityImages
              images={images()}
              onUpload={(file) => handleImageUpload({ file })}
              onUploadPath={handleImageSelectPath}
              onSetPrimary={handleTogglePrimary}
              onDelete={handleRemoveImage}
              uploading={imageProcessing() !== null}
              disabled={!canUpdateVideo()}
            />
            <Show when={imageProcessing()}>
              <p class="text-xs text-[var(--color-text-tertiary)] mt-1">{imageProcessing()}</p>
            </Show>
          </div>
        </div>
      </Show>

      <div class="flex items-center justify-end gap-2 p-4 border-t border-[var(--color-border-default)] flex-shrink-0">
        <Button onClick={props.onClose} variant="ghost">
          cancel
        </Button>
        <Show when={canUpdateVideo()}>
          <Button
            onClick={() => void handleSave()}
            variant="primary"
            disabled={!hasChanges() || updateMutation.isPending}
          >
            {updateMutation.isPending ? "saving..." : "save"}
          </Button>
        </Show>
      </div>
    </Modal>
  );
}

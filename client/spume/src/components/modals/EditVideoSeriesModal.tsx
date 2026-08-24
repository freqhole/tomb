// edit video series modal — title/description only, mirrors
// EditVideoModal.tsx's simplicity. no poster upload control yet: the
// video domain has no established single-blob image-upload pattern
// (EditVideoModal.tsx doesn't support poster editing for individual
// videos either) — the current poster is shown read-only.
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { Button } from "../buttons/Button";
import { TextInput } from "../forms/TextInput";
import { MediaImage } from "../media/MediaImage";
import { toast } from "../feedback/Toast";
import { canUpdateVideo } from "../../video/data/permissions";
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
          <div class="flex gap-4">
            <div class="w-24 h-24 bg-[var(--color-bg-elevated)] rounded-lg flex-shrink-0 overflow-hidden">
              <MediaImage
                blobId={detailQuery.data?.series.poster_blob_id}
                alt={detailQuery.data?.series.title ?? "series poster"}
                showFallback={true}
                thumbnailSize={200}
                class="w-full h-full object-cover"
              />
            </div>
            <div class="flex-1 space-y-4">
              <div>
                <label class="block text-sm text-[var(--color-text-secondary)] mb-1">title *</label>
                <TextInput
                  value={formData().title}
                  oninput={(e) => handleFieldChange("title", e.currentTarget.value)}
                  placeholder="series title"
                />
              </div>
            </div>
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

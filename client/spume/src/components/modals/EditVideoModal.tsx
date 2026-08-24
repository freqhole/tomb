// edit video modal — single-video metadata editor, mirrors
// SongEditorModal.tsx's shape but far simpler (no tabs/images/entity
// urls): title, description, episode number, release date. reuses the
// existing bulk `update_videos` route via useUpdateVideoMutation
// (video_ids: [video_id]) rather than a dedicated single-video route.
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { Button } from "../buttons/Button";
import { TextInput } from "../forms/TextInput";
import { toast } from "../feedback/Toast";
import { canUpdateVideo } from "../../video/data/permissions";
import { useUpdateVideoMutation, useVideoQuery } from "../../video/queries/videos";
import { Modal } from "./Modal";

export interface EditVideoModalProps {
  videoId: string;
  onClose: () => void;
  onSave?: () => void;
}

interface FormData {
  title: string;
  description: string;
  episode_number: number | null;
  release_date: string;
}

export function EditVideoModal(props: EditVideoModalProps) {
  const videoQuery = useVideoQuery(() => props.videoId);
  const updateMutation = useUpdateVideoMutation();

  const [formData, setFormData] = createSignal<FormData>({
    title: "",
    description: "",
    episode_number: null,
    release_date: "",
  });
  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [loadedVideoId, setLoadedVideoId] = createSignal<string | null>(null);

  createEffect(() => {
    const video = videoQuery.data;
    if (video && loadedVideoId() !== props.videoId) {
      const data: FormData = {
        title: video.title,
        description: video.description ?? "",
        episode_number: video.episode_number ?? null,
        release_date: video.release_date ?? "",
      };
      setFormData(data);
      setInitialData(data);
      setLoadedVideoId(props.videoId);
    }
  });

  const hasChanges = createMemo(() => {
    const initial = initialData();
    if (!initial) return false;
    const current = formData();
    return (
      current.title !== initial.title ||
      current.description !== initial.description ||
      current.episode_number !== initial.episode_number ||
      current.release_date !== initial.release_date
    );
  });

  const handleFieldChange = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    const data = formData();
    try {
      await updateMutation.mutateAsync({
        video_id: props.videoId,
        title: data.title,
        description: data.description || null,
        episode_number: data.episode_number,
        release_date: data.release_date || null,
      });
      toast.success("video updated");
      props.onSave?.();
    } catch (err) {
      console.error("failed to update video:", err);
      toast.error("failed to update video");
    }
  };

  return (
    <Modal isOpen={true} onClose={props.onClose} title="edit video" size="md" disableBackdropClose>
      <Show
        when={initialData()}
        fallback={
          <div class="flex items-center justify-center py-8 text-[var(--color-text-secondary)]">
            loading...
          </div>
        }
      >
        <div class="p-4 space-y-4">
          <div>
            <label class="block text-sm text-[var(--color-text-secondary)] mb-1">title *</label>
            <TextInput
              value={formData().title}
              oninput={(e) => handleFieldChange("title", e.currentTarget.value)}
              placeholder="video title"
            />
          </div>

          <div>
            <label class="block text-sm text-[var(--color-text-secondary)] mb-1">description</label>
            <textarea
              value={formData().description}
              oninput={(e) => handleFieldChange("description", e.currentTarget.value)}
              placeholder="video description..."
              rows={4}
              class="w-full px-3 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] resize-none"
            />
          </div>

          <div class="flex gap-2">
            <div class="flex-1">
              <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                episode number
              </label>
              <input
                type="number"
                value={formData().episode_number ?? ""}
                oninput={(e) =>
                  handleFieldChange(
                    "episode_number",
                    e.currentTarget.value === "" ? null : parseInt(e.currentTarget.value, 10)
                  )
                }
                min="1"
                placeholder="—"
                class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
              />
            </div>
            <div class="flex-1">
              <label class="block text-sm text-[var(--color-text-secondary)] mb-1">
                release date
              </label>
              <input
                type="date"
                value={formData().release_date}
                oninput={(e) => handleFieldChange("release_date", e.currentTarget.value)}
                class="w-full px-2 py-2 bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
              />
            </div>
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

export default EditVideoModal;

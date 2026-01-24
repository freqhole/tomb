// artist editor modal - edit artist metadata
import {
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Show,
} from "solid-js";
import * as apiClient from "freqhole-api-client";
import { getCurrentRemote } from "../../music/data";
import { useUpdateArtistMutation } from "../../music/queries/mutations";
import { useArtistQuery } from "../../music/queries/songs";
import { pollJobUntilComplete } from "../../utils/jobs";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";

interface ArtistEditorModalProps {
  artistId: string;
  onClose: () => void;
  onSave?: () => void;
  /** if true, hides buttons that would open other modals (prevents infinite recursion) */
  disableNestedModals?: boolean;
}

interface FormData {
  name: string;
  uploaded_blob_id: string | null;
}

export function ArtistEditorModal(props: ArtistEditorModalProps) {
  const artistQuery = useArtistQuery(() => props.artistId);
  const updateMutation = useUpdateArtistMutation();

  const [formData, setFormData] = createSignal<FormData>({
    name: "",
    uploaded_blob_id: null,
  });

  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [imagePreview, setImagePreview] = createSignal<string | null>(null);
  const [processingJob, setProcessingJob] = createSignal<{
    status: string;
    message: string;
  } | null>(null);

  // initialize form data when artist loads
  createEffect(() => {
    const artist = artistQuery.data;
    if (artist && !initialData()) {
      const data: FormData = {
        name: artist.name,
        uploaded_blob_id: null,
      };
      setFormData(data);
      setInitialData(data);

      // TODO: set image preview from artist's existing image if available
    }
  });

  // handle esc key to close modal
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const hasChanges = createMemo(() => {
    const current = formData();
    const initial = initialData();
    if (!initial) return false;

    return current.name !== initial.name || current.uploaded_blob_id !== null;
  });

  const handleSave = async () => {
    if (!hasChanges()) return;

    const data = formData();
    const initial = initialData();

    try {
      await updateMutation.mutateAsync({
        artist_id: props.artistId,
        name: data.name !== initial?.name ? data.name : undefined,
      });

      props.onSave?.();
      props.onClose();
    } catch (error) {
      console.error("failed to save artist:", error);
      // toast is already shown by mutation onError handler
    }
  };

  const handleReset = () => {
    const initial = initialData();
    if (initial) {
      setFormData({ ...initial });
      setImagePreview(null);
    }
  };

  const handleResetField = (field: keyof FormData) => {
    const initial = initialData();
    if (!initial) return;

    setFormData((prev) => ({
      ...prev,
      [field]: initial[field],
    }));

    if (field === "uploaded_blob_id") {
      setImagePreview(null);
      setProcessingJob(null);
    }
  };

  const handleImageSelect = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("please select an image file");
      return;
    }

    // validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("image must be smaller than 10MB");
      return;
    }

    // create preview immediately
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // upload immediately in background
    setProcessingJob({ status: "uploading", message: "uploading image..." });

    try {
      const remote = getCurrentRemote();
      if (!remote) {
        toast.error("no remote connected");
        setProcessingJob(null);
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("associate_with", JSON.stringify({
        entity_type: "artist",
        entity_id: props.artistId,
        is_primary: true,
      }));

      const uploadResult = await apiClient.music.uploadImage(
        remote.base_url,
        formData,
      );

      if (!uploadResult.success) {
        toast.error("failed to upload image");
        setProcessingJob(null);
        return;
      }

      const uploadData = uploadResult.data;
      console.log("image uploaded, job_id:", uploadData.job_id);

      // poll for job completion
      setProcessingJob({ status: "processing", message: "converting to webp..." });
      const jobCompleted = await pollJobUntilComplete(
        remote.base_url,
        uploadData.job_id,
      );

      if (jobCompleted) {
        setProcessingJob({ status: "completed", message: "done!" });
        // store the blob_id for later save
        setFormData((prev) => ({ ...prev, uploaded_blob_id: uploadData.blob_id }));
      } else {
        setProcessingJob({ status: "failed", message: "image processing timed out" });
      }
    } catch (error) {
      console.error("failed to upload image:", error);
      toast.error("image upload failed");
      setProcessingJob(null);
    }
  };

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={props.onClose}
    >
      <div
        class="bg-[var(--color-bg-elevated)] rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div class="flex items-center justify-between p-6 border-b border-[var(--color-border)]">
          <h2 class="text-xl font-semibold text-[var(--color-text-primary)]">
            edit artist
          </h2>
          <button
            onClick={props.onClose}
            class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <Icon name={IconNames.close} />
          </button>
        </div>

        {/* content */}
        <Show
          when={initialData()}
          fallback={
            <div class="flex-1 flex items-center justify-center p-6">
              <div class="text-[var(--color-text-secondary)]">loading...</div>
            </div>
          }
        >
          <div class="flex-1 overflow-y-auto p-6 space-y-6">
            {/* artist name */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                  artist name
                </label>
                <Show when={formData().name !== initialData()?.name}>
                  <button
                    onClick={() => handleResetField("name")}
                    class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    reset
                  </button>
                </Show>
              </div>
              <TextInput
                value={formData().name}
                onInput={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    name: e.currentTarget.value,
                  }))
                }
                placeholder="artist name"
                class="w-full"
              />
            </div>

            {/* artist image */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                  artist image
                </label>
                <Show when={formData().uploaded_blob_id !== null}>
                  <button
                    onClick={() => handleResetField("uploaded_blob_id")}
                    class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    reset
                  </button>
                </Show>
              </div>

              {/* image preview */}
              <Show when={imagePreview()}>
                <div class="w-32 h-32 rounded-lg overflow-hidden bg-[var(--color-bg-base)]">
                  <img
                    src={imagePreview()!}
                    alt="preview"
                    class="w-full h-full object-cover"
                  />
                </div>
              </Show>

              {/* processing status */}
              <Show when={processingJob()}>
                <div class="flex items-center gap-2 text-sm">
                  <Show when={processingJob()?.status !== "failed"} fallback={
                    <span class="text-[var(--color-error)]">❌</span>
                  }>
                    <Show when={processingJob()?.status === "completed"} fallback={
                      <div class="animate-spin h-4 w-4 border-2 border-[var(--color-accent-500)] border-t-transparent rounded-full" />
                    }>
                      <span class="text-green-500">✓</span>
                    </Show>
                  </Show>
                  <span class="text-[var(--color-text-secondary)]">
                    {processingJob()?.message}
                  </span>
                </div>
              </Show>

              {/* file input */}
              <div class="flex items-center gap-3">
                <label class="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    class="hidden"
                    disabled={processingJob() !== null}
                  />
                  <div class="px-4 py-2 bg-[var(--color-bg-base)] text-[var(--color-text-secondary)] rounded hover:bg-[var(--color-bg-hover)] text-sm">
                    {imagePreview() ? "change image" : "select image"}
                  </div>
                </label>
              </div>
              <p class="text-xs text-[var(--color-text-tertiary)]">
                recommended: square image, at least 500×500px, max 10MB
              </p>
            </div>
          </div>
        </Show>

        {/* footer */}
        <Show when={initialData()}>
          <div class="flex items-center justify-between p-6 border-t border-[var(--color-border)]">
            <Show when={hasChanges()}>
              <button
                onClick={handleReset}
                class="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              >
                reset all
              </button>
            </Show>
            <div class="flex items-center gap-3 ml-auto">
              <Button variant="secondary" onClick={props.onClose}>
                cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={!hasChanges()}
              >
                save changes
              </Button>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

// artist editor modal - edit artist metadata
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import type { ImageMetadata } from "../../music/services/storage/types";
import { updateArtist } from "../../music/services/storage/db";
import { getDataSource } from "../../music/data";
import { useUpdateArtistMutation } from "../../music/queries/mutations";
import { queryKeys } from "../../music/queries/queryKeys";
import { useArtistQuery } from "../../music/queries/songs";
import { pollJobUntilComplete } from "../../utils/jobs";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";
import { Tabs, TabList, Tab, TabPanel } from "../navigation/Tabs";
import MediaImage from "../media/MediaImage";
import { pushModal, popModal } from "../../music/modals";

interface ArtistEditorModalProps {
  artistId: string;
  onClose: () => void;
  onSave?: () => void;
  /** if true, hides buttons that would open other modals (prevents infinite recursion) */
  disableNestedModals?: boolean;
}

interface FormData {
  name: string;
  bio: string;
  uploaded_blob_id: string | null;
}

export function ArtistEditorModal(props: ArtistEditorModalProps) {
  const queryClient = useQueryClient();
  const artistQuery = useArtistQuery(() => props.artistId);
  const updateMutation = useUpdateArtistMutation();

  const [formData, setFormData] = createSignal<FormData>({
    name: "",
    bio: "",
    uploaded_blob_id: null,
  });

  const [initialData, setInitialData] = createSignal<FormData | null>(null);
  const [loadedArtistId, setLoadedArtistId] = createSignal<string | null>(null);
  const [activeTab, setActiveTab] = createSignal<"metadata" | "images">("metadata");
  const [images, setImages] = createSignal<ImageMetadata[]>([]);
  const [imagePreview, setImagePreview] = createSignal<string | null>(null);
  const [processingJob, setProcessingJob] = createSignal<{
    status: string;
    message: string;
  } | null>(null);

  // initialize form data when artist loads or when artistId changes
  createEffect(() => {
    const artist = artistQuery.data;
    // reinitialize if this is a different artist or first load
    if (artist && loadedArtistId() !== props.artistId) {
      const data: FormData = {
        name: artist.name,
        bio: artist.bio || "",
        uploaded_blob_id: null,
      };
      setFormData(data);
      setInitialData(data);
      setLoadedArtistId(props.artistId);

      // load artist images
      if (artist.images) {
        setImages(artist.images);
      }
    }
  });

  // register modal in stack for esc key handling
  onMount(() => {
    const modalId = `artist-${props.artistId}`;
    pushModal(modalId, props.onClose);
    return () => popModal(modalId);
  });

  const hasChanges = createMemo(() => {
    const current = formData();
    const initial = initialData();
    if (!initial) return false;

    return current.name !== initial.name || 
           current.bio !== initial.bio || 
           current.uploaded_blob_id !== null;
  });

  const handleSave = async () => {
    if (!hasChanges()) return;

    const data = formData();
    const initial = initialData();

    try {
      await updateMutation.mutateAsync({
        artist_id: props.artistId,
        name: data.name !== initial?.name ? data.name : undefined,
        bio: data.bio !== initial?.bio ? data.bio : undefined,
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

    try {
      const dataSource = getDataSource();
      if (!dataSource.uploadImage) {
        toast.error("image upload not supported");
        return;
      }

      setProcessingJob({ status: "uploading", message: "uploading image..." });

      const blobId = await dataSource.uploadImage({
        file,
        entityType: "artist",
        entityId: props.artistId,
        isPrimary: images().length === 0,
      });

      const newImage: ImageMetadata = {
        local_blob_id: blobId,
        is_primary: images().length === 0,
        type: "thumbnail",
      };

      const updatedImages = [...images(), newImage];
      setImages(updatedImages);

      await updateArtist(props.artistId, { images: updatedImages });

      setProcessingJob(null);
      toast.success("image uploaded");
      artistQuery.refetch();
      input.value = "";
    } catch (err) {
      console.error("failed to upload image:", err);
      toast.error("failed to upload image");
      setProcessingJob(null);
    }
  };

  const handleTogglePrimary = async (index: number) => {
    try {
      const updatedImages = images().map((img, i) => ({
        ...img,
        is_primary: i === index,
      }));
      setImages(updatedImages);

      await updateArtist(props.artistId, { images: updatedImages });

      toast.success("primary image updated");
      artistQuery.refetch();
    } catch (err) {
      console.error("failed to update primary image:", err);
      toast.error("failed to update primary image");
    }
  };

  const handleRemoveImage = async (index: number) => {
    try {
      const imageToRemove = images()[index];
      const updatedImages = images().filter((_, i) => i !== index);

      if (imageToRemove.is_primary && updatedImages.length > 0) {
        updatedImages[0].is_primary = true;
      }

      setImages(updatedImages);

      await updateArtist(props.artistId, { images: updatedImages });

      toast.success("image removed");
      artistQuery.refetch();
    } catch (err) {
      console.error("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center"
      classList={{ "z-50": !props.disableNestedModals, "z-[60]": props.disableNestedModals }}
    >
      <div
        class="bg-[var(--color-bg-elevated)] rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
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
          <Tabs activeTab={activeTab()} onTabChange={setActiveTab} class="flex-1 flex flex-col min-h-0">
            <TabList class="px-6">
              <Tab id="metadata" label="metadata" />
              <Tab id="images" label="images" badge={images().length || undefined} />
            </TabList>

            <TabPanel id="metadata" class="flex-1 overflow-y-auto p-6 space-y-6">
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

            {/* artist bio */}
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-[var(--color-text-primary)]">
                  biography
                </label>
                <Show when={formData().bio !== initialData()?.bio}>
                  <button
                    onClick={() => handleResetField("bio")}
                    class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  >
                    reset
                  </button>
                </Show>
              </div>
              <textarea
                value={formData().bio}
                onInput={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    bio: e.currentTarget.value,
                  }))
                }
                placeholder="artist biography..."
                class="w-full min-h-[120px] px-3 py-2 bg-[var(--color-bg-base)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] resize-vertical"
                rows={5}
              />
            </div>
              </TabPanel>

              <TabPanel id="images" class="flex-1 overflow-y-auto p-6">
                <div class="space-y-6">
                  <Show when={images().length > 0}>
                    <div class="space-y-4">
                      <h3 class="text-sm font-medium text-[var(--color-text-primary)]">
                        artist images ({images().length})
                      </h3>
                      <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        <For each={images()}>
                          {(image, index) => (
                            <div class="relative group">
                              <MediaImage
                                images={[image]}
                                alt={`artist image ${index() + 1}`}
                                domainType="artist"
                                class="w-full aspect-square object-cover rounded"
                              />
                              <div class="absolute top-2 left-2 flex gap-1">
                                <Show when={image.type}>
                                  <span class="px-2 py-0.5 text-xs bg-black/70 text-white rounded">
                                    {image.type}
                                  </span>
                                </Show>
                                <Show when={image.is_primary}>
                                  <span class="px-2 py-0.5 text-xs bg-blue-500 text-white rounded">
                                    primary
                                  </span>
                                </Show>
                              </div>
                              <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Show when={!image.is_primary}>
                                  <button
                                    onClick={() => handleTogglePrimary(index())}
                                    class="p-1.5 bg-black/70 hover:bg-black/90 text-white rounded"
                                    title="set as primary"
                                  >
                                    <Icon name={IconNames.star} size={16} />
                                  </button>
                                </Show>
                                <button
                                  onClick={() => handleRemoveImage(index())}
                                  class="p-1.5 bg-black/70 hover:bg-black/90 text-white rounded"
                                  title="remove image"
                                >
                                  <Icon name={IconNames.delete} size={16} />
                                </button>
                              </div>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  <div class="space-y-4">
                    <h3 class="text-sm font-medium text-[var(--color-text-primary)]">
                      add new image
                    </h3>
                    <Show
                      when={!processingJob()}
                      fallback={
                        <div class="p-4 bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-default)] text-center">
                          <div class="text-sm text-[var(--color-text-secondary)]">
                            {processingJob()?.message || "processing..."}
                          </div>
                        </div>
                      }
                    >
                      <label class="block">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageSelect}
                          class="hidden"
                        />
                        <div class="p-8 border-2 border-dashed border-[var(--color-border-default)] rounded hover:border-[var(--color-primary)] transition-colors cursor-pointer text-center">
                          <Icon
                            name={IconNames.upload}
                            size={32}
                            className="mx-auto mb-2 text-[var(--color-text-tertiary)]"
                          />
                          <div class="text-sm text-[var(--color-text-primary)]">
                            click to upload image
                          </div>
                          <div class="text-xs text-[var(--color-text-tertiary)] mt-1">
                            jpg, png, webp (max 10mb)
                          </div>
                        </div>
                      </label>
                    </Show>
                  </div>
                </div>
              </TabPanel>
          </Tabs>
        </Show>

        {/* footer */}
        <Show when={initialData() && activeTab() === "metadata"}>
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

// artist editor modal - edit artist metadata
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import type { ImageMetadata } from "../../music/services/storage/types";
import { getDataSource, getCurrentRemote } from "../../music/data";
import { getRemoteMediaUrl } from "../../utils/urls";
import { canUpdateArtist, canDeleteArtist } from "../../music/data/permissions";
import { useUpdateArtistMutation } from "../../music/queries/mutations";
import { queryKeys } from "../../music/queries/queryKeys";
import { useArtistQuery } from "../../music/queries/songs";
import { pollJobUntilComplete } from "../../app/services/jobs/jobService";
import { confirm } from "../../app/services/confirmState";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";
import { Tabs, TabList, Tab, TabPanel } from "../navigation/Tabs";
import { EntityImages } from "../layout/EntityImages";
import { pushModal, popModal } from "../../music/hooks/modals";
import { EntityUrlz, type EntityUrlFormItem } from "../forms/EntityUrlz";
import { error as errorLog } from "../../utils/logger";

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
  const [activeTab, setActiveTab] = createSignal<"info" | "images">("info");
  const [images, setImages] = createSignal<ImageMetadata[]>([]);

  // entity URLs management
  const [entityUrls, setEntityUrls] = createSignal<EntityUrlFormItem[]>([]);
  const [initialEntityUrls, setInitialEntityUrls] = createSignal<EntityUrlFormItem[]>([]);
  const [_imagePreview, setImagePreview] = createSignal<string | null>(null);
  const [processingJob, setProcessingJob] = createSignal<{
    status: string;
    message: string;
  } | null>(null);

  // initialize form data, images, and entity URLs when artist loads or when artistId changes
  // guarded by loadedArtistId to prevent refetchOnWindowFocus from wiping unsaved edits
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

      // sync images
      if (artist.images) {
        setImages(artist.images);
      }

      // sync entity URLs
      if (artist.urls) {
        const mapped = artist.urls.map((u) => ({
          id: u.id ?? undefined,
          name: u.name ?? "",
          url: u.url,
        }));
        setEntityUrls(mapped);
        setInitialEntityUrls(mapped);
      }

      setLoadedArtistId(props.artistId);
    }
  });

  // register modal in stack for esc key handling
  onMount(() => {
    const modalId = `artist-${props.artistId}`;
    pushModal(modalId, props.onClose);
    return () => popModal(modalId);
  });

  // helper to check if entity URLs have changed
  const urlsChanged = () => {
    const current = entityUrls();
    const initial = initialEntityUrls();

    // check for new or deleted URLs
    const hasNewUrls = current.some((u) => u.isNew);
    const hasDeletedUrls = current.some((u) => u.isDeleted);
    if (hasNewUrls || hasDeletedUrls) return true;

    // check for modified existing URLs
    for (let i = 0; i < current.length; i++) {
      const curr = current[i];
      const init = initial[i];
      if (!init) return true;
      if (curr.name !== init.name || curr.url !== init.url) return true;
    }

    return current.length !== initial.length;
  };

  const hasChanges = createMemo(() => {
    const current = formData();
    const initial = initialData();
    if (!initial) return false;

    return (
      current.name !== initial.name ||
      current.bio !== initial.bio ||
      current.uploaded_blob_id !== null ||
      urlsChanged()
    );
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
        // send entity URLs if changed (filter out deleted, map with null id for new)
        entity_urls: urlsChanged()
          ? entityUrls()
              .filter((u) => !u.isDeleted)
              .map((u) => ({ id: u.id || null, name: u.name || null, url: u.url }))
          : undefined,
      });

      props.onSave?.();
      props.onClose();
    } catch (error) {
      errorLog("failed to save artist:", error);
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

  const handleDelete = async () => {
    const artist = artistQuery.data;
    if (!artist) return;

    const confirmed = await confirm({
      title: "delete artist",
      message: `are you sure you want to delete "${artist.name}"? this will also delete all albums and songs by this artist. this cannot be undone.`,
      confirmText: "delete",
      variant: "danger",
    });

    if (confirmed) {
      try {
        const dataSource = getDataSource();
        if (dataSource.deleteArtist) {
          await dataSource.deleteArtist(props.artistId);
          toast.success(`deleted "${artist.name}"`);
          queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
          queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
          queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
          props.onClose();
        } else {
          toast.error("delete not supported for this data source");
        }
      } catch (error) {
        errorLog("failed to delete artist:", error);
        toast.error("failed to delete artist");
      }
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

  // shared image upload logic for both File and file path
  const handleImageUpload = async (params: { file?: File; filePath?: string }) => {
    try {
      const dataSource = getDataSource();
      if (!dataSource.uploadImage) {
        toast.error("image upload not supported");
        return;
      }

      setProcessingJob({ status: "uploading", message: "uploading image..." });

      const { blob_id, job_id } = await dataSource.uploadImage({
        ...params,
        entityType: "artist",
        entityId: props.artistId,
        isPrimary: images().length === 0,
      });

      // poll for job completion
      const remote = getCurrentRemote();
      if (remote) {
        setProcessingJob({ status: "processing", message: "processing image..." });
        const pollResult = await pollJobUntilComplete(remote, job_id, 10000);
        if (pollResult === "failed") {
          toast.error("image processing failed");
          setProcessingJob(null);
          return;
        }
        if (pollResult === "timeout") {
          toast.info("image processing taking a long time — check back later", {
            title: "processing queued",
          });
          setProcessingJob(null);
          return;
        }
      }

      // construct proper image metadata based on data source
      const isPrimary = images().length === 0;
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

      const updatedImages = [...images(), newImage];
      setImages(updatedImages);

      setProcessingJob(null);
      toast.success("image uploaded");
      artistQuery.refetch();
      // invalidate artist and song queries to update all views
      // songs display can include artist data
      queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
      queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
    } catch (err) {
      errorLog("failed to upload image:", err);
      toast.error("failed to upload image");
      setProcessingJob(null);
    }
  };

  const handleImageSelectPath = async (filePath: string) => {
    await handleImageUpload({ filePath });
  };

  const handleTogglePrimary = async (index: number) => {
    const imageToSet = images()[index];
    const blobId = imageToSet.remote_blob_id || imageToSet.local_blob_id;

    if (!blobId) {
      toast.error("no blob ID found for this image");
      return;
    }

    try {
      const datasource = getDataSource();
      await datasource.setPrimaryImage?.({
        entityType: "artist",
        entityId: props.artistId,
        blobId,
      });

      const updatedImages = images().map((img, i) => ({
        ...img,
        is_primary: i === index,
      }));
      setImages(updatedImages);

      toast.success("primary image updated");
      artistQuery.refetch();
      queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
    } catch (err) {
      errorLog("failed to update primary image:", err);
      toast.error("failed to update primary image");
    }
  };

  const handleRemoveImage = async (index: number) => {
    try {
      const imageToRemove = images()[index];
      const artistData = artistQuery.data;
      if (!artistData) return;

      const blobId = imageToRemove.remote_blob_id || imageToRemove.local_blob_id;
      if (!blobId) {
        errorLog("image missing blob ID:", imageToRemove);
        toast.error("cannot delete image: missing blob ID");
        return;
      }

      // call API to remove image association
      const dataSource = getDataSource();
      if (!dataSource.removeImage) {
        toast.error("image removal not supported");
        return;
      }
      await dataSource.removeImage({
        entityType: "artist",
        entityId: artistData.artist_id,
        blobId: blobId,
      });

      const updatedImages = images().filter((_, i) => i !== index);

      if (imageToRemove.is_primary && updatedImages.length > 0) {
        updatedImages[0].is_primary = true;
      }

      setImages(updatedImages);
      toast.success("image removed");
      artistQuery.refetch();
    } catch (err) {
      errorLog("failed to remove image:", err);
      toast.error("failed to remove image");
    }
  };

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center"
      classList={{ "z-50": !props.disableNestedModals, "z-[60]": props.disableNestedModals }}
    >
      <div class="bg-[var(--color-bg-primary)] rounded-lg shadow-xl w-full max-w-2xl h-[90dvh] wide:h-[600px] overflow-hidden flex flex-col">
        {/* header */}
        <div class="flex items-center justify-between p-6">
          <h2 class="text-xl font-semibold text-[var(--color-text-primary)]">edit artist</h2>
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
          <Tabs
            activeTab={activeTab()}
            onTabChange={setActiveTab}
            class="flex-1 flex flex-col min-h-0"
          >
            <TabList class="px-6">
              <Tab id="info" label="info" />
              <Tab id="images" label="images" badge={images().length || undefined} />
            </TabList>

            <TabPanel id="info" class="flex-1 overflow-y-auto p-6 space-y-6">
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
                  class="w-full min-h-[120px] px-3 py-2 bg-[var(--color-bg-base)] border border-[var(--color-border-default)] rounded-md text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)] resize-vertical"
                  rows={5}
                />
              </div>

              {/* entity URLs */}
              <div class="mt-4">
                <EntityUrlz urls={entityUrls()} onChange={setEntityUrls} />
              </div>
            </TabPanel>

            <TabPanel id="images" class="flex-1 overflow-y-auto p-6">
              <div class="space-y-6">
                <EntityImages
                  images={images()}
                  onUpload={(file) => handleImageUpload({ file })}
                  onUploadPath={handleImageSelectPath}
                  onDelete={handleRemoveImage}
                  onSetPrimary={handleTogglePrimary}
                  uploading={!!processingJob()}
                />
              </div>
            </TabPanel>
          </Tabs>
        </Show>

        {/* footer */}
        <Show when={initialData() && activeTab() === "info"}>
          <div class="flex items-center justify-between p-6">
            <Show when={canDeleteArtist()}>
              <Button onClick={handleDelete} variant="danger">
                delete
              </Button>
            </Show>
            <div class="flex items-center gap-3">
              <Show when={hasChanges() && canUpdateArtist()}>
                <button
                  onClick={handleReset}
                  class="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                >
                  reset all
                </button>
              </Show>
              <Button variant="secondary" onClick={props.onClose}>
                cancel
              </Button>
              <Show when={canUpdateArtist()}>
                <Button variant="primary" onClick={handleSave} disabled={!hasChanges()}>
                  save changes
                </Button>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

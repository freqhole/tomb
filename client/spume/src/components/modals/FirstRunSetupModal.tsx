// first-run setup modal — shown once on mobile (android/ios) charnel
// builds after the headless auto-init (`mobile_auto_init` in lib.rs)
// creates the default "admin" user and "local library" server name, so
// the user can pick something more personal: a real display name/
// username, a library name, and an optional library image.
//
// desktop already has an interactive setup wizard window for this (see
// `wizard.rs`) — this modal exists only to cover the gap on mobile, which
// boots headlessly with no wizard UI at all. renders inside the main
// spume view (not a standalone window) per the mobile UA-sniffing/first-
// run-flow discussion in docs/ios.md.
import { createSignal, Show, onCleanup } from "solid-js";
import { Modal } from "./Modal";
import { toast } from "../feedback/Toast";
import { debug } from "../../utils/logger";
import { pickFile } from "../../utils/filePicker";
import { getClientForRemote } from "../../app/api/client";
import { getTauriManagedRemote } from "../../app/services/remotes/remoteManager";
import { updateServerImage } from "../../app/services/charnel";
import { getCurrentUser } from "../../music/data";
import {
  getLocalLibraryName,
  setLocalLibraryName,
  setMobileFirstRunCompleted,
} from "../../app/services/storage/db";

export interface FirstRunSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FirstRunSetupModal(props: FirstRunSetupModalProps) {
  const [username, setUsername] = createSignal(getCurrentUser()?.username ?? "admin");
  const [libraryName, setLibraryName] = createSignal(getLocalLibraryName());
  const [imagePath, setImagePath] = createSignal<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onCleanup(() => {
    const url = imagePreviewUrl();
    if (url) URL.revokeObjectURL(url);
  });

  const handlePickImage = async () => {
    const picked = await pickFile({ kind: "image", title: "choose a library image" });
    if (!picked?.path) return;
    setImagePath(picked.path);
    const prevUrl = imagePreviewUrl();
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    setImagePreviewUrl(picked.file ? URL.createObjectURL(picked.file) : null);
  };

  const finish = async (skip: boolean) => {
    setSaving(true);
    setError(null);
    try {
      if (!skip) {
        const trimmedLibraryName = libraryName().trim();
        if (trimmedLibraryName.length > 0) {
          await setLocalLibraryName(trimmedLibraryName);
        }

        const trimmedUsername = username().trim();
        if (trimmedUsername.length > 0 && trimmedUsername !== getCurrentUser()?.username) {
          try {
            const selfRemote = await getTauriManagedRemote();
            if (selfRemote) {
              const client = await getClientForRemote(selfRemote);
              const result = await client.auth.updateUsername({ username: trimmedUsername });
              if (!result.success) {
                debug("FirstRunSetupModal", "updateUsername failed:", result.error);
                toast.error("couldn't set username - you can change it later in settings");
              }
            }
          } catch (err) {
            debug("FirstRunSetupModal", "updateUsername threw:", err);
            toast.error("couldn't set username - you can change it later in settings");
          }
        }

        const path = imagePath();
        if (path) {
          const result = await updateServerImage(path);
          if (!result?.success) {
            toast.error("couldn't set library image - you can change it later in settings");
          }
        }
      }

      await setMobileFirstRunCompleted();
      if (!skip) toast.success("library set up");
      props.onClose();
    } catch (err) {
      debug("FirstRunSetupModal", "first-run setup failed:", err);
      setError(err instanceof Error ? err.message : "setup failed - try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={() => void finish(true)}
      title="welcome to freqhole"
      size="sm"
      disableBackdropClose
    >
      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <p class="text-sm text-[var(--color-text-secondary)]">
          this device has its own local library. give it a name, pick a username, and optionally
          choose an image — you can change any of this later in settings.
        </p>

        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-[var(--color-text-secondary)]">your username</span>
          <input
            type="text"
            value={username()}
            onInput={(e) => setUsername(e.currentTarget.value)}
            disabled={saving()}
            class="px-3 py-2 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
            placeholder="admin"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs font-medium text-[var(--color-text-secondary)]">library name</span>
          <input
            type="text"
            value={libraryName()}
            onInput={(e) => setLibraryName(e.currentTarget.value)}
            disabled={saving()}
            class="px-3 py-2 rounded border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)]"
            placeholder="local library"
          />
        </label>

        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-[var(--color-text-secondary)]">
            library image (optional)
          </span>
          <div class="flex items-center gap-3">
            <Show
              when={imagePreviewUrl()}
              fallback={
                <div class="w-12 h-12 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] flex-shrink-0" />
              }
            >
              {(url) => (
                <img src={url()} alt="" class="w-12 h-12 rounded object-cover flex-shrink-0" />
              )}
            </Show>
            <button
              type="button"
              disabled={saving()}
              onClick={() => void handlePickImage()}
              class="px-3 py-2 text-sm rounded border border-[var(--color-border-default)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]"
            >
              choose image
            </button>
          </div>
        </div>

        <Show when={error()}>
          <p class="text-sm text-red-400">{error()}</p>
        </Show>
      </div>

      <div class="p-4 border-t border-[var(--color-border-default)] flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={saving()}
          onClick={() => void finish(true)}
          class="px-3 py-2 text-sm rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
        >
          skip for now
        </button>
        <button
          type="button"
          disabled={saving()}
          onClick={() => void finish(false)}
          class="px-4 py-2 text-sm rounded bg-[var(--color-accent-500)] text-white hover:bg-[var(--color-accent-400)] disabled:opacity-50"
        >
          {saving() ? "saving..." : "finish setup"}
        </button>
      </div>
    </Modal>
  );
}

// local library settings - android/ios only, since those platforms have
// no desktop-style setup wizard window to manage any of this (see
// client/charnel/src-tauri/src/wizard.rs). consolidates everything a
// mobile user would otherwise have no way to reach at all: the local
// library's display name/image, their own username, plus the two
// settings formerly stranded unconditionally (thumbnails) or awkwardly
// platform-gated (sync-to-local) inside StorageSettingsView - moved here
// instead of duplicated, with StorageSettingsView now hiding them
// specifically on mobile (desktop/web keep them where they already were,
// since neither of those needs this view at all).
import { createResource, createSignal, Show, onCleanup } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { toast } from "../../components/feedback/Toast";
import { debug } from "../../utils/logger";
import { pickFile } from "../../utils/filePicker";
import { getClientForRemote } from "../../app/api/client";
import { getTauriManagedRemote } from "../../app/services/remotes/remoteManager";
import { isHttpRemote } from "../../app/services/storage/schemas/remote";
import { isAndroidTauri, isIosTauri, updateServerImage } from "../../app/services/charnel";
import { getCurrentUser } from "../../music/data";
import {
  appState,
  getLocalLibraryName,
  setCroppedSquareThumbnails,
  setLocalLibraryName,
  setSyncQueueToLocal,
} from "../../app/services/storage/db";

export function LocalLibrarySettingsView() {
  const navigate = useNavigate();
  const isMobile = () => isAndroidTauri() || isIosTauri();

  // ---- username ----
  const [username, setUsername] = createSignal(getCurrentUser()?.username ?? "");
  const [usernameBusy, setUsernameBusy] = createSignal(false);
  const [usernameError, setUsernameError] = createSignal<string | null>(null);

  async function handleSaveUsername() {
    const next = username().trim();
    if (!next) {
      setUsernameError("username cannot be empty");
      return;
    }
    if (next === getCurrentUser()?.username) return;
    setUsernameBusy(true);
    setUsernameError(null);
    try {
      const selfRemote = await getTauriManagedRemote();
      if (!selfRemote) {
        setUsernameError("local library isn't ready yet - try again in a moment");
        return;
      }
      const client = await getClientForRemote(selfRemote);
      const result = await client.auth.updateUsername({ username: next });
      if (!result.success) {
        const errType = result.error?.issues?.[0]?.path?.find(
          (p): p is string => typeof p === "string" && p !== "__auth_expired__"
        );
        setUsernameError(
          errType === "user_already_exists"
            ? "that username is already taken"
            : (result.error?.issues?.[0]?.message ?? "failed to update username")
        );
        return;
      }
      toast.success("username updated");
    } catch (e) {
      debug("local-library-settings", "update username failed:", e);
      setUsernameError(e instanceof Error ? e.message : "failed to update username");
    } finally {
      setUsernameBusy(false);
    }
  }

  // ---- library name ----
  const [libraryName, setLibraryNameInput] = createSignal(getLocalLibraryName());
  const [libraryNameBusy, setLibraryNameBusy] = createSignal(false);

  async function handleSaveLibraryName() {
    const next = libraryName().trim();
    if (!next || next === getLocalLibraryName()) return;
    setLibraryNameBusy(true);
    try {
      await setLocalLibraryName(next);
      toast.success("library renamed");
    } catch (e) {
      debug("local-library-settings", "rename library failed:", e);
      toast.error("failed to rename library");
    } finally {
      setLibraryNameBusy(false);
    }
  }

  // ---- library image ----
  // the tauri-managed (charnel) remote always has `base_url: undefined`
  // ("uses IPC dispatch" - see `upsertTauriRemote` in remoteManager.ts) and
  // its `image_url` is ALREADY a complete, self-contained `asset://` url
  // (converted from a raw file path via tauri's `convertFileSrc`) - NOT a
  // relative server-route path meant to be prefixed with a base url the
  // way a real HTTP remote's would be. the previous version of this
  // function always concatenated `base_url + image_url` regardless,
  // which for this remote produced the literal broken string
  // `"undefinedasset://..."` - confirmed the actual cause of the broken-
  // image symptom, not a staleness/container issue at all. mirrors
  // `TopNav.tsx`'s own `httpImageUrl()`, which already gets this right:
  // check for an already-absolute url first, only prefix `base_url` for
  // a genuinely relative one (a plain non-charnel http remote).
  const [remote, { refetch: refetchRemote }] = createResource(getTauriManagedRemote);
  const existingImageUrl = () => {
    const r = remote();
    if (!r || !isHttpRemote(r) || !r.image_url) return null;
    const isAbsolute =
      r.image_url.startsWith("asset://") ||
      r.image_url.startsWith("http://") ||
      r.image_url.startsWith("https://");
    const base = isAbsolute ? r.image_url : `${r.base_url ?? ""}${r.image_url}`;
    // cache-bust on `updated_at` (mirrors `TopNav.tsx`'s avatar resolution)
    // so the <img> actually reloads after a save instead of being served
    // from cache at the same url with stale content.
    return r.updated_at ? `${base}?v=${r.updated_at}` : base;
  };
  const [imagePath, setImagePath] = createSignal<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = createSignal<string | null>(null);
  const [imageBusy, setImageBusy] = createSignal(false);
  // freshly-picked preview takes priority; otherwise fall back to
  // whatever image is already saved on the remote (previously never
  // shown at all - this view only ever rendered a picked-but-unsaved
  // preview, so an already-configured library image looked "missing").
  const displayedImageUrl = () => imagePreviewUrl() ?? existingImageUrl();

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

  async function handleSaveImage() {
    const path = imagePath();
    if (!path) return;
    setImageBusy(true);
    try {
      const result = await updateServerImage(path);
      if (!result?.success) {
        toast.error("failed to set library image");
        return;
      }
      toast.success("library image updated");
      setImagePath(null);
      // the just-saved image is now the "existing" one - drop the
      // picked-file preview (revoking its object url) and refetch so
      // `existingImageUrl()` picks up the new `image_url` instead.
      const prevUrl = imagePreviewUrl();
      if (prevUrl) URL.revokeObjectURL(prevUrl);
      setImagePreviewUrl(null);
      void refetchRemote();
    } catch (e) {
      debug("local-library-settings", "update image failed:", e);
      toast.error("failed to set library image");
    } finally {
      setImageBusy(false);
    }
  }

  return (
    <div class="p-4 wide:p-6">
      <div class="mb-6">
        <h1 class="text-xl font-semibold text-[var(--color-text-primary)]">local library</h1>
        <p class="text-sm text-[var(--color-text-muted)]">
          manage this device's library name, image, and your username.
        </p>
      </div>

      <Show
        when={isMobile()}
        fallback={
          <p class="text-sm text-[var(--color-text-muted)]">
            this view is only available on the android/ios app - see{" "}
            <button
              class="text-[var(--color-accent-500)] hover:underline"
              onClick={() => navigate("/settings/storage")}
            >
              storage settings
            </button>{" "}
            instead.
          </p>
        }
      >
        <div class="space-y-8 max-w-md">
          {/* username */}
          <section>
            <h2 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 uppercase tracking-wide">
              username
            </h2>
            <div class="space-y-2">
              <input
                type="text"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                placeholder="admin"
                disabled={usernameBusy()}
                class="w-full px-2 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]"
              />
              <Show when={usernameError()}>
                <p class="text-sm text-[var(--color-status-error)]">{usernameError()}</p>
              </Show>
              <button
                class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors disabled:opacity-50"
                onClick={() => void handleSaveUsername()}
                disabled={usernameBusy()}
              >
                {usernameBusy() ? "saving..." : "save"}
              </button>
            </div>
          </section>

          {/* library name */}
          <section>
            <h2 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 uppercase tracking-wide">
              library name
            </h2>
            <div class="space-y-2">
              <input
                type="text"
                value={libraryName()}
                onInput={(e) => setLibraryNameInput(e.currentTarget.value)}
                placeholder="local library"
                disabled={libraryNameBusy()}
                class="w-full px-2 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]"
              />
              <button
                class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors disabled:opacity-50"
                onClick={() => void handleSaveLibraryName()}
                disabled={libraryNameBusy()}
              >
                {libraryNameBusy() ? "saving..." : "save"}
              </button>
            </div>
          </section>

          {/* library image */}
          <section>
            <h2 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 uppercase tracking-wide">
              library image
            </h2>
            <div class="flex items-center gap-3">
              <Show
                when={displayedImageUrl()}
                fallback={
                  <div class="w-12 h-12 rounded bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] flex-shrink-0" />
                }
              >
                {(url) => (
                  <img src={url()} alt="" class="w-12 h-12 rounded object-cover flex-shrink-0" />
                )}
              </Show>
              <button
                type="button"
                disabled={imageBusy()}
                onClick={() => void handlePickImage()}
                class="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border-default)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)]"
              >
                choose image
              </button>
              <Show when={imagePath()}>
                <button
                  class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors disabled:opacity-50"
                  onClick={() => void handleSaveImage()}
                  disabled={imageBusy()}
                >
                  {imageBusy() ? "saving..." : "save"}
                </button>
              </Show>
            </div>
          </section>

          {/* sync settings - moved here from StorageSettingsView (mobile
              has no wizard window for this, so it needs a real home) */}
          <section>
            <h2 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 uppercase tracking-wide">
              sync settings
            </h2>
            <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-4">
              <div class="flex items-center justify-between">
                <div class="flex-1 min-w-0 mr-4">
                  <div class="text-sm text-[var(--color-text-primary)]">
                    save queue to local library
                  </div>
                  <p class="text-xs text-[var(--color-text-muted)] mt-1">
                    automatically save songs from remotes to your local library when they're added
                    to the queue. once saved, songs can be played offline.
                  </p>
                </div>
                <button
                  class={`relative w-11 h-6 rounded-full transition-colors ${
                    (appState()?.sync_queue_to_local ?? true)
                      ? "bg-[var(--color-accent-500)]"
                      : "bg-[var(--color-bg-tertiary)]"
                  }`}
                  onClick={() => setSyncQueueToLocal(!(appState()?.sync_queue_to_local ?? true))}
                >
                  <span
                    class={`absolute left-0 top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      (appState()?.sync_queue_to_local ?? true) ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>

          {/* display settings - same "moved here" reasoning */}
          <section>
            <h2 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 uppercase tracking-wide">
              display settings
            </h2>
            <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-4">
              <div class="flex items-center justify-between">
                <div class="flex-1 min-w-0 mr-4">
                  <div class="text-sm text-[var(--color-text-primary)]">
                    crop video thumbnails to square
                  </div>
                  <p class="text-xs text-[var(--color-text-muted)] mt-1">
                    when off, video thumbnails in the grid and table views letterbox instead of
                    cropping (the video detail view always shows the full poster).
                  </p>
                </div>
                <button
                  class={`relative w-11 h-6 rounded-full transition-colors ${
                    (appState()?.cropped_square_thumbnails ?? true)
                      ? "bg-[var(--color-accent-500)]"
                      : "bg-[var(--color-bg-tertiary)]"
                  }`}
                  onClick={() =>
                    setCroppedSquareThumbnails(!(appState()?.cropped_square_thumbnails ?? true))
                  }
                >
                  <span
                    class={`absolute left-0 top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                      (appState()?.cropped_square_thumbnails ?? true)
                        ? "translate-x-6"
                        : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>
        </div>
      </Show>
    </div>
  );
}

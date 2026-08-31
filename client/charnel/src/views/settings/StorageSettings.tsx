import { createSignal, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { resolvePath } from "../../util/resolvePath";

// fetched-music storage directory health check + reselect flow - see
// docs/flatpak-filesystem-access-plan.md (phase C). lives in settings
// rather than the setup wizard because the wizard only runs once on first
// boot, and a folder can go stale later (flatpak permission revoked,
// portal-brokered folder deleted/moved, etc).

/** removable-storage-independent "where does fetched music land" section:
 * shows the configured directory, probes it for real write access on
 * mount, and offers a "reselect folder" picker if the probe fails. isolated
 * from `ExternalStorageSettings.tsx` (that's for removable-disk sync, a
 * separate feature) and from `SettingsView.tsx` (keeps that file from
 * growing further). */
export default function StorageSettingsSection() {
  const [fetchMusicDir, setFetchMusicDir] = createSignal<string | null>(null);
  const [isWritable, setIsWritable] = createSignal(true);
  const [checked, setChecked] = createSignal(false);
  const [isFlatpak, setIsFlatpak] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [isError, setIsError] = createSignal(false);

  async function checkHealth() {
    try {
      const dir = await invoke<string | null>("get_fetch_music_dir");
      setFetchMusicDir(dir);
      if (dir) {
        setIsWritable(await invoke<boolean>("check_dir_writable", { path: dir }));
      }
    } catch (e) {
      console.error("failed to check fetch music dir health:", e);
    } finally {
      setChecked(true);
    }
  }

  onMount(async () => {
    setIsFlatpak(await invoke<boolean>("is_flatpak").catch(() => false));
    await checkHealth();
  });

  async function handleReselect() {
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const selected = await open({ multiple: false, directory: true });
      if (!selected) return;
      const resolved = await resolvePath(selected as string);
      const applied = await invoke<string>("update_fetch_music_dir", { path: resolved });
      setFetchMusicDir(applied);
      setIsWritable(true);
      setMessage("fetched music directory updated");
      setIsError(false);
    } catch (e) {
      setMessage(`failed to update fetched music directory: ${e}`);
      setIsError(true);
    } finally {
      setBusy(false);
      await checkHealth();
    }
  }

  return (
    <div class="settings-section" style={{ "margin-top": "2rem" }}>
      <h2>
        fetched musi<span class="pinky">c</span> storage
      </h2>
      <p
        style={{
          "font-size": "0.875rem",
          color: "var(--color-text-secondary, #888)",
          "margin-top": "1rem",
          "margin-bottom": "0.75rem",
        }}
      >
        where music fetched from remotes or uploaded via the web UI is saved.
      </p>

      <Show when={checked() && fetchMusicDir()}>
        <div style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
          <span
            style={{
              "font-size": "0.8125rem",
              color: "var(--color-text-muted, #666)",
              "word-break": "break-all",
            }}
          >
            {fetchMusicDir()}
          </span>

          <Show when={!isWritable()}>
            <div
              style={{
                "font-size": "0.8125rem",
                color: "var(--color-error-500, #ff4d6d)",
              }}
            >
              this directory isn't writable right now
              {isFlatpak()
                ? " - the flatpak portal grant for it may have gone stale (permission revoked, folder moved/deleted). reselect it below."
                : " - it may have been moved, deleted, or you no longer have permission to write to it."}
            </div>
          </Show>

          <button class="button" onClick={handleReselect} disabled={busy()}>
            {busy() ? "working..." : "reselect folder"}
          </button>
        </div>
      </Show>

      <Show when={message()}>
        <div
          style={{
            "font-size": "0.8125rem",
            color: isError()
              ? "var(--color-error-500, #ff4d6d)"
              : "var(--color-text-secondary, #888)",
            "margin-top": "0.5rem",
          }}
        >
          {message()}
        </div>
      </Show>
    </div>
  );
}

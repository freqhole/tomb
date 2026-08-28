import { createSignal, onMount, Show, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { resolvePath } from "../../util/resolvePath";

// removable-storage sync (tauri desktop only - see
// docs/removable-storage-sync-plan.md). talks to a single tauri command,
// `external_storage_command`, which dispatches on an `action` tag rather
// than registering one command per operation (see
// client/charnel/src-tauri/src/external_storage/commands.rs).

interface ExternalStorageDevice {
  id: string;
  path: string;
  volume_name: string | null;
  volume_uuid: string | null;
  subpath: string | null;
  last_synced_at: number | null;
}

interface ExternalStorageSettings {
  default_subpath: string;
  playlists_subpath: string;
  playlists_sync_enabled: boolean;
  reencode_enabled: boolean;
  reencode_args: string;
  reencode_extension: string;
}

interface DependencyCheckResult {
  ffmpeg_installed: boolean;
}

/** simple re-encode presets shown as a profile picker - covers the common
 * cases without making users hand-write an ffmpeg command. anything that
 * doesn't match one of these (e.g. hand-edited via "customize") shows as
 * "custom" in the picker instead. */
const REENCODE_PROFILES: Array<{ id: string; label: string; extension: string; args: string }> = [
  {
    id: "mp3",
    label: "mp3",
    extension: "mp3",
    args: "-i {input} -vn -c:a libmp3lame -q:a 2 -ar 44100 -y {output}",
  },
  {
    id: "opus",
    label: "opus",
    extension: "opus",
    args: "-i {input} -vn -c:a libopus -b:a 128k -ar 44100 -y {output}",
  },
];

function matchReencodeProfile(args: string, extension: string): string {
  const profile = REENCODE_PROFILES.find((p) => p.args === args && p.extension === extension);
  return profile?.id ?? "custom";
}

function externalStorageCommand<T>(action: Record<string, unknown>) {
  return invoke<T>("external_storage_command", { action });
}

/** removable-storage sync section of the settings view: pick/manage a
 * device (or several), set a per-device sub-path, and optionally
 * re-encode files with ffmpeg on the way out. isolated into its own
 * component so it doesn't keep piling onto `SettingsView.tsx`. */
export default function ExternalStorageSettingsSection() {
  const [mountedDevices, setMountedDevices] = createSignal<ExternalStorageDevice[]>([]);
  const [configuredDeviceCount, setConfiguredDeviceCount] = createSignal(0);
  const [activeDevice, setActiveDevice] = createSignal<ExternalStorageDevice | null>(null);
  const [externalSubpathDraft, setExternalSubpathDraft] = createSignal("");
  const [playlistsSubpathDraft, setPlaylistsSubpathDraft] = createSignal("");
  const [externalSettings, setExternalSettings] = createSignal<ExternalStorageSettings>({
    default_subpath: "Music",
    playlists_subpath: "Playlists",
    playlists_sync_enabled: true,
    reencode_enabled: false,
    reencode_args: "",
    reencode_extension: "mp3",
  });
  const [reencodeArgsDraft, setReencodeArgsDraft] = createSignal("");
  const [reencodeExtensionDraft, setReencodeExtensionDraft] = createSignal("mp3");
  const [reencodeProfile, setReencodeProfile] = createSignal("mp3");
  const [showAdvancedReencode, setShowAdvancedReencode] = createSignal(false);
  const [ffmpegInstalled, setFfmpegInstalled] = createSignal(true);
  const [externalStorageBusy, setExternalStorageBusy] = createSignal(false);
  const [externalStorageMessage, setExternalStorageMessage] = createSignal("");
  const [externalStorageIsError, setExternalStorageIsError] = createSignal(false);

  /** display name shown throughout the ui: the volume's name if we
   * resolved one, otherwise the final path component (e.g. a plain
   * folder used instead of a real removable disk). */
  function externalDeviceDisplayName(device: ExternalStorageDevice): string {
    if (device.volume_name) return device.volume_name;
    const parts = device.path.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? device.path;
  }

  onMount(async () => {
    try {
      const [mounted, active, settings, devices, deps] = await Promise.all([
        externalStorageCommand<ExternalStorageDevice[]>({
          action: "list_mounted",
        }),
        externalStorageCommand<ExternalStorageDevice | null>({
          action: "get_active",
        }),
        externalStorageCommand<ExternalStorageSettings>({
          action: "get_settings",
        }),
        externalStorageCommand<ExternalStorageDevice[]>({
          action: "get_devices",
        }),
        invoke<DependencyCheckResult>("check_dependencies"),
      ]);
      setMountedDevices(mounted);
      setActiveDevice(active);
      setExternalSubpathDraft(active?.subpath ?? "");
      setExternalSettings(settings);
      setPlaylistsSubpathDraft(settings.playlists_subpath);
      setReencodeArgsDraft(settings.reencode_args);
      setReencodeExtensionDraft(settings.reencode_extension);
      setReencodeProfile(matchReencodeProfile(settings.reencode_args, settings.reencode_extension));
      setConfiguredDeviceCount(devices.length);
      setFfmpegInstalled(deps.ffmpeg_installed);
    } catch (e) {
      console.error("failed to load external storage state:", e);
    }
  });

  async function refreshExternalStorageDevices() {
    try {
      const [mounted, active, devices] = await Promise.all([
        externalStorageCommand<ExternalStorageDevice[]>({
          action: "list_mounted",
        }),
        externalStorageCommand<ExternalStorageDevice | null>({
          action: "get_active",
        }),
        externalStorageCommand<ExternalStorageDevice[]>({
          action: "get_devices",
        }),
      ]);
      setMountedDevices(mounted);
      setActiveDevice(active);
      setExternalSubpathDraft(active?.subpath ?? "");
      setConfiguredDeviceCount(devices.length);
    } catch (e) {
      console.error("failed to refresh external storage devices:", e);
    }
  }

  async function handlePickExternalStorageDevice() {
    setExternalStorageBusy(true);
    setExternalStorageMessage("");
    setExternalStorageIsError(false);
    try {
      const selected = await open({ multiple: false, directory: true });
      if (!selected) return;
      const resolved = await resolvePath(selected as string);
      const device = await externalStorageCommand<ExternalStorageDevice>({
        action: "add_device",
        path: resolved,
        subpath: null,
      });
      setExternalStorageMessage(`device set: ${externalDeviceDisplayName(device)}`);
      await refreshExternalStorageDevices();
    } catch (e) {
      setExternalStorageMessage(`failed to set device: ${e}`);
      setExternalStorageIsError(true);
    } finally {
      setExternalStorageBusy(false);
    }
  }

  async function handleSelectActiveDevice(id: string) {
    setExternalStorageBusy(true);
    setExternalStorageMessage("");
    setExternalStorageIsError(false);
    try {
      await externalStorageCommand({ action: "set_active", id });
      await refreshExternalStorageDevices();
    } catch (e) {
      setExternalStorageMessage(`failed to select device: ${e}`);
      setExternalStorageIsError(true);
    } finally {
      setExternalStorageBusy(false);
    }
  }

  async function handleEjectExternalStorageDevice() {
    const device = activeDevice();
    if (!device) return;
    setExternalStorageBusy(true);
    setExternalStorageMessage("");
    setExternalStorageIsError(false);
    try {
      await externalStorageCommand({ action: "eject_device", id: device.id });
      setExternalStorageMessage(`ejected ${externalDeviceDisplayName(device)}`);
      await refreshExternalStorageDevices();
    } catch (e) {
      setExternalStorageMessage(`failed to eject device: ${e}`);
      setExternalStorageIsError(true);
    } finally {
      setExternalStorageBusy(false);
    }
  }

  async function handleForgetExternalStorageDevice() {
    const device = activeDevice();
    if (!device) return;
    setExternalStorageBusy(true);
    setExternalStorageMessage("");
    setExternalStorageIsError(false);
    try {
      await externalStorageCommand({ action: "remove_device", id: device.id });
      await refreshExternalStorageDevices();
    } catch (e) {
      setExternalStorageMessage(`failed to forget device: ${e}`);
      setExternalStorageIsError(true);
    } finally {
      setExternalStorageBusy(false);
    }
  }

  async function handleSaveExternalStorageSubpath() {
    const device = activeDevice();
    if (!device) return;
    setExternalStorageBusy(true);
    setExternalStorageMessage("");
    setExternalStorageIsError(false);
    try {
      const updated = await externalStorageCommand<ExternalStorageDevice>({
        action: "add_device",
        path: device.path,
        subpath: externalSubpathDraft() || null,
      });
      setActiveDevice(updated);
      setExternalSubpathDraft(updated.subpath ?? "");
      setExternalStorageMessage("sub-path updated");
    } catch (e) {
      setExternalStorageMessage(`failed to update sub-path: ${e}`);
      setExternalStorageIsError(true);
    } finally {
      setExternalStorageBusy(false);
    }
  }

  async function handleToggleExternalStorageReencode() {
    const newSettings: ExternalStorageSettings = {
      ...externalSettings(),
      reencode_enabled: !externalSettings().reencode_enabled,
    };
    setExternalSettings(newSettings);
    try {
      await externalStorageCommand({
        action: "set_settings",
        settings: newSettings,
      });
    } catch (e) {
      console.error("failed to save external storage settings:", e);
      setExternalSettings(externalSettings());
    }
  }

  async function handleToggleExternalStoragePlaylistsSync() {
    const newSettings: ExternalStorageSettings = {
      ...externalSettings(),
      playlists_sync_enabled: !externalSettings().playlists_sync_enabled,
    };
    setExternalSettings(newSettings);
    try {
      await externalStorageCommand({
        action: "set_settings",
        settings: newSettings,
      });
    } catch (e) {
      console.error("failed to save external storage settings:", e);
      setExternalSettings(externalSettings());
    }
  }

  async function handleSaveExternalStoragePlaylistsSubpath() {
    const newSettings: ExternalStorageSettings = {
      ...externalSettings(),
      playlists_subpath: playlistsSubpathDraft() || "Playlists",
    };
    setExternalStorageBusy(true);
    setExternalStorageMessage("");
    setExternalStorageIsError(false);
    try {
      await externalStorageCommand({
        action: "set_settings",
        settings: newSettings,
      });
      // the backend sanitizes the sub-path for fat32/exfat safety, so
      // re-fetch rather than trusting what we sent.
      const saved = await externalStorageCommand<ExternalStorageSettings>({
        action: "get_settings",
      });
      setExternalSettings(saved);
      setPlaylistsSubpathDraft(saved.playlists_subpath);
      setExternalStorageMessage("playlists path updated");
    } catch (e) {
      setExternalStorageMessage(`failed to update playlists path: ${e}`);
      setExternalStorageIsError(true);
    } finally {
      setExternalStorageBusy(false);
    }
  }

  async function handleSelectReencodeProfile(profileId: string) {
    const profile = REENCODE_PROFILES.find((p) => p.id === profileId);
    if (!profile) return; // "custom" is a read-only display state, not user-selectable
    const newSettings: ExternalStorageSettings = {
      ...externalSettings(),
      reencode_args: profile.args,
      reencode_extension: profile.extension,
    };
    setExternalStorageBusy(true);
    setExternalStorageMessage("");
    setExternalStorageIsError(false);
    try {
      await externalStorageCommand({
        action: "set_settings",
        settings: newSettings,
      });
      setExternalSettings(newSettings);
      setReencodeArgsDraft(profile.args);
      setReencodeExtensionDraft(profile.extension);
      setReencodeProfile(profile.id);
      setExternalStorageMessage(`re-encode profile set to ${profile.label}`);
    } catch (e) {
      setExternalStorageMessage(`failed to update re-encode profile: ${e}`);
      setExternalStorageIsError(true);
    } finally {
      setExternalStorageBusy(false);
    }
  }

  async function handleSaveExternalStorageReencodeArgs() {
    const newSettings: ExternalStorageSettings = {
      ...externalSettings(),
      reencode_args: reencodeArgsDraft(),
      reencode_extension: reencodeExtensionDraft() || "mp3",
    };
    setExternalStorageBusy(true);
    setExternalStorageMessage("");
    setExternalStorageIsError(false);
    try {
      await externalStorageCommand({
        action: "set_settings",
        settings: newSettings,
      });
      setExternalSettings(newSettings);
      setReencodeProfile(
        matchReencodeProfile(newSettings.reencode_args, newSettings.reencode_extension),
      );
      setExternalStorageMessage("re-encode command updated");
    } catch (e) {
      setExternalStorageMessage(`failed to update re-encode command: ${e}`);
      setExternalStorageIsError(true);
    } finally {
      setExternalStorageBusy(false);
    }
  }

  return (
    <div class="settings-section" style={{ "margin-top": "2rem" }}>
      <h2>
        external storag<span class="pinky">e</span>
      </h2>
      <p
        style={{
          "font-size": "0.875rem",
          color: "var(--color-text-secondary, #888)",
          "margin-top": "1rem",
          "margin-bottom": "0.75rem",
        }}
      >
        sync music to a removable disk or any mounted folder. the playerbar's storage icon shows up
        when a device is plugged in.
      </p>

      <Show
        when={mountedDevices().length > 0}
        fallback={
          <button
            class="button"
            onClick={handlePickExternalStorageDevice}
            disabled={externalStorageBusy()}
          >
            {externalStorageBusy() ? "working..." : "choose device"}
          </button>
        }
      >
        <Show when={mountedDevices().length > 1}>
          <div class="form-group" style={{ "margin-bottom": "1rem" }}>
            <label
              style={{
                display: "block",
                "margin-bottom": "0.25rem",
                "font-size": "0.875rem",
                color: "var(--color-text-secondary, #888)",
              }}
            >
              multiple devices plugged in - pick one to manage
            </label>
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "0.5rem",
              }}
            >
              <For each={mountedDevices()}>
                {(device) => (
                  <button
                    class={`button ${activeDevice()?.id === device.id ? "primary" : "secondary"}`}
                    onClick={() => handleSelectActiveDevice(device.id)}
                    disabled={externalStorageBusy()}
                    style={{
                      display: "block",
                      width: "100%",
                      "text-align": "left",
                      padding: "0.625rem 0.75rem",
                    }}
                  >
                    {externalDeviceDisplayName(device)}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={activeDevice()}>
          {(device) => (
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "0.5rem",
              }}
            >
              <div>
                <span style={{ "font-weight": "500" }}>{externalDeviceDisplayName(device())}</span>
                <span
                  style={{
                    "font-size": "0.8125rem",
                    color: "var(--color-text-muted, #666)",
                    "margin-left": "0.5rem",
                  }}
                >
                  {device().path}
                </span>
              </div>

              <div class="form-group">
                <label
                  for="external-storage-subpath"
                  style={{
                    display: "block",
                    "margin-bottom": "0.25rem",
                    "font-size": "0.875rem",
                    color: "var(--color-text-secondary, #888)",
                  }}
                >
                  sub-path on this device (default: {externalSettings().default_subpath})
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    id="external-storage-subpath"
                    type="text"
                    placeholder={externalSettings().default_subpath}
                    value={externalSubpathDraft()}
                    onInput={(e) => setExternalSubpathDraft(e.currentTarget.value)}
                    style={{ width: "100%", "max-width": "240px" }}
                  />
                  <button
                    class="button"
                    onClick={handleSaveExternalStorageSubpath}
                    disabled={externalStorageBusy()}
                  >
                    save
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  class="button secondary"
                  onClick={handleEjectExternalStorageDevice}
                  disabled={externalStorageBusy()}
                >
                  eject
                </button>
                <button
                  class="button secondary"
                  onClick={handleForgetExternalStorageDevice}
                  disabled={externalStorageBusy()}
                >
                  forget device
                </button>
                <button
                  class="button secondary"
                  onClick={handlePickExternalStorageDevice}
                  disabled={externalStorageBusy()}
                >
                  add another device
                </button>
              </div>
            </div>
          )}
        </Show>
      </Show>

      <Show when={configuredDeviceCount() > 0}>
        <div
          style={{
            "margin-top": "1.5rem",
            "padding-top": "1rem",
            "border-top": "1px solid var(--color-border, #333)",
          }}
        >
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "1rem",
            }}
          >
            <button
              class={`toggle-button ${externalSettings().playlists_sync_enabled ? "active" : ""}`}
              onClick={handleToggleExternalStoragePlaylistsSync}
              style={{
                flex: "none",
                width: "44px",
                height: "24px",
                "border-radius": "12px",
                border: "none",
                padding: "0",
                background: externalSettings().playlists_sync_enabled
                  ? "var(--color-accent-500, #ff69b4)"
                  : "var(--color-bg-tertiary, #333)",
                cursor: "pointer",
                position: "relative",
                transition: "background 0.2s",
                "flex-shrink": "0",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "4px",
                  left: externalSettings().playlists_sync_enabled ? "24px" : "4px",
                  width: "16px",
                  height: "16px",
                  "border-radius": "50%",
                  background: "white",
                  transition: "left 0.2s",
                }}
              />
            </button>
            <div>
              <div style={{ "font-weight": "500" }}>sync playlists</div>
              <div
                style={{
                  "font-size": "0.875rem",
                  color: "var(--color-text-secondary, #888)",
                  "margin-top": "0.25rem",
                }}
              >
                on by default - writes `.m3u8` playlist files alongside the synced songs. applies to
                every device.
              </div>
            </div>
          </div>

          <Show when={externalSettings().playlists_sync_enabled}>
            <div class="form-group" style={{ "margin-top": "0.75rem" }}>
              <label
                for="external-storage-playlists-subpath"
                style={{
                  display: "block",
                  "margin-bottom": "0.25rem",
                  "font-size": "0.875rem",
                  color: "var(--color-text-secondary, #888)",
                }}
              >
                path for playlists on each device (default: /Playlists/)
              </label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  id="external-storage-playlists-subpath"
                  type="text"
                  placeholder="Playlists"
                  value={playlistsSubpathDraft()}
                  onInput={(e) => setPlaylistsSubpathDraft(e.currentTarget.value)}
                  style={{ width: "100%", "max-width": "240px" }}
                />
                <button
                  class="button"
                  onClick={handleSaveExternalStoragePlaylistsSubpath}
                  disabled={externalStorageBusy()}
                >
                  save
                </button>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={externalStorageMessage()}>
        <div
          style={{
            "font-size": "0.8125rem",
            color: externalStorageIsError()
              ? "var(--color-error-500, #ff4d6d)"
              : "var(--color-text-secondary, #888)",
            "margin-top": "0.5rem",
          }}
        >
          {externalStorageMessage()}
        </div>
      </Show>

      <Show when={configuredDeviceCount() > 0 && !ffmpegInstalled()}>
        <div
          style={{
            "margin-top": "1.5rem",
            "padding-top": "1rem",
            "border-top": "1px solid var(--color-border, #333)",
            "font-size": "0.8125rem",
            color: "var(--color-text-secondary, #888)",
          }}
        >
          ffmpeg isn't installed, so re-encoding on sync isn't available (raw file bytes are always
          copied as-is).
        </div>
      </Show>

      <Show when={configuredDeviceCount() > 0 && ffmpegInstalled()}>
        <div
          style={{
            "margin-top": "1.5rem",
            "padding-top": "1rem",
            "border-top": "1px solid var(--color-border, #333)",
          }}
        >
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "1rem",
            }}
          >
            <button
              class={`toggle-button ${externalSettings().reencode_enabled ? "active" : ""}`}
              onClick={handleToggleExternalStorageReencode}
              style={{
                flex: "none",
                width: "44px",
                height: "24px",
                "border-radius": "12px",
                border: "none",
                padding: "0",
                background: externalSettings().reencode_enabled
                  ? "var(--color-accent-500, #ff69b4)"
                  : "var(--color-bg-tertiary, #333)",
                cursor: "pointer",
                position: "relative",
                transition: "background 0.2s",
                "flex-shrink": "0",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "4px",
                  left: externalSettings().reencode_enabled ? "24px" : "4px",
                  width: "16px",
                  height: "16px",
                  "border-radius": "50%",
                  background: "white",
                  transition: "left 0.2s",
                }}
              />
            </button>
            <div>
              <div style={{ "font-weight": "500" }}>re-encode with ffmpeg</div>
              <div
                style={{
                  "font-size": "0.875rem",
                  color: "var(--color-text-secondary, #888)",
                  "margin-top": "0.25rem",
                }}
              >
                off by default (raw file bytes are copied as-is). applies to every device.
              </div>
            </div>
          </div>

          <Show when={externalSettings().reencode_enabled}>
            <div class="form-group" style={{ "margin-top": "0.75rem" }}>
              <label
                for="external-storage-reencode-profile"
                style={{
                  display: "block",
                  "margin-bottom": "0.25rem",
                  "font-size": "0.875rem",
                  color: "var(--color-text-secondary, #888)",
                }}
              >
                format
              </label>
              <select
                id="external-storage-reencode-profile"
                value={reencodeProfile()}
                disabled={externalStorageBusy()}
                onChange={(e) => void handleSelectReencodeProfile(e.currentTarget.value)}
                style={{ width: "100%", "max-width": "220px" }}
              >
                <For each={REENCODE_PROFILES}>
                  {(profile) => <option value={profile.id}>{profile.label}</option>}
                </For>
                <Show when={reencodeProfile() === "custom"}>
                  <option value="custom">other</option>
                </Show>
              </select>
            </div>

            <button
              onClick={() => setShowAdvancedReencode(!showAdvancedReencode())}
              style={{
                background: "none",
                border: "none",
                padding: "0",
                "margin-top": "0.5rem",
                color: "var(--color-accent-500, #ff69b4)",
                "font-size": "0.8125rem",
                cursor: "pointer",
                "text-decoration": "underline",
              }}
            >
              {showAdvancedReencode() ? "hide ffmpeg command" : "customize ffmpeg command"}
            </button>

            <Show when={showAdvancedReencode()}>
              <div class="form-group" style={{ "margin-top": "0.75rem" }}>
                <label
                  for="external-storage-reencode-extension"
                  style={{
                    display: "block",
                    "margin-bottom": "0.25rem",
                    "font-size": "0.875rem",
                    color: "var(--color-text-secondary, #888)",
                  }}
                >
                  target extension (e.g. mp3, opus, m4a) - must match the codec the command below
                  encodes to
                </label>
                <input
                  id="external-storage-reencode-extension"
                  type="text"
                  placeholder="mp3"
                  value={reencodeExtensionDraft()}
                  onInput={(e) => setReencodeExtensionDraft(e.currentTarget.value)}
                  style={{ width: "100%", "max-width": "160px" }}
                />
              </div>
              <div class="form-group" style={{ "margin-top": "0.75rem" }}>
                <label
                  for="external-storage-reencode-args"
                  style={{
                    display: "block",
                    "margin-bottom": "0.25rem",
                    "font-size": "0.875rem",
                    color: "var(--color-text-secondary, #888)",
                  }}
                >
                  ffmpeg command ({"{input}"}/{"{output}"} placeholders)
                </label>
                <textarea
                  id="external-storage-reencode-args"
                  rows="3"
                  value={reencodeArgsDraft()}
                  onInput={(e) => setReencodeArgsDraft(e.currentTarget.value)}
                  style={{
                    display: "block",
                    width: "100%",
                    "max-width": "480px",
                    resize: "vertical",
                    background: "var(--color-bg-secondary, #1a1a1a)",
                    color: "var(--color-text-primary, #fff)",
                    border: "1px solid var(--color-border, #333)",
                    "border-radius": "4px",
                    padding: "0.5rem",
                    "font-family": "var(--font-mono, monospace)",
                    "font-size": "0.8125rem",
                  }}
                />
                <div style={{ "margin-top": "0.5rem" }}>
                  <button
                    class="button"
                    onClick={handleSaveExternalStorageReencodeArgs}
                    disabled={externalStorageBusy()}
                  >
                    save
                  </button>
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}

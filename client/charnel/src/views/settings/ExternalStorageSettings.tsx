import { createSignal, onMount, Show, For } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { resolvePath } from "../../util/resolvePath";

// removable-storage sync (tauri desktop only - see
// docs/removable-storage-sync-plan.md). talks to a single tauri command,
// `external_storage_command`, which dispatches on an `action` tag rather
// than registering one command per operation (see
// client/charnel/src-tauri/src/external_storage_commands.rs).

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
  reencode_enabled: boolean;
  reencode_args: string;
}

function externalStorageCommand<T>(action: Record<string, unknown>) {
  return invoke<T>("external_storage_command", { action });
}

/** removable-storage sync section of the settings view: pick/manage a
 * device (or several), set a per-device sub-path, and optionally
 * re-encode files with ffmpeg on the way out. isolated into its own
 * component so it doesn't keep piling onto `SettingsView.tsx`. */
export default function ExternalStorageSettingsSection() {
  const [mountedDevices, setMountedDevices] = createSignal<
    ExternalStorageDevice[]
  >([]);
  const [activeDevice, setActiveDevice] =
    createSignal<ExternalStorageDevice | null>(null);
  const [externalSubpathDraft, setExternalSubpathDraft] = createSignal("");
  const [externalSettings, setExternalSettings] =
    createSignal<ExternalStorageSettings>({
      default_subpath: "music",
      reencode_enabled: false,
      reencode_args: "",
    });
  const [reencodeArgsDraft, setReencodeArgsDraft] = createSignal("");
  const [externalStorageBusy, setExternalStorageBusy] = createSignal(false);
  const [externalStorageMessage, setExternalStorageMessage] = createSignal("");
  const [externalStorageIsError, setExternalStorageIsError] =
    createSignal(false);

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
      const [mounted, active, settings] = await Promise.all([
        externalStorageCommand<ExternalStorageDevice[]>({
          action: "list_mounted",
        }),
        externalStorageCommand<ExternalStorageDevice | null>({
          action: "get_active",
        }),
        externalStorageCommand<ExternalStorageSettings>({
          action: "get_settings",
        }),
      ]);
      setMountedDevices(mounted);
      setActiveDevice(active);
      setExternalSubpathDraft(active?.subpath ?? "");
      setExternalSettings(settings);
      setReencodeArgsDraft(settings.reencode_args);
    } catch (e) {
      console.error("failed to load external storage state:", e);
    }
  });

  async function refreshExternalStorageDevices() {
    try {
      const [mounted, active] = await Promise.all([
        externalStorageCommand<ExternalStorageDevice[]>({
          action: "list_mounted",
        }),
        externalStorageCommand<ExternalStorageDevice | null>({
          action: "get_active",
        }),
      ]);
      setMountedDevices(mounted);
      setActiveDevice(active);
      setExternalSubpathDraft(active?.subpath ?? "");
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
      setExternalStorageMessage(
        `device set: ${externalDeviceDisplayName(device)}`,
      );
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

  async function handleSaveExternalStorageReencodeArgs() {
    const newSettings: ExternalStorageSettings = {
      ...externalSettings(),
      reencode_args: reencodeArgsDraft(),
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
      setExternalStorageMessage("re-encode command updated");
    } catch (e) {
      setExternalStorageMessage(`failed to update re-encode command: ${e}`);
      setExternalStorageIsError(true);
    } finally {
      setExternalStorageBusy(false);
    }
  }

  return (
    <div style={{ "margin-top": "2rem" }}>
      <h3 style={{ "font-size": "1rem", "margin-bottom": "0.5rem" }}>
        external storage
      </h3>
      <p
        style={{
          "font-size": "0.875rem",
          color: "var(--color-text-secondary, #888)",
          "margin-bottom": "0.75rem",
        }}
      >
        sync music to a removable disk or any mounted folder. picking a device
        turns this feature on. the playerbar's storage icon only shows up while
        a device is plugged in.
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
                gap: "0.5rem",
                "flex-wrap": "wrap",
              }}
            >
              <For each={mountedDevices()}>
                {(device) => (
                  <button
                    class={`button ${
                      activeDevice()?.id === device.id ? "primary" : "secondary"
                    }`}
                    onClick={() => handleSelectActiveDevice(device.id)}
                    disabled={externalStorageBusy()}
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
                <span style={{ "font-weight": "500" }}>
                  {externalDeviceDisplayName(device())}
                </span>
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
                  sub-path on this device (default:{" "}
                  {externalSettings().default_subpath})
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    id="external-storage-subpath"
                    type="text"
                    placeholder={externalSettings().default_subpath}
                    value={externalSubpathDraft()}
                    onInput={(e) =>
                      setExternalSubpathDraft(e.currentTarget.value)
                    }
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
            class={`toggle-button ${
              externalSettings().reencode_enabled ? "active" : ""
            }`}
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
              off by default (raw file bytes are copied as-is). applies to every
              device.
            </div>
          </div>
        </div>

        <Show when={externalSettings().reencode_enabled}>
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
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                "align-items": "flex-start",
              }}
            >
              <textarea
                id="external-storage-reencode-args"
                rows="2"
                value={reencodeArgsDraft()}
                onInput={(e) => setReencodeArgsDraft(e.currentTarget.value)}
                style={{ width: "100%", "max-width": "480px" }}
              />
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
      </div>
    </div>
  );
}

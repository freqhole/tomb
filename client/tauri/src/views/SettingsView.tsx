import { createSignal, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ConfigView from "./ConfigView";

interface ServerConfig {
  name: string;
  description: string | null;
  image_path: string | null;
  image_blob_id: string | null;
}

interface UpdateServerImageResult {
  success: boolean;
  message: string;
  image_path: string;
  image_blob_id: string;
}

export default function SettingsView() {
  const [activeTab, setActiveTab] = createSignal<"settings" | "config">(
    "settings",
  );
  const [serverConfig, setServerConfig] = createSignal<ServerConfig | null>(
    null,
  );
  const [imageThumbnail, setImageThumbnail] = createSignal<string | null>(null);
  const [isUpdating, setIsUpdating] = createSignal(false);
  const [imageMessage, setImageMessage] = createSignal("");
  const [imageIsError, setImageIsError] = createSignal(false);

  // editable fields
  const [editName, setEditName] = createSignal("");
  const [editDescription, setEditDescription] = createSignal("");
  const [isSavingInfo, setIsSavingInfo] = createSignal(false);
  const [infoMessage, setInfoMessage] = createSignal("");
  const [infoIsError, setInfoIsError] = createSignal(false);

  onMount(async () => {
    await loadServerConfig();
  });

  async function loadServerConfig() {
    try {
      const config = await invoke<ServerConfig>("get_server_config");
      setServerConfig(config);
      setEditName(config.name);
      setEditDescription(config.description || "");

      // load thumbnail if we have an image (blob_id or image_path)
      if (config.image_blob_id || config.image_path) {
        try {
          const thumbnail = await invoke<string>("get_server_image_thumbnail");
          setImageThumbnail(thumbnail);
        } catch (e) {
          console.error("failed to load thumbnail:", e);
        }
      }
    } catch (e) {
      console.error("failed to load server config:", e);
    }
  }

  async function handleSaveServerInfo() {
    const config = serverConfig();
    if (!config) return;

    // check if anything changed
    const nameChanged = editName() !== config.name;
    const descChanged = editDescription() !== (config.description || "");
    if (!nameChanged && !descChanged) return;

    setIsSavingInfo(true);
    setInfoMessage("");
    setInfoIsError(false);

    try {
      await invoke("update_server_info", {
        name: nameChanged ? editName() : null,
        description: descChanged ? editDescription() : null,
      });
      setInfoMessage("server info updated");
      setInfoIsError(false);
      await loadServerConfig();
    } catch (e) {
      setInfoMessage(`failed to update server info: ${e}`);
      setInfoIsError(true);
    } finally {
      setIsSavingInfo(false);
    }
  }

  async function handleSelectImage() {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp"],
          },
        ],
      });

      if (selected) {
        setIsUpdating(true);
        setImageMessage("");
        setImageIsError(false);

        try {
          const result = await invoke<UpdateServerImageResult>(
            "update_server_image",
            {
              imagePath: selected,
            },
          );

          if (result.success) {
            setImageMessage("server image updated successfully");
            setImageIsError(false);
            // reload config and thumbnail
            await loadServerConfig();
          } else {
            setImageMessage(result.message);
            setImageIsError(true);
          }
        } catch (e) {
          setImageMessage(`failed to update image: ${e}`);
          setImageIsError(true);
        } finally {
          setIsUpdating(false);
        }
      }
    } catch (e) {
      console.error("failed to open file dialog:", e);
    }
  }

  return (
    <div class="view-content settings-view">
      <div class="view-header">
        <h1
          class={activeTab() === "settings" ? "active" : ""}
          onClick={() => setActiveTab("settings")}
          style={{ cursor: "pointer" }}
        >
          setting<span class="pinky">z</span>
        </h1>
      </div>

      <Show when={activeTab() === "settings"}>
        <div style={{ "padding-bottom": "3rem" }}>
        <div class="settings-section">
          <h2>
            server inf<span class="pinky">o</span>
          </h2>

          <div
            class="form-fields"
            style={{
              display: "flex",
              "flex-direction": "column",
              gap: "1rem",
              "margin-top": "1rem",
            }}
          >
            <div class="form-group">
              <label
                for="server-name"
                style={{
                  display: "block",
                  "margin-bottom": "0.25rem",
                  "font-size": "0.875rem",
                  color: "var(--color-text-secondary, #888)",
                }}
              >
                name
              </label>
              <input
                id="server-name"
                type="text"
                value={editName()}
                onInput={(e) => setEditName(e.currentTarget.value)}
                style={{
                  width: "100%",
                  "max-width": "300px",
                }}
              />
            </div>

            <div class="form-group">
              <label
                for="server-description"
                style={{
                  display: "block",
                  "margin-bottom": "0.25rem",
                  "font-size": "0.875rem",
                  color: "var(--color-text-secondary, #888)",
                }}
              >
                description (optional)
              </label>
              <textarea
                id="server-description"
                value={editDescription()}
                onInput={(e) => setEditDescription(e.currentTarget.value)}
                rows={3}
                style={{
                  width: "100%",
                  "max-width": "400px",
                  resize: "vertical",
                  background: "var(--color-bg-secondary, #1a1a1a)",
                  color: "var(--color-text-primary, #fff)",
                  border: "1px solid var(--color-border, #333)",
                  "border-radius": "4px",
                  padding: "0.5rem",
                }}
              />
            </div>

            <div style={{ "margin-bottom": "0.5rem" }}>
              <button
                class="button"
                onClick={handleSaveServerInfo}
                disabled={isSavingInfo()}
              >
                {isSavingInfo() ? "saving..." : "save info"}
              </button>
            </div>

            <Show when={infoMessage()}>
              <div
                class={`message ${infoIsError() ? "error" : "success"}`}
              >
                {infoMessage()}
              </div>
            </Show>
          </div>
        </div>

        <div class="settings-section" style={{ "margin-top": "2rem" }}>
          <h2>
            server imag<span class="pinky">e</span>
          </h2>

          <div
            class="server-image-container"
            style={{
              display: "flex",
              "align-items": "center",
              gap: "1.5rem",
              "margin-top": "1rem",
            }}
          >
            <div
              class="image-thumbnail"
              style={{
                width: "96px",
                height: "96px",
                "aspect-ratio": "1 / 1",
                border: "2px solid var(--color-border, #333)",
                "border-radius": "8px",
                overflow: "hidden",
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                background: "var(--color-bg-secondary, #1a1a1a)",
                "flex-shrink": "0",
              }}
            >
              <Show
                when={imageThumbnail()}
                fallback={
                  <span
                    style={{
                      color: "var(--color-text-muted, #666)",
                      "font-size": "0.875rem",
                    }}
                  >
                    no image
                  </span>
                }
              >
                <img
                  src={`data:image/png;base64,${imageThumbnail()}`}
                  alt="server image"
                  style={{
                    width: "100%",
                    height: "100%",
                    "object-fit": "cover",
                  }}
                />
              </Show>
            </div>

            <div
              class="image-controls"
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "0.5rem",
              }}
            >
              <button
                class="button"
                onClick={handleSelectImage}
                disabled={isUpdating()}
              >
                {isUpdating() ? "updating..." : "choose image"}
              </button>

              <Show when={serverConfig()?.image_path}>
                <span
                  style={{
                    "font-size": "0.75rem",
                    color: "var(--color-text-muted, #666)",
                  }}
                >
                  {serverConfig()?.image_path}
                </span>
              </Show>
            </div>
          </div>

          <Show when={imageMessage()}>
            <div
              class={`message ${imageIsError() ? "error" : "success"}`}
              style={{ "margin-top": "1rem" }}
            >
              {imageMessage()}
            </div>
          </Show>
        </div>
        </div>
      </Show>

      <Show when={activeTab() === "config"}>
        <ConfigView embedded />
      </Show>
    </div>
  );
}

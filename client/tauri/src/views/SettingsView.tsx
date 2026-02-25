import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import * as monaco from "monaco-editor";

interface SaveConfigResult {
  success: boolean;
  message: string;
  validation_errors: string[];
}

export default function SettingsView() {
  const [configPath, setConfigPath] = createSignal("");
  const [configContent, setConfigContent] = createSignal("");
  const [isSaving, setIsSaving] = createSignal(false);
  const [saveMessage, setSaveMessage] = createSignal("");
  const [saveErrors, setSaveErrors] = createSignal<string[]>([]);
  const [isError, setIsError] = createSignal(false);
  const [editorLoading, setEditorLoading] = createSignal(true);
  const [wordWrap, setWordWrap] = createSignal(false);

  let editorContainer: HTMLDivElement | undefined;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;

  onMount(async () => {
    await loadConfigPath();
    await loadConfigContent();
  });

  onCleanup(() => {
    editor?.dispose();
  });

  async function loadConfigPath() {
    try {
      const path = await invoke<string>("get_config_path");
      setConfigPath(path);
    } catch (e) {
      console.error("failed to load config path:", e);
    }
  }

  async function loadConfigContent() {
    try {
      const content = await invoke<string>("read_config_file");
      setConfigContent(content);
      initEditor(content);
    } catch (e) {
      console.error("failed to load config content:", e);
      setSaveMessage(`failed to load config: ${e}`);
      setIsError(true);
      setEditorLoading(false);
    }
  }

  function initEditor(content: string) {
    if (!editorContainer) return;

    editor = monaco.editor.create(editorContainer, {
      value: content,
      language: "ini", // TOML is close to ini syntax
      theme: "vs-dark",
      minimap: { enabled: false },
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      automaticLayout: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      tabSize: 2,
      wordWrap: "off",
    });

    setEditorLoading(false);
  }

  async function openConfigDir() {
    try {
      await invoke("open_config_dir");
    } catch (e) {
      console.error("failed to open config dir:", e);
    }
  }

  async function saveConfig() {
    if (!editor) return;

    setIsSaving(true);
    setSaveMessage("");
    setSaveErrors([]);
    setIsError(false);

    const content = editor.getValue();

    try {
      const result = await invoke<SaveConfigResult>("save_config_file", {
        content,
      });

      if (result.success) {
        setSaveMessage(result.message);
        setIsError(false);

        // restart the server after successful save
        try {
          await invoke("server_restart");
          setSaveMessage(`${result.message} - server restarted`);
        } catch (e) {
          setSaveMessage(`${result.message} - failed to restart server: ${e}`);
          setIsError(true);
        }
      } else {
        setSaveMessage(result.message);
        setSaveErrors(result.validation_errors);
        setIsError(true);
      }
    } catch (e) {
      setSaveMessage(`failed to save config: ${e}`);
      setIsError(true);
    } finally {
      setIsSaving(false);
    }
  }

  async function reloadConfig() {
    if (!editor) return;

    try {
      const content = await invoke<string>("read_config_file");
      editor.setValue(content);
      setSaveMessage("config reloaded from disk");
      setSaveErrors([]);
      setIsError(false);
    } catch (e) {
      setSaveMessage(`failed to reload config: ${e}`);
      setIsError(true);
    }
  }

  function toggleWordWrap() {
    if (!editor) return;
    const newValue = !wordWrap();
    setWordWrap(newValue);
    editor.updateOptions({ wordWrap: newValue ? "on" : "off" });
  }

  return (
    <div class="view-content settings-view">
      <div class="view-header">
        <h1 class="active">
          setting<span class="pinky">z</span>
        </h1>
      </div>

      <div class="editor-section">
        <div class="editor-toolbar">
          <button
            class="primary small"
            onClick={saveConfig}
            disabled={isSaving()}
          >
            {isSaving() ? "saving..." : "save & restart"}
          </button>
          <button
            class="secondary small"
            onClick={reloadConfig}
            disabled={isSaving()}
          >
            reload
          </button>
          <Show when={configPath()}>
            <button
              class="secondary small"
              onClick={openConfigDir}
              title={configPath()}
            >
              show in finder
            </button>
          </Show>
          <div class="flex-spacer" />
          <button
            class={`small ${wordWrap() ? "active" : "secondary"}`}
            onClick={toggleWordWrap}
            title="toggle word wrap"
          >
            wrap
          </button>
        </div>

        <Show when={saveMessage()}>
          <div class={`save-message ${isError() ? "error" : "success"}`}>
            {saveMessage()}
          </div>
        </Show>

        <Show when={saveErrors().length > 0}>
          <div class="validation-errors">
            <strong>validation errors:</strong>
            <ul>
              {saveErrors().map((err) => (
                <li>{err}</li>
              ))}
            </ul>
          </div>
        </Show>

        <Show when={editorLoading()}>
          <div class="editor-loading">loading editor...</div>
        </Show>

        <div
          ref={editorContainer}
          class="monaco-editor-container"
          style={{ display: editorLoading() ? "none" : "block" }}
        />
      </div>
    </div>
  );
}

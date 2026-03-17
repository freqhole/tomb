import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import * as monaco from "monaco-editor";

interface SaveConfigResult {
  success: boolean;
  message: string;
  validation_errors: string[];
}

interface ConfigUpgradeStatus {
  needs_upgrade: boolean;
  config_version: string;
  binary_version: string;
}

interface ConfigUpgradeResult {
  backup_path: string;
  old_version: string;
  new_version: string;
  spume_updated: boolean;
  spume_files: number;
}

export interface ConfigViewProps {
  embedded?: boolean;
}

export default function ConfigView(props: ConfigViewProps = {}) {
  const embedded = () => props.embedded ?? false;
  const [configPath, setConfigPath] = createSignal("");
  const [isSaving, setIsSaving] = createSignal(false);
  const [saveMessage, setSaveMessage] = createSignal("");
  const [saveErrors, setSaveErrors] = createSignal<string[]>([]);
  const [isError, setIsError] = createSignal(false);
  const [editorLoading, setEditorLoading] = createSignal(true);
  const [wordWrap, setWordWrap] = createSignal(false);

  // config upgrade state
  const [upgradeStatus, setUpgradeStatus] =
    createSignal<ConfigUpgradeStatus | null>(null);
  const [isUpgrading, setIsUpgrading] = createSignal(false);

  // "show in finder" button copy state
  const [pathCopied, setPathCopied] = createSignal(false);

  let editorContainer: HTMLDivElement | undefined;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;

  // helper to relayout monaco after DOM changes
  function relayoutEditor() {
    // use setTimeout to let the DOM update first
    setTimeout(() => editor?.layout(), 0);
  }

  // dismiss save message and relayout
  function dismissMessage() {
    setSaveMessage("");
    setSaveErrors([]);
    relayoutEditor();
  }

  onMount(async () => {
    await loadConfigPath();
    await loadConfigContent();
    await checkConfigUpgrade();
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
      initEditor(content);
    } catch (e) {
      console.error("failed to load config content:", e);
      setSaveMessage(`failed to load config: ${e}`);
      setIsError(true);
      setEditorLoading(false);
      relayoutEditor();
    }
  }

  async function checkConfigUpgrade() {
    try {
      const status = await invoke<ConfigUpgradeStatus>(
        "check_config_needs_upgrade",
      );
      setUpgradeStatus(status);
      relayoutEditor();
    } catch (e) {
      console.error("failed to check config upgrade status:", e);
    }
  }

  async function performUpgrade() {
    setIsUpgrading(true);
    setSaveMessage("");
    setSaveErrors([]);
    setIsError(false);

    try {
      const result = await invoke<ConfigUpgradeResult>("upgrade_config");

      // build message parts
      const versionMsg = `${result.old_version} → ${result.new_version}`;
      const spumeMsg = result.spume_updated
        ? `, web client updated (${result.spume_files} files)`
        : "";

      // success - reload config and restart server
      setSaveMessage(
        `config upgraded: ${versionMsg}${spumeMsg} (backup: ${result.backup_path})`,
      );
      setIsError(false);

      // reload editor with new config
      await reloadConfig();

      // restart server
      try {
        await invoke("server_restart");
        setSaveMessage(
          `config upgraded: ${versionMsg}${spumeMsg} - server restarted (backup: ${result.backup_path})`,
        );
      } catch (e) {
        setSaveMessage(
          `config upgraded but failed to restart server: ${e} (backup: ${result.backup_path})`,
        );
        setIsError(true);
      }

      // re-check upgrade status (should now be false)
      await checkConfigUpgrade();
    } catch (e) {
      setSaveMessage(`failed to upgrade config: ${e}`);
      setIsError(true);
    } finally {
      setIsUpgrading(false);
      relayoutEditor();
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
      // also copy path to clipboard
      const path = configPath();
      if (path) {
        await navigator.clipboard.writeText(path);
        setPathCopied(true);
        setTimeout(() => setPathCopied(false), 5000);
      }
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
      relayoutEditor();
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
    } finally {
      relayoutEditor();
    }
  }

  function toggleWordWrap() {
    if (!editor) return;
    const newValue = !wordWrap();
    setWordWrap(newValue);
    editor.updateOptions({ wordWrap: newValue ? "on" : "off" });
  }

  const editorContent = (
    <div class="editor-section">
      <Show when={upgradeStatus()?.needs_upgrade}>
        <div class="upgrade-banner">
          <button
            class="warning"
            onClick={performUpgrade}
            disabled={isUpgrading() || isSaving()}
            title={`upgrade config: ${upgradeStatus()?.config_version} → ${upgradeStatus()?.binary_version}`}
          >
            {isUpgrading() ? "upgrading..." : `update config`}
          </button>
          <span class="upgrade-hint">
            new config template available! ({upgradeStatus()?.config_version} →{" "}
            {upgradeStatus()?.binary_version})
          </span>
          <span class="upgrade-hint">
            please upgrade your config file to the latest version. a backup of
            your old config will be created.
          </span>
        </div>
      </Show>

      <div class="editor-toolbar">
        <button
          class="primary small"
          onClick={saveConfig}
          disabled={isSaving() || isUpgrading()}
        >
          {isSaving() ? "saving..." : "save & restart"}
        </button>
        <button
          class="secondary small"
          onClick={reloadConfig}
          disabled={isSaving() || isUpgrading()}
        >
          reload
        </button>
        <Show when={configPath()}>
          <button
            class="secondary small"
            onClick={openConfigDir}
            title={configPath()}
          >
            {pathCopied() ? "copied path!" : "show in finder"}
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
          <span class="message-text">{saveMessage()}</span>
          <button class="dismiss-btn" onClick={dismissMessage} title="dismiss">
            ×
          </button>
        </div>
      </Show>

      <Show when={saveErrors().length > 0}>
        <div class="validation-errors">
          <div class="errors-header">
            <strong>validation errors:</strong>
            <button
              class="dismiss-btn"
              onClick={dismissMessage}
              title="dismiss"
            >
              ×
            </button>
          </div>
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
  );

  // when embedded, just return the editor content without wrapper
  if (embedded()) {
    return editorContent;
  }

  // standalone view with header
  return (
    <div class="view-content settings-view">
      <div class="view-header">
        <h1 class="active">
          confi<span class="pinky">g</span>
        </h1>
      </div>
      {editorContent}
    </div>
  );
}

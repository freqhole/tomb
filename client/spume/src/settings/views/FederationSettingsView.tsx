// federation settings view - P2P identity management
import { createSignal, onMount, Show } from "solid-js";
import {
  getP2PIdentity,
  deleteP2PIdentity,
  getMiddenRelaySettings,
  saveMiddenRelaySettings,
} from "../../app/services/storage/db";
import {
  getMiddenNode,
  isMiddenInitialized,
  isCharnelAvailable,
  getLocalNodeIdAsync,
} from "../../app/api/client";
import type { P2PIdentity } from "../../app/services/storage/types";
import { toast } from "../../components/feedback/Toast";
import { formatDateTime } from "../../utils/dateTime";
import { exportFederationBackup, importFederationBackup } from "../utils/federationBackup";

// n0's own public relay hostnames, without the trailing dot iroh's hardcoded
// defaults use internally (see parse_peer_addr in lib/midden) - some strict
// tls stacks (safari) reject the trailing-dot form as a cert mismatch.
const DEFAULT_PUBLIC_RELAY_URLS = [
  "https://use1-1.relay.n0.iroh.link/",
  "https://usw1-1.relay.n0.iroh.link/",
  "https://euc1-1.relay.n0.iroh.link/",
  "https://aps1-1.relay.n0.iroh.link/",
];

// confirmation dialog component
function ConfirmDialog(props: {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
          <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{props.title}</h3>
          <p class="text-sm text-[var(--color-text-secondary)] mb-6">{props.message}</p>
          <div class="flex gap-3 justify-end">
            <button
              class="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
              onClick={props.onCancel}
            >
              cancel
            </button>
            <button
              class="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
              onClick={props.onConfirm}
            >
              {props.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export function FederationSettingsView() {
  const [identity, setIdentity] = createSignal<P2PIdentity | null>(null);
  const [tauriNodeId, setTauriNodeId] = createSignal<string | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(false);
  const [showResetConfirm, setShowResetConfirm] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [backupString, setBackupString] = createSignal("");
  const [importString, setImportString] = createSignal("");
  const [isExporting, setIsExporting] = createSignal(false);
  const [isImporting, setIsImporting] = createSignal(false);

  // custom relay urls - comma-separated text field, parsed into an array on
  // save. browser/wasm only - tauri/charnel builds use CharnelTransport,
  // which never reads this. once any url is configured it's used
  // exclusively (no merge-with-public-relay fallback option) - see
  // lib/midden's resolve_relay_mode for why that option was removed.
  const [relayUrlsInput, setRelayUrlsInput] = createSignal("");
  const [invalidRelayUrls, setInvalidRelayUrls] = createSignal<string[]>([]);
  const [isSavingRelaySettings, setIsSavingRelaySettings] = createSignal(false);
  const [relaySettingsSaved, setRelaySettingsSaved] = createSignal(false);
  let relaySettingsSavedTimeout: ReturnType<typeof setTimeout> | undefined;

  const isTauri = isCharnelAvailable();

  // load existing identity on mount
  onMount(async () => {
    setIsLoading(true);
    try {
      if (isTauri) {
        // in tauri, get node_id from server
        const nodeId = await getLocalNodeIdAsync();
        setTauriNodeId(nodeId);
      } else {
        // in browser, get from IndexedDB
        const existing = await getP2PIdentity();
        setIdentity(existing);
        const relaySettings = await getMiddenRelaySettings();
        // first-run (nothing saved yet): midden itself now falls back to
        // these same dot-free n0 relays when relay_urls is empty (see
        // lib/midden's effective_relay_urls) - show them here so the user
        // can see what's actually in use, rather than a misleadingly blank
        // field, and can clear or replace them if they want.
        const urls =
          relaySettings.relay_urls.length > 0
            ? relaySettings.relay_urls
            : DEFAULT_PUBLIC_RELAY_URLS;
        setRelayUrlsInput(urls.join(", "));
      }
    } catch (err) {
      console.error("failed to load P2P identity:", err);
    }
    setIsLoading(false);
  });

  // initialize P2P node (generates or restores identity) - browser only
  const handleInitialize = async () => {
    if (isInitializing() || isTauri) return;

    setIsInitializing(true);
    try {
      await getMiddenNode();
      // reload identity from IDB (it will have been saved during init)
      const updated = await getP2PIdentity();
      setIdentity(updated);
      toast.success("P2P node initialized");
    } catch (err) {
      console.error("failed to initialize P2P node:", err);
      toast.error("failed to initialize P2P node");
    }
    setIsInitializing(false);
  };

  // reset identity (delete and allow re-generation) - browser only
  const handleReset = async () => {
    if (isTauri) return;
    setShowResetConfirm(false);
    try {
      await deleteP2PIdentity();
      setIdentity(null);
      // note: the in-memory midden node still has old identity until page reload
      toast.success("P2P identity deleted. reload page to generate new identity.");
    } catch (err) {
      console.error("failed to reset P2P identity:", err);
      toast.error("failed to reset identity");
    }
  };

  // copy node ID to clipboard
  const copyNodeId = async () => {
    const nodeId = isTauri ? tauriNodeId() : identity()?.node_id;
    if (!nodeId) return;

    try {
      await navigator.clipboard.writeText(nodeId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      // no toast for copy failures - the copied-state flash is enough feedback
      console.error("copy to clipboard failed:", e);
    }
  };

  // get current node ID for display
  const currentNodeId = () => (isTauri ? tauriNodeId() : identity()?.node_id);
  const hasIdentity = () => (isTauri ? !!tauriNodeId() : !!identity());

  // shared persist step used by save/reset/use-default - shows the same
  // toast + "saved!" feedback regardless of which button triggered it.
  // relay_custom_only is always true now: once any relay_urls are
  // configured they're used exclusively, never merged with the public
  // n0 relay (see lib/midden's resolve_relay_mode doc comment).
  const persistRelaySettings = async (urls: string[]) => {
    setIsSavingRelaySettings(true);
    try {
      await saveMiddenRelaySettings({ relay_urls: urls, relay_custom_only: true });
      toast.success("relay settings saved — reload the page for changes to take effect");
      setRelaySettingsSaved(true);
      clearTimeout(relaySettingsSavedTimeout);
      relaySettingsSavedTimeout = setTimeout(() => setRelaySettingsSaved(false), 5000);
    } catch (err) {
      console.error("failed to save relay settings:", err);
      toast.error("failed to save relay settings");
    }
    setIsSavingRelaySettings(false);
  };

  // a url is "valid" here purely as a well-formed url (must parse via the
  // URL constructor and use http/https) - a trailing `.` on the hostname is
  // NOT flagged as invalid. it's valid url syntax; only safari's tls stack
  // rejects it, and this validator has no way to know which browser the
  // relay will actually be dialed from.
  function isWellFormedRelayUrl(candidate: string): boolean {
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  // parse the comma-separated relay urls field and persist only the
  // well-formed entries - browser only. also strips leading/trailing quote
  // characters left over from pasting a quoted list (e.g. a JSON array's
  // contents), which would otherwise fail to parse as a valid relay url.
  // any entries that still don't parse as a url are reported (not silently
  // dropped) via invalidRelayUrls, so the user knows they won't be used.
  const handleSaveRelaySettings = async () => {
    const entries = relayUrlsInput()
      .split(",")
      .map((s) =>
        s
          .trim()
          .replace(/^["']+|["']+$/g, "")
          .trim()
      )
      .filter((s) => s.length > 0);
    const valid = entries.filter(isWellFormedRelayUrl);
    const invalid = entries.filter((s) => !isWellFormedRelayUrl(s));
    setInvalidRelayUrls(invalid);
    if (invalid.length > 0) {
      toast.error(`ignoring ${invalid.length} invalid relay url(s) - see details below`);
    }
    await persistRelaySettings(valid);
  };

  // clear the field and persist the empty state (back to iroh's own
  // default relay selection/discovery).
  const handleResetRelaySettings = async () => {
    setRelayUrlsInput("");
    setInvalidRelayUrls([]);
    await persistRelaySettings([]);
  };

  // fill in n0's own public relay hostnames (without the trailing dot iroh's
  // hardcoded defaults use, which safari's tls stack rejects - see
  // parse_peer_addr in lib/midden) and persist them as-is.
  const handleUseDefaultPublicRelays = async () => {
    setRelayUrlsInput(DEFAULT_PUBLIC_RELAY_URLS.join(", "));
    setInvalidRelayUrls([]);
    await persistRelaySettings(DEFAULT_PUBLIC_RELAY_URLS);
  };

  // export federation backup
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const encoded = await exportFederationBackup();
      setBackupString(encoded);
      toast.success("backup exported — copy the string below");
    } catch (err) {
      console.error("export failed:", err);
      toast.error("failed to export backup");
    }
    setIsExporting(false);
  };

  // import federation backup
  const handleImport = async () => {
    const input = importString().trim();
    if (!input) {
      toast.error("paste a backup string first");
      return;
    }
    setIsImporting(true);
    try {
      const result = await importFederationBackup(input);
      const parts: string[] = [];
      if (result.identityRestored) parts.push("identity restored");
      if (result.remotesAdded > 0) parts.push(`${result.remotesAdded} remote(s) added`);
      if (result.pendingAdded > 0) parts.push(`${result.pendingAdded} pending remote(s) added`);
      if (result.skippedRemotes.length > 0) parts.push(`${result.skippedRemotes.length} skipped`);
      toast.success(parts.length > 0 ? parts.join(", ") : "nothing to import");
      setImportString("");
      // reload identity and start P2P node if identity was restored
      if (result.identityRestored) {
        const updated = await getP2PIdentity();
        setIdentity(updated);
        try {
          await getMiddenNode();
        } catch {
          // node start is best-effort — identity is already saved
        }
      }
    } catch (err) {
      console.error("import failed:", err);
      toast.error("failed to import backup — invalid string?");
    }
    setIsImporting(false);
  };

  return (
    <div class="p-6 max-w-2xl">
      <h1 class="text-2xl font-bold text-[var(--color-text-primary)] mb-2">federation</h1>
      <p class="text-sm text-[var(--color-text-muted)] mb-8">
        peer-to-peer identity for connecting to remote servers
      </p>

      <Show when={isLoading()}>
        <div class="text-[var(--color-text-muted)]">loading...</div>
      </Show>

      <Show when={!isLoading()}>
        {/* no identity yet - browser only */}
        <Show when={!hasIdentity() && !isTauri}>
          <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-6">
            <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
              P2P not initialized
            </h2>
            <p class="text-sm text-[var(--color-text-secondary)] mb-4">
              click the button below to initialize your P2P identity. this will generate a keypair
              that uniquely identifies this browser to remote peers.
            </p>
            <button
              class="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleInitialize}
              disabled={isInitializing()}
            >
              {isInitializing() ? "initializing..." : "initialize P2P node"}
            </button>
          </div>
        </Show>

        {/* tauri: no node id from server yet */}
        <Show when={!hasIdentity() && isTauri}>
          <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-6">
            <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
              P2P not available
            </h2>
            <p class="text-sm text-[var(--color-text-secondary)]">
              the server's federation endpoint is not running. check server logs for details.
            </p>
          </div>
        </Show>

        {/* has identity */}
        <Show when={hasIdentity()}>
          <div class="space-y-6">
            {/* node ID display */}
            <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-6">
              <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
                node ID
              </h2>
              <div class="flex items-center gap-3">
                <code class="flex-1 font-mono text-sm text-[var(--color-text-primary)] bg-[var(--color-bg-tertiary)] px-3 py-2 rounded break-all select-all">
                  {currentNodeId()}
                </code>
                <button
                  class="px-3 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors whitespace-nowrap"
                  onClick={copyNodeId}
                >
                  {copied() ? "copied!" : "copy"}
                </button>
              </div>
              <p class="text-xs text-[var(--color-text-muted)] mt-3">
                share this ID with the remote server admin to allow P2P connections
              </p>
            </div>

            {/* identity info */}
            <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-6">
              <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
                identity info
              </h2>
              <dl class="space-y-2 text-sm">
                <Show when={!isTauri && identity()}>
                  <div class="flex justify-between">
                    <dt class="text-[var(--color-text-muted)]">created</dt>
                    <dd class="text-[var(--color-text-primary)]">
                      {formatDateTime(identity()!.created_at)}
                    </dd>
                  </div>
                </Show>
                <div class="flex justify-between">
                  <dt class="text-[var(--color-text-muted)]">transport</dt>
                  <dd class="text-[var(--color-text-primary)]">
                    {isTauri ? "app" : "WASM (browser)"}
                  </dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-[var(--color-text-muted)]">node status</dt>
                  <dd class="text-[var(--color-text-primary)]">
                    {isTauri ? (
                      <span class="text-green-400">connected</span>
                    ) : isMiddenInitialized() ? (
                      <span class="text-green-400">connected</span>
                    ) : (
                      <span class="text-yellow-400">not started</span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            {/* actions - browser only */}
            <Show when={!isTauri}>
              <div class="flex gap-3">
                <Show when={!isMiddenInitialized()}>
                  <button
                    class="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={handleInitialize}
                    disabled={isInitializing()}
                  >
                    {isInitializing() ? "starting..." : "start P2P node"}
                  </button>
                </Show>
                <button
                  class="px-4 py-2 text-sm font-medium rounded-lg border border-red-600 text-red-400 hover:bg-red-600/10 transition-colors"
                  onClick={() => setShowResetConfirm(true)}
                >
                  reset identity
                </button>
              </div>
            </Show>
          </div>
        </Show>

        {/* custom relay servers - browser/wasm only, always visible */}
        <Show when={!isTauri}>
          <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-6 mt-6">
            <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
              custom relay servers
            </h2>
            <p class="text-xs text-[var(--color-text-muted)] mb-4">
              these are the relay servers currently in use (the public n0/iroh relays by default).
              edit, remove, or add your own (comma-separated) - once saved, only the urls listed
              here are used, with no fallback. changes take effect after reloading the page.
            </p>
            <textarea
              class="w-full font-mono text-xs bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] rounded-lg p-3 mb-3 resize-y"
              rows={3}
              placeholder="https://relay.example.com, https://relay2.example.com"
              value={relayUrlsInput()}
              onInput={(e) => setRelayUrlsInput(e.currentTarget.value)}
            />
            <Show when={invalidRelayUrls().length > 0}>
              <p class="text-xs text-red-400 mb-3">
                these entries aren&apos;t valid urls and won&apos;t be used:{" "}
                {invalidRelayUrls().join(", ")}
              </p>
            </Show>

            <div class="flex items-center gap-3 flex-wrap">
              <button
                class="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSaveRelaySettings}
                disabled={isSavingRelaySettings()}
              >
                {isSavingRelaySettings() ? "saving..." : "save relay settings"}
              </button>
              <button
                class="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleUseDefaultPublicRelays}
                disabled={isSavingRelaySettings()}
              >
                use default public relays
              </button>
              <button
                class="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleResetRelaySettings}
                disabled={isSavingRelaySettings()}
              >
                reset
              </button>
              <Show when={relaySettingsSaved()}>
                <span class="text-sm text-green-400">saved!</span>
              </Show>
            </div>
          </div>
        </Show>

        {/* backup & restore - browser only, always visible */}
        <Show when={!isTauri}>
          <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-6 mt-6">
            <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
              backup & restore
            </h2>
            <p class="text-xs text-[var(--color-text-muted)] mb-4">
              export your P2P identity and remote configs as a compact string. import on another
              browser to restore your federation setup.
            </p>

            {/* export */}
            <Show when={hasIdentity()}>
              <div class="mb-4">
                <button
                  class="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleExport}
                  disabled={isExporting()}
                >
                  {isExporting() ? "exporting..." : "export backup"}
                </button>
              </div>

              <Show when={backupString()}>
                <div class="mb-4">
                  <textarea
                    class="w-full font-mono text-xs bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] rounded-lg p-3 resize-none select-all"
                    rows={3}
                    readOnly
                    value={backupString()}
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                  />
                </div>
              </Show>
            </Show>

            {/* import */}
            <div
              class={hasIdentity() ? "border-t border-[var(--color-border-subtle)] pt-4 mt-4" : ""}
            >
              <textarea
                class="w-full font-mono text-xs bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] rounded-lg p-3 resize-none mb-3"
                rows={3}
                placeholder="paste backup string here..."
                value={importString()}
                onInput={(e) => setImportString(e.currentTarget.value)}
              />
              <button
                class="px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleImport}
                disabled={isImporting() || !importString().trim()}
              >
                {isImporting() ? "importing..." : "import backup"}
              </button>
            </div>
          </div>
        </Show>
      </Show>

      {/* reset confirmation dialog */}
      <ConfirmDialog
        isOpen={showResetConfirm()}
        title="reset P2P identity?"
        message="this will delete your current identity. you'll need to share your new node ID with remote server admins again. the page will need to be reloaded for changes to take effect."
        confirmLabel="reset"
        onConfirm={handleReset}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  );
}

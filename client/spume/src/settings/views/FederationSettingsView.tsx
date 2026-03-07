// federation settings view - P2P identity management
import { createSignal, onMount, Show } from "solid-js";
import { getP2PIdentity, deleteP2PIdentity } from "../../app/services/storage/db";
import { getMiddenNode, isMiddenInitialized } from "../../app/api/client";
import type { P2PIdentity } from "../../app/services/storage/types";
import { toast } from "../../components/feedback/Toast";
import { formatDateTime } from "../../utils/dateTime";

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
  const [isLoading, setIsLoading] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(false);
  const [showResetConfirm, setShowResetConfirm] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  // load existing identity on mount
  onMount(async () => {
    setIsLoading(true);
    try {
      const existing = await getP2PIdentity();
      setIdentity(existing);
    } catch (err) {
      console.error("failed to load P2P identity:", err);
    }
    setIsLoading(false);
  });

  // initialize P2P node (generates or restores identity)
  const handleInitialize = async () => {
    if (isInitializing()) return;

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

  // reset identity (delete and allow re-generation)
  const handleReset = async () => {
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
    const id = identity();
    if (!id) return;

    try {
      await navigator.clipboard.writeText(id.node_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("failed to copy");
    }
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
        {/* no identity yet */}
        <Show when={!identity()}>
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

        {/* has identity */}
        <Show when={identity()}>
          {(id) => (
            <div class="space-y-6">
              {/* node ID display */}
              <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-6">
                <h2 class="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3">
                  node ID
                </h2>
                <div class="flex items-center gap-3">
                  <code class="flex-1 font-mono text-sm text-[var(--color-text-primary)] bg-[var(--color-bg-tertiary)] px-3 py-2 rounded break-all select-all">
                    {id().node_id}
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
                  <div class="flex justify-between">
                    <dt class="text-[var(--color-text-muted)]">created</dt>
                    <dd class="text-[var(--color-text-primary)]">
                      {formatDateTime(id().created_at)}
                    </dd>
                  </div>
                  <div class="flex justify-between">
                    <dt class="text-[var(--color-text-muted)]">node status</dt>
                    <dd class="text-[var(--color-text-primary)]">
                      {isMiddenInitialized() ? (
                        <span class="text-green-400">connected</span>
                      ) : (
                        <span class="text-yellow-400">not started</span>
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* actions */}
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
            </div>
          )}
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

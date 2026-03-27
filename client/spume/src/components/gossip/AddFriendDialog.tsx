// add friend dialog — enter a node_id to add as a friend
import { createSignal, Show } from "solid-js";

export interface AddFriendDialogProps {
  onAdd: (nodeId: string, displayName?: string) => void;
  onCancel: () => void;
  /** current user's node_id for copy-to-clipboard sharing */
  currentNodeId?: string;
}

export function AddFriendDialog(props: AddFriendDialogProps) {
  const [nodeId, setNodeId] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const canAdd = () => nodeId().trim().length > 10;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!canAdd()) return;
    const name = displayName().trim() || undefined;
    props.onAdd(nodeId().trim(), name);
  };

  const handleCopyOwnId = async () => {
    if (!props.currentNodeId) return;
    await navigator.clipboard.writeText(props.currentNodeId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <form
        class="bg-[var(--color-bg-elevated)] rounded-xl p-5 w-full max-w-sm shadow-xl"
        onSubmit={handleSubmit}
      >
        <h2 class="text-base font-semibold text-[var(--color-text-primary)] mb-2">add friend</h2>
        <p class="text-xs text-[var(--color-text-tertiary)] mb-4">
          enter a friend's node ID to connect with them
        </p>

        <label class="block mb-3">
          <span class="text-xs text-[var(--color-text-secondary)] mb-1 block">node ID</span>
          <input
            class="w-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] placeholder:text-[var(--color-text-tertiary)] font-mono"
            placeholder="paste node ID..."
            value={nodeId()}
            onInput={(e) => setNodeId(e.currentTarget.value)}
            autofocus
          />
        </label>

        <label class="block mb-3">
          <span class="text-xs text-[var(--color-text-secondary)] mb-1 block">
            nickname <span class="text-[var(--color-text-tertiary)]">(optional)</span>
          </span>
          <input
            class="w-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] placeholder:text-[var(--color-text-tertiary)]"
            placeholder="a name to remember them by"
            value={displayName()}
            onInput={(e) => setDisplayName(e.currentTarget.value)}
            maxLength={50}
          />
        </label>

        <Show when={props.currentNodeId}>
          <div class="mb-4 p-2.5 rounded-lg bg-[var(--color-bg-tertiary)]">
            <p class="text-[10px] text-[var(--color-text-tertiary)] mb-1">
              your node ID (share this with friends)
            </p>
            <button
              type="button"
              class="text-xs font-mono text-[var(--color-text-secondary)] hover:text-[var(--color-accent-500)] transition-colors break-all text-left cursor-pointer"
              onClick={handleCopyOwnId}
            >
              {copied() ? "copied!" : props.currentNodeId}
            </button>
          </div>
        </Show>

        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer"
            onClick={() => props.onCancel()}
          >
            cancel
          </button>
          <button
            type="submit"
            class="px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer"
            classList={{
              "bg-[var(--color-accent-500)] text-white hover:bg-[var(--color-accent-400)]":
                canAdd(),
              "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] cursor-not-allowed":
                !canAdd(),
            }}
            disabled={!canAdd()}
          >
            add friend
          </button>
        </div>
      </form>
    </div>
  );
}

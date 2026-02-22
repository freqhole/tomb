// remotes settings view - displays configured remotes and allows deletion
import { createSignal, onMount, Show, For } from "solid-js";
import { getAllRemotes, deleteRemote } from "../../app/services/remotes/remoteManager";
import { initAppDB } from "../../app/services/storage/db";
import {
  STORE_QUEUE_HISTORY,
  type QueueHistoryEntry,
  type Remote,
} from "../../app/services/storage/types";
import { debug } from "../../utils/logger";

// format a timestamp as a readable date
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

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

// delete queue history entries associated with a remote
async function deleteQueueHistoryForRemote(remoteId: string): Promise<number> {
  const db = await initAppDB();
  const allEntries = await db.getAll(STORE_QUEUE_HISTORY);

  // filter entries that belong to this remote (by server_remote_id)
  const entriesToDelete = allEntries.filter(
    (entry: QueueHistoryEntry) => entry.server_remote_id === remoteId
  );

  // delete each matching entry
  for (const entry of entriesToDelete) {
    await db.delete(STORE_QUEUE_HISTORY, entry.id);
  }

  return entriesToDelete.length;
}

export function RemotesSettingsView() {
  const [remotes, setRemotes] = createSignal<Remote[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<string | null>(null);

  // confirmation dialog state
  const [confirmDialog, setConfirmDialog] = createSignal<{
    isOpen: boolean;
    remote: Remote | null;
  }>({
    isOpen: false,
    remote: null,
  });

  const refreshRemotes = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAllRemotes();
      setRemotes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load remotes");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    refreshRemotes();
  });

  const showDeleteConfirm = (remote: Remote) => {
    setConfirmDialog({
      isOpen: true,
      remote,
    });
  };

  const handleConfirmDelete = async () => {
    const dialog = confirmDialog();
    if (!dialog.remote) return;

    setConfirmDialog({ isOpen: false, remote: null });
    setDeleting(dialog.remote.remote_id);

    try {
      // delete associated queue history entries first
      const deletedCount = await deleteQueueHistoryForRemote(dialog.remote.remote_id);
      debug(
        "RemotesSettings",
        `deleted ${deletedCount} queue history entries for remote ${dialog.remote.name}`
      );

      // then delete the remote itself
      await deleteRemote(dialog.remote.remote_id);
      await refreshRemotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to delete remote");
    } finally {
      setDeleting(null);
    }
  };

  const handleCancel = () => {
    setConfirmDialog({ isOpen: false, remote: null });
  };

  return (
    <div class="p-4 md:p-6">
      <div class="mb-6">
        <h1 class="text-xl font-semibold text-[var(--color-text-primary)] mb-1">remotes</h1>
        <p class="text-sm text-[var(--color-text-muted)]">manage your connected music servers</p>
      </div>

      <Show when={loading()}>
        <div class="flex items-center justify-center py-12">
          <div class="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-accent-500)] border-t-transparent" />
        </div>
      </Show>

      <Show when={error()}>
        <div class="bg-red-600/20 border border-red-600/30 rounded-lg p-4 mb-4">
          <p class="text-sm text-red-400">{error()}</p>
        </div>
      </Show>

      <Show when={!loading() && !error()}>
        <Show
          when={remotes().length > 0}
          fallback={
            <div class="text-center py-12">
              <div class="text-4xl mb-3">🌐</div>
              <p class="text-[var(--color-text-muted)] text-sm">no remotes configured</p>
              <p class="text-[var(--color-text-muted)] text-xs mt-1">
                add a remote server from the main menu to get started
              </p>
            </div>
          }
        >
          <div class="space-y-3">
            <For each={remotes()}>
              {(remote) => (
                <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-4">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 mb-1">
                        <h3 class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {remote.name}
                        </h3>
                        <Show when={remote.is_active}>
                          <span class="px-1.5 py-0.5 text-xs font-medium bg-green-600/20 text-green-400 rounded">
                            active
                          </span>
                        </Show>
                      </div>
                      <p class="text-xs text-[var(--color-text-muted)] truncate mb-2">
                        {remote.base_url}
                      </p>
                      <div class="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
                        <span>added {formatDate(remote.created_at)}</span>
                        <Show when={remote.last_connected_at}>
                          <span>last connected {formatDate(remote.last_connected_at!)}</span>
                        </Show>
                      </div>
                    </div>
                    <button
                      class="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                      onClick={() => showDeleteConfirm(remote)}
                      disabled={deleting() === remote.remote_id}
                    >
                      {deleting() === remote.remote_id ? "deleting..." : "delete"}
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <ConfirmDialog
        isOpen={confirmDialog().isOpen}
        title={`delete ${confirmDialog().remote?.name || "remote"}?`}
        message={`this will remove the remote server "${confirmDialog().remote?.name || ""}" and delete any associated queue history. you'll need to re-add it to access its music again.`}
        confirmLabel="delete"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancel}
      />
    </div>
  );
}

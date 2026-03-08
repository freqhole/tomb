// remotes settings view - displays configured remotes and allows deletion
import { createSignal, createResource, onMount, Show, For } from "solid-js";
import {
  getAllRemotes,
  deleteRemote,
  checkRemoteHealth,
} from "../../app/services/remotes/remoteManager";
import { logout, whoami } from "../../app/services/remotes/authService";
import { initAppDB } from "../../app/services/storage/db";
import {
  STORE_QUEUE_HISTORY,
  type QueueHistoryEntry,
  type Remote,
} from "../../app/services/storage/types";
import { debug } from "../../utils/logger";
import { toast } from "../../components/feedback/Toast";
import { Icon } from "../../components/icons/registry";
import { ReauthModal } from "../../components/auth/ReauthModal";
import { formatDate } from "../../utils/dateTime";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";

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

// remote image component that handles P2P blob resolution
function RemoteImage(props: { remote: Remote }) {
  // for P2P remotes with image_blob_id, resolve via blob resolver
  const isP2P = () => props.remote.transport_type === "wasm" || !!props.remote.peer_addr;

  const [resolvedUrl] = createResource(
    () =>
      isP2P() && props.remote.image_blob_id
        ? { blobId: props.remote.image_blob_id, remoteId: props.remote.remote_id }
        : null,
    async (params) => {
      if (!params) return null;
      try {
        return await resolveBlobUrl(params.blobId, params.remoteId);
      } catch (e) {
        debug("RemoteImage", `failed to resolve blob: ${e}`);
        return null;
      }
    }
  );

  // for HTTP remotes, use direct URL
  const httpImageUrl = () =>
    !isP2P() && props.remote.image_url ? `${props.remote.base_url}${props.remote.image_url}` : null;

  const imageUrl = () => (isP2P() ? resolvedUrl() : httpImageUrl());

  return (
    <Show
      when={imageUrl() || (isP2P() && props.remote.image_blob_id && resolvedUrl.loading)}
      fallback={
        <div class="w-12 h-12 rounded-lg bg-[var(--color-bg-tertiary)] flex items-center justify-center shrink-0">
          <span class="text-xl">🌐</span>
        </div>
      }
    >
      <Show
        when={resolvedUrl.loading}
        fallback={
          <img
            src={imageUrl()!}
            alt={props.remote.name}
            class="w-12 h-12 rounded-lg object-cover shrink-0"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        }
      >
        <div class="w-12 h-12 rounded-lg bg-[var(--color-bg-tertiary)] flex items-center justify-center shrink-0 animate-pulse">
          <span class="text-xl opacity-50">🌐</span>
        </div>
      </Show>
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

// auth info for a remote
interface AuthInfo {
  loggedIn: boolean;
  username?: string;
  role?: string;
}

export function RemotesSettingsView() {
  const [remotes, setRemotes] = createSignal<Remote[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [loggingOut, setLoggingOut] = createSignal<string | null>(null);
  const [rechecking, setRechecking] = createSignal<string | null>(null);
  // auth status per remote: null = checking, AuthInfo = resolved
  const [authStatus, setAuthStatus] = createSignal<Map<string, AuthInfo | null>>(new Map());
  // reauth modal state
  const [reauthRemote, setReauthRemote] = createSignal<Remote | null>(null);

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
      // check auth status for each remote
      checkAllAuthStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load remotes");
    } finally {
      setLoading(false);
    }
  };

  const checkAllAuthStatus = async (remoteList: Remote[]) => {
    // initialize all as checking (null)
    const initial = new Map<string, AuthInfo | null>();
    for (const r of remoteList) {
      initial.set(r.remote_id, null);
    }
    setAuthStatus(initial);

    // check each remote in parallel
    await Promise.all(
      remoteList.map(async (remote) => {
        try {
          const result = await whoami(remote.base_url);
          setAuthStatus((prev) => {
            const next = new Map(prev);
            next.set(remote.remote_id, {
              loggedIn: result.success,
              username: result.username,
              role: result.role,
            });
            return next;
          });
        } catch {
          // network error - assume not logged in
          setAuthStatus((prev) => {
            const next = new Map(prev);
            next.set(remote.remote_id, { loggedIn: false });
            return next;
          });
        }
      })
    );
  };

  const checkSingleAuthStatus = async (remote: Remote) => {
    try {
      const result = await whoami(remote.base_url);
      setAuthStatus((prev) => {
        const next = new Map(prev);
        next.set(remote.remote_id, {
          loggedIn: result.success,
          username: result.username,
          role: result.role,
        });
        return next;
      });
    } catch {
      setAuthStatus((prev) => {
        const next = new Map(prev);
        next.set(remote.remote_id, { loggedIn: false });
        return next;
      });
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

  const handleLogout = async (remote: Remote) => {
    setLoggingOut(remote.remote_id);
    try {
      // call the logout endpoint to clear session cookie
      const result = await logout(remote.base_url);
      if (!result.success) {
        toast.error(result.error || "logout failed");
        return;
      }

      toast.success(`logged out from ${remote.name}`);
      // update auth status
      setAuthStatus((prev) => {
        const next = new Map(prev);
        next.set(remote.remote_id, { loggedIn: false });
        return next;
      });

      // refresh remotes list
      const updated = await getAllRemotes();
      setRemotes(updated);
    } catch (err) {
      toast.error("logout failed");
    } finally {
      setLoggingOut(null);
    }
  };

  const handleLogin = (remote: Remote) => {
    setReauthRemote(remote);
  };

  const handleRecheckStatus = async (remote: Remote) => {
    setRechecking(remote.remote_id);
    try {
      const isOnline = await checkRemoteHealth(remote);
      // refresh remotes to get updated status
      const updated = await getAllRemotes();
      setRemotes(updated);
      if (isOnline) {
        toast.success(`${remote.name} is online`);
      } else {
        toast.warning(`${remote.name} is offline`);
      }
    } catch (err) {
      toast.error("failed to check server status");
    } finally {
      setRechecking(null);
    }
  };

  const handleReauthSuccess = async () => {
    const remote = reauthRemote();
    if (remote) {
      toast.success(`signed in to ${remote.name}`);
      // re-fetch auth status to get username/role
      await checkSingleAuthStatus(remote);
    }
    setReauthRemote(null);
  };

  return (
    <div class="p-4 wide:p-6">
      <div class="mb-6">
        <h1 class="text-xl font-semibold text-[var(--color-text-primary)] mb-1">remotes</h1>
        <p class="text-sm text-[var(--color-text-muted)]">manage connected music servers</p>
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
              {(remote) => {
                const isLocal = () => {
                  const url = remote.base_url.toLowerCase();
                  return (
                    url.includes("localhost") || url.includes("127.0.0.1") || url.includes("[::1]")
                  );
                };
                const isP2P = () => remote.transport_type === "wasm" || !!remote.peer_addr;
                return (
                  <div class="bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-4">
                    <div class="flex items-start gap-4">
                      {/* server image or home icon for tauri-managed */}
                      <Show
                        when={remote.is_tauri_managed}
                        fallback={<RemoteImage remote={remote} />}
                      >
                        <div class="w-12 h-12 rounded-lg bg-[var(--color-bg-tertiary)] flex items-center justify-center shrink-0">
                          <Icon name="home" size={24} color="var(--color-accent-500)" />
                        </div>
                      </Show>

                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                            {remote.name}
                          </h3>
                          <Show when={remote.is_tauri_managed}>
                            <span class="px-1.5 py-0.5 text-xs font-medium bg-[var(--color-accent-500)]/20 text-[var(--color-accent-500)] rounded">
                              embedded
                            </span>
                          </Show>
                          <Show when={isP2P()}>
                            <span class="px-1.5 py-0.5 text-xs font-medium bg-purple-600/20 text-purple-400 rounded">
                              p2p
                            </span>
                          </Show>
                          <Show when={isLocal() && !remote.is_tauri_managed}>
                            <span class="px-1.5 py-0.5 text-xs font-medium bg-blue-600/20 text-blue-400 rounded">
                              local
                            </span>
                          </Show>
                          <Show when={remote.is_active}>
                            <span class="px-1.5 py-0.5 text-xs font-medium bg-green-600/20 text-green-400 rounded">
                              active
                            </span>
                          </Show>
                          <Show when={remote.is_offline}>
                            <span class="px-1.5 py-0.5 text-xs font-medium bg-red-600/20 text-red-400 rounded">
                              offline
                            </span>
                          </Show>
                          <Show when={remote.is_offline === false}>
                            <span class="px-1.5 py-0.5 text-xs font-medium bg-green-600/20 text-green-400 rounded">
                              online
                            </span>
                          </Show>
                        </div>
                        <Show when={remote.base_url}>
                          <p class="text-xs text-[var(--color-text-muted)] truncate mb-2">
                            {remote.base_url}
                          </p>
                        </Show>
                        <Show when={remote.peer_addr}>
                          <p class="text-xs text-[var(--color-text-muted)] truncate mb-2 font-mono">
                            node: {remote.peer_addr}
                          </p>
                        </Show>
                        {/* logged in user info */}
                        {(() => {
                          const info = authStatus().get(remote.remote_id);
                          if (info?.loggedIn && info.username) {
                            return (
                              <p class="text-xs text-[var(--color-text-secondary)] mb-2">
                                signed in as <span class="font-medium">{info.username}</span>
                                <Show when={info.role}>
                                  <span class="text-[var(--color-text-muted)]"> ({info.role})</span>
                                </Show>
                              </p>
                            );
                          }
                          return null;
                        })()}
                        <div class="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
                          <span>added {formatDate(remote.created_at)}</span>
                          <Show when={remote.last_connected_at}>
                            <span>last connected {formatDate(remote.last_connected_at!)}</span>
                          </Show>
                        </div>
                      </div>

                      {/* action buttons */}
                      <div class="flex flex-col gap-2 shrink-0">
                        {/* auth status indicator + login/logout button */}
                        {(() => {
                          const info = authStatus().get(remote.remote_id);
                          const isChecking = info === null;
                          const isLoggedIn = info?.loggedIn === true;

                          if (isChecking) {
                            return (
                              <button
                                class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)] cursor-default"
                                disabled
                              >
                                checking...
                              </button>
                            );
                          }

                          if (isLoggedIn) {
                            return (
                              <button
                                class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => handleLogout(remote)}
                                disabled={loggingOut() === remote.remote_id}
                              >
                                {loggingOut() === remote.remote_id ? "logging out..." : "logout"}
                              </button>
                            );
                          }

                          // not logged in
                          return (
                            <button
                              class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors"
                              onClick={() => handleLogin(remote)}
                            >
                              sign in
                            </button>
                          );
                        })()}
                        <button
                          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => handleRecheckStatus(remote)}
                          disabled={rechecking() === remote.remote_id}
                        >
                          {rechecking() === remote.remote_id ? "checking..." : "check status"}
                        </button>
                        <button
                          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => showDeleteConfirm(remote)}
                          disabled={deleting() === remote.remote_id}
                        >
                          {deleting() === remote.remote_id ? "deleting..." : "delete"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }}
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

      <Show when={reauthRemote()}>
        {(remote) => (
          <ReauthModal
            isOpen={true}
            onClose={() => setReauthRemote(null)}
            onSuccess={handleReauthSuccess}
            baseUrl={remote().base_url}
            remoteName={remote().name}
          />
        )}
      </Show>
    </div>
  );
}

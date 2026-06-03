// remote admin view - manage users, invites, knocks, and peers on a P2P remote.
//
// dispatches via `freqhole-admin/1` ALPN through the spume `AdminClient`
// factory. shows a single page with sections (no tabs).
//
// only reachable when the caller's role on the remote is "admin"; the
// entry button is gated on `RemotesSettingsView`. this view double-checks
// via `whoamiForRemote` and renders a "not admin" state if the role
// changed since the rows were last evaluated.
//
// see docs/spume-remote-admin-plan.md.

import { createSignal, createResource, onMount, Show, For } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import QRCode from "qrcode";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import { whoamiForRemote } from "../../app/services/remotes/authService";
import { adminClientFor } from "../../app/api/adminClient";
import { isCharnelMode } from "../../app/services/charnel";
import { isP2PRemote, type Remote } from "../../app/services/storage/schemas/remote";
import {
  AdminClient,
  AdminCommandError,
  type AdminUserSummary,
  type AdminInviteInfo,
  type AdminPeerSummary,
} from "freqhole-api-client";
import { toast } from "../../components/feedback/Toast";
import { CopyButton } from "../../components/buttons/CopyButton";
import { DEFAULT_SHARE_WEB_HOST } from "../../utils/permalink";
import { formatDate } from "../../utils/dateTime";
import { truncateMiddle } from "../../utils/truncate";
import { UserAutocomplete, type UserSelection } from "./UserAutocomplete";
import { KnocksSection } from "./knocks/KnocksSection";

export function RemoteAdminView() {
  const params = useParams<{ remoteId: string }>();
  const navigate = useNavigate();

  const [remote, setRemote] = createSignal<Remote | null>(null);
  const [adminClient, setAdminClient] = createSignal<AdminClient | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const r = await getRemoteById(params.remoteId);
      if (!r) {
        setError(`remote ${params.remoteId} not found`);
        setLoading(false);
        return;
      }
      if (!isP2PRemote(r)) {
        setError("admin is only available for P2P remotes");
        setLoading(false);
        return;
      }
      setRemote(r);

      // re-verify role over P2P (entry gating used cached value)
      const me = await whoamiForRemote(r);
      if (!me.success || me.role !== "admin") {
        setError(`you are not an admin on this remote (role: ${me.role ?? "unknown"})`);
        setLoading(false);
        return;
      }

      const client = await adminClientFor(r);
      setAdminClient(client);
    } catch (e) {
      setError(`failed to initialize admin: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  });

  return (
    <div class="p-6 max-w-5xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <button
            class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors mb-2"
            onClick={() => navigate("/settings/remotes")}
          >
            back to remotes
          </button>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            admin: {remote()?.name ?? params.remoteId}
          </h1>
          <p class="text-sm text-[var(--color-text-muted)]">
            manage users, invites, knock requests, and peers
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Show when={!isCharnelMode()}>
            <button
              class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors"
              onClick={() => navigate(`/settings/remotes/${params.remoteId}/radio`)}
              title="manage radio stations on this remote"
            >
              manage radio
            </button>
          </Show>
        </div>
      </div>

      <Show when={loading()}>
        <div class="text-[var(--color-text-muted)]">loading admin client...</div>
      </Show>

      <Show when={!loading() && error()}>
        <div class="rounded-lg border border-red-600/30 bg-red-600/10 p-4 text-red-400">
          {error()}
        </div>
      </Show>

      <Show when={!loading() && !error() && adminClient() && remote()}>
        <div class="flex flex-col gap-8">
          <NodeIdSection remote={remote()!} />
          <KnocksSection client={adminClient()!} remote={remote()!} />
          <UsersSection client={adminClient()!} remote={remote()!} />
          <InvitesSection client={adminClient()!} />
        </div>
      </Show>
    </div>
  );
}

// ------------------------------------------------------------------
// node id + qr code (so other peers can knock to this remote easily)
// ------------------------------------------------------------------

function NodeIdSection(props: { remote: Remote }) {
  const peerAddr = () => (isP2PRemote(props.remote) ? props.remote.peer_addr : "");
  const nodeId = () => {
    // peer_addr may be a 64-hex node id or a json blob; for QR we want the id
    const v = peerAddr();
    if (/^[0-9a-f]{64}$/i.test(v)) return v;
    try {
      const parsed = JSON.parse(v);
      if (typeof parsed?.node_id === "string") return parsed.node_id;
    } catch {
      // ignore
    }
    return v;
  };

  const shareUrl = () => `${DEFAULT_SHARE_WEB_HOST}/?r=${nodeId()}`;

  const [showQr, setShowQr] = createSignal(false);
  const [qrUrl, setQrUrl] = createSignal<string | null>(null);

  const generate = async () => {
    if (!showQr()) {
      setShowQr(true);
      try {
        const url = await QRCode.toDataURL(shareUrl(), {
          width: 220,
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        });
        setQrUrl(url);
      } catch (e) {
        console.error("qr generate failed:", e);
        toast.error("failed to generate qr code");
      }
    } else {
      setShowQr(false);
      setQrUrl(null);
    }
  };

  return (
    <section class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-5">
      <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-3">remote node id</h2>
      <p class="text-sm text-[var(--color-text-muted)] mb-3">
        share this with peers who want to knock for access.
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <code class="break-all rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          {nodeId()}
        </code>
        <CopyButton
          text={nodeId()}
          label="copy"
          copiedLabel="copied!"
          title="copy node id"
          class="px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-150 disabled:opacity-50 active:scale-95"
        />
        <button
          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-all duration-150 active:scale-95"
          onClick={generate}
          title={shareUrl()}
        >
          {showQr() ? "hide qr code" : "qr code"}
        </button>
      </div>
      <Show when={showQr() && qrUrl()}>
        <div class="mt-4 flex flex-col items-center gap-2">
          <img src={qrUrl()!} alt="node id qr" class="rounded bg-white p-2" />
          <code class="text-[10px] break-all text-[var(--color-text-muted)]">{shareUrl()}</code>
        </div>
      </Show>
    </section>
  );
}

// ------------------------------------------------------------------
// shared helpers
// ------------------------------------------------------------------

type RoleOption = "admin" | "member" | "viewer";

function adminErrMessage(e: unknown): string {
  if (e instanceof AdminCommandError) {
    const first = e.response.errors?.[0];
    if (first?.detail) return first.detail;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

// ------------------------------------------------------------------
// users (with peer nodes grouped under each user)
// ------------------------------------------------------------------

function UsersSection(props: { client: AdminClient; remote: Remote }) {
  const [includeDeleted, setIncludeDeleted] = createSignal(false);
  const [refreshTick, setRefreshTick] = createSignal(0);

  const [data, { refetch }] = createResource(
    () => ({ deleted: includeDeleted(), tick: refreshTick() }),
    async ({ deleted }) => {
      try {
        const [users, peers] = await Promise.all([
          props.client.dispatchOrThrow("users_list", {
            include_deleted: deleted,
            limit: null,
            offset: null,
            username: null,
            role: null,
          }),
          props.client.dispatchOrThrow("peers_list_all", {
            include_deleted: deleted,
          }),
        ]);
        const peersByUser = new Map<string, AdminPeerSummary[]>();
        for (const p of peers) {
          const arr = peersByUser.get(p.user_id) ?? [];
          arr.push(p);
          peersByUser.set(p.user_id, arr);
        }
        return { users, peersByUser };
      } catch (e) {
        toast.error(`users load failed: ${adminErrMessage(e)}`);
        return {
          users: [] as AdminUserSummary[],
          peersByUser: new Map<string, AdminPeerSummary[]>(),
        };
      }
    }
  );

  const refresh = () => setRefreshTick((n) => n + 1);

  const [updating, setUpdating] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [hardDeleting, setHardDeleting] = createSignal<string | null>(null);
  const [restoring, setRestoring] = createSignal<string | null>(null);
  const [removingPeer, setRemovingPeer] = createSignal<string | null>(null);
  const [restoringPeer, setRestoringPeer] = createSignal<string | null>(null);
  const [showAllowForm, setShowAllowForm] = createSignal(false);

  const handleRoleChange = async (user: AdminUserSummary, role: string) => {
    if (role === user.role) return;
    setUpdating(user.id);
    try {
      await props.client.dispatchOrThrow("users_update_role", { user_id: user.id, role });
      toast.success(`${user.username} is now ${role}`);
      refresh();
    } catch (e) {
      toast.error(`update role failed: ${adminErrMessage(e)}`);
    } finally {
      setUpdating(null);
    }
  };

  const handleDelete = async (user: AdminUserSummary) => {
    if (!confirm(`delete user ${user.username}? this cannot be undone.`)) return;
    setDeleting(user.id);
    try {
      await props.client.dispatchOrThrow("users_delete", { user_id: user.id });
      toast.success(`${user.username} deleted`);
      refresh();
    } catch (e) {
      toast.error(`delete failed: ${adminErrMessage(e)}`);
    } finally {
      setDeleting(null);
    }
  };

  const handleRestore = async (user: AdminUserSummary) => {
    setRestoring(user.id);
    try {
      await props.client.dispatchOrThrow("users_restore", { user_id: user.id });
      toast.success(`${user.username} restored`);
      refresh();
    } catch (e) {
      toast.error(`restore failed: ${adminErrMessage(e)}`);
    } finally {
      setRestoring(null);
    }
  };

  const handleHardDelete = async (user: AdminUserSummary) => {
    if (
      !confirm(
        `permanently delete ${user.username} forever?\n\nthis removes the account and all FK references that don't cascade. this cannot be undone.`
      )
    )
      return;
    setHardDeleting(user.id);
    try {
      await props.client.dispatchOrThrow("users_hard_delete", {
        user_id: user.id,
      });
      toast.success(`${user.username} permanently deleted`);
      refresh();
    } catch (e) {
      toast.error(`hard delete failed: ${adminErrMessage(e)}`);
    } finally {
      setHardDeleting(null);
    }
  };

  const generateLink = async (user: AdminUserSummary): Promise<string> => {
    const resp = await props.client.dispatchOrThrow("users_generate_account_link", {
      user_id: user.id,
    });
    return resp.code;
  };

  const handleRemovePeer = async (peer: AdminPeerSummary) => {
    const key = `${peer.user_id}:${peer.node_id}`;
    if (!confirm(`remove peer ${truncateMiddle(peer.node_id, 16)} from ${peer.username}?`)) return;
    setRemovingPeer(key);
    try {
      await props.client.dispatchOrThrow("peers_remove", {
        user_id: peer.user_id,
        node_id: peer.node_id,
      });
      toast.success("peer removed");
      refresh();
    } catch (e) {
      toast.error(`remove failed: ${adminErrMessage(e)}`);
    } finally {
      setRemovingPeer(null);
    }
  };

  const handleRestorePeer = async (peer: AdminPeerSummary) => {
    const key = `${peer.user_id}:${peer.node_id}`;
    setRestoringPeer(key);
    try {
      await props.client.dispatchOrThrow("peers_restore", {
        user_id: peer.user_id,
        node_id: peer.node_id,
      });
      toast.success("peer restored");
      refresh();
    } catch (e) {
      toast.error(`restore failed: ${adminErrMessage(e)}`);
    } finally {
      setRestoringPeer(null);
    }
  };

  return (
    <section class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">users &amp; peers</h2>
        <div class="flex items-center gap-2">
          <button
            class={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors active:scale-95 ${
              includeDeleted()
                ? "bg-red-600/20 hover:bg-red-600/30 text-red-400 border-red-600/30"
                : "bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)]"
            }`}
            onClick={() => setIncludeDeleted(!includeDeleted())}
          >
            {includeDeleted() ? "hide deleted" : "show deleted"}
          </button>
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors active:scale-95"
            onClick={() => setShowAllowForm((v) => !v)}
          >
            {showAllowForm() ? "cancel allow peer" : "allow peer"}
          </button>
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors active:scale-95"
            onClick={() => refetch()}
          >
            refresh
          </button>
        </div>
      </div>

      <Show when={showAllowForm()}>
        <AllowPeerForm
          client={props.client}
          remote={props.remote}
          onAllowed={() => {
            setShowAllowForm(false);
            refresh();
          }}
        />
      </Show>

      <Show
        when={!data.loading}
        fallback={<div class="text-sm text-[var(--color-text-muted)]">loading users...</div>}
      >
        <Show
          when={(data()?.users ?? []).length > 0}
          fallback={<div class="text-sm text-[var(--color-text-muted)]">no users</div>}
        >
          <div class="flex flex-col gap-2">
            <For each={data()!.users}>
              {(user) => {
                const peers = () => data()!.peersByUser.get(user.id) ?? [];
                return (
                  <div class="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-3">
                    <div class="flex items-center justify-between gap-4 flex-wrap">
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="font-medium text-[var(--color-text-primary)]">
                            {user.username}
                          </span>
                          <span class="text-xs px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
                            {user.role}
                          </span>
                          <Show when={peers().length > 0}>
                            <span class="text-xs px-2 py-0.5 rounded bg-blue-600/20 text-blue-400">
                              {peers().length} peer{peers().length === 1 ? "" : "s"}
                            </span>
                          </Show>
                          <Show when={user.deleted_at}>
                            <span class="text-xs px-2 py-0.5 rounded bg-red-600/20 text-red-400">
                              deleted
                            </span>
                          </Show>
                          <Show when={user.haruspex_user_id}>
                            <span class="text-xs px-2 py-0.5 rounded bg-purple-600/20 text-purple-400">
                              haruspex
                            </span>
                          </Show>
                        </div>
                        <div class="text-xs text-[var(--color-text-muted)] mt-1 flex items-center gap-2 flex-wrap">
                          <span class="flex items-center gap-1">
                            user id: <code title={user.id}>{truncateMiddle(user.id, 16)}</code>
                            <CopyButton
                              text={user.id}
                              label="copy"
                              copiedLabel="copied!"
                              title="copy user id"
                            />
                          </span>
                          <span>created {formatDate(user.created_at)}</span>
                        </div>
                      </div>
                      <div class="flex items-center gap-2 shrink-0">
                        <select
                          class="text-xs px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] disabled:opacity-50"
                          value={user.role}
                          disabled={
                            updating() === user.id || user.role === "root" || !!user.deleted_at
                          }
                          onChange={(e) => handleRoleChange(user, e.currentTarget.value)}
                        >
                          <Show when={user.role === "root"}>
                            <option value="root">root</option>
                          </Show>
                          <option value="admin">admin</option>
                          <option value="member">member</option>
                          <option value="viewer">viewer</option>
                        </select>
                        <CopyButton
                          getText={() => generateLink(user)}
                          label="account link"
                          pendingLabel="generating..."
                          copiedLabel="link copied!"
                          title="generate a one-time account link code and copy it"
                          disabled={!!user.deleted_at}
                        />
                        <button
                          class="px-2 py-1 text-xs font-medium rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-all duration-150 disabled:opacity-50 active:scale-95"
                          disabled={
                            deleting() === user.id || user.role === "root" || !!user.deleted_at
                          }
                          onClick={() => handleDelete(user)}
                        >
                          {deleting() === user.id ? "..." : "delete"}
                        </button>
                        <Show when={user.deleted_at}>
                          <button
                            class="px-2 py-1 text-xs font-medium rounded bg-green-600/20 hover:bg-green-600/30 text-white border border-green-600/30 transition-all duration-150 disabled:opacity-50 active:scale-95"
                            disabled={restoring() === user.id}
                            onClick={() => handleRestore(user)}
                          >
                            {restoring() === user.id ? "..." : "restore"}
                          </button>
                          <button
                            class="px-2 py-1 text-xs font-medium rounded bg-red-700/30 hover:bg-red-700/50 text-red-300 border border-red-700/40 transition-all duration-150 disabled:opacity-50 active:scale-95"
                            disabled={hardDeleting() === user.id || user.role === "root"}
                            onClick={() => handleHardDelete(user)}
                            title="permanently delete forever"
                          >
                            {hardDeleting() === user.id ? "..." : "delete forever"}
                          </button>
                        </Show>
                      </div>
                    </div>

                    <Show when={peers().length > 0}>
                      <div class="mt-3 ml-3 pl-3 border-l border-[var(--color-border-subtle)] flex flex-col gap-1.5">
                        <For each={peers()}>
                          {(peer) => {
                            const key = `${peer.user_id}:${peer.node_id}`;
                            const peerDeleted = () => !!peer.deleted_at;
                            return (
                              <div
                                class="flex items-center gap-2 text-xs flex-wrap"
                                classList={{ "opacity-60": peerDeleted() }}
                              >
                                <span class="text-[var(--color-text-muted)]">node id:</span>
                                <code
                                  class="flex-1 min-w-0 truncate text-[var(--color-text-secondary)]"
                                  classList={{ "line-through": peerDeleted() }}
                                  title={peer.node_id}
                                >
                                  {truncateMiddle(peer.node_id, 28)}
                                </code>
                                <Show when={peerDeleted()}>
                                  <span class="text-xs px-1.5 py-0.5 rounded bg-red-600/20 text-red-400">
                                    deleted
                                  </span>
                                </Show>
                                <Show when={peer.instance_name}>
                                  <span class="text-[var(--color-text-muted)]">
                                    ({peer.instance_name})
                                  </span>
                                </Show>
                                <span class="text-[var(--color-text-muted)]">
                                  added {formatDate(peer.created_at)}
                                </span>
                                <Show when={peer.last_seen_at}>
                                  <span class="text-[var(--color-text-muted)]">
                                    seen {formatDate(peer.last_seen_at!)}
                                  </span>
                                </Show>
                                <CopyButton
                                  text={peer.node_id}
                                  label="copy"
                                  copiedLabel="copied!"
                                  title="copy node id"
                                />
                                <Show
                                  when={!peerDeleted()}
                                  fallback={
                                    <button
                                      class="px-2 py-1 text-xs font-medium rounded bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-600/30 transition-all duration-150 disabled:opacity-50 active:scale-95"
                                      disabled={restoringPeer() === key}
                                      onClick={() => handleRestorePeer(peer)}
                                    >
                                      {restoringPeer() === key ? "..." : "restore"}
                                    </button>
                                  }
                                >
                                  <button
                                    class="px-2 py-1 text-xs font-medium rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-all duration-150 disabled:opacity-50 active:scale-95"
                                    disabled={removingPeer() === key}
                                    onClick={() => handleRemovePeer(peer)}
                                  >
                                    {removingPeer() === key ? "..." : "remove"}
                                  </button>
                                </Show>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}

// inline form to allow a peer node by linking to (or creating) a user.
// rendered above the users list when toggled on.
function AllowPeerForm(props: { client: AdminClient; remote: Remote; onAllowed: () => void }) {
  const [nodeId, setNodeId] = createSignal("");
  const [selection, setSelection] = createSignal<UserSelection | null>(null);
  const [role, setRole] = createSignal<RoleOption>("viewer");
  const [allowing, setAllowing] = createSignal(false);

  const handleAllow = async () => {
    const nid = nodeId().trim();
    if (nid.length !== 64 || !/^[0-9a-f]{64}$/i.test(nid)) {
      toast.error("node id must be 64 hex characters");
      return;
    }
    const sel = selection();
    const chosenRole = sel?.isExisting ? sel.role : (sel?.role ?? role());
    const username = sel?.username?.trim() || null;
    const userId = sel?.isExisting ? (sel.id ?? null) : null;
    setAllowing(true);
    try {
      const resp = await props.client.dispatchOrThrow("peers_allow", {
        node_id: nid,
        role: chosenRole,
        username,
        user_id: userId,
      });
      toast.success(
        resp.created_user
          ? `created ${resp.username} and allowed peer`
          : `allowed peer for ${resp.username}`
      );
      setNodeId("");
      setSelection(null);
      props.onAllowed();
    } catch (e) {
      toast.error(`allow failed: ${adminErrMessage(e)}`);
    } finally {
      setAllowing(false);
    }
  };

  return (
    <div class="mb-4 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-3">
      <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-2">allow peer</div>
      <div class="flex flex-col gap-2">
        <input
          type="text"
          placeholder="node id (64 hex)"
          class="w-full px-2 py-1 text-sm font-mono rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
          value={nodeId()}
          onInput={(e) => setNodeId(e.currentTarget.value)}
        />
        <div class="flex items-end gap-2 flex-wrap">
          <div class="flex-1 min-w-48">
            <UserAutocomplete
              remote={props.remote}
              placeholder="username (existing or new)..."
              defaultRole={role()}
              onSelect={(sel) => setSelection(sel)}
            />
          </div>
          <select
            class="text-xs px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] disabled:opacity-50"
            value={selection()?.isExisting ? selection()!.role : role()}
            disabled={selection()?.isExisting ?? false}
            onChange={(e) => setRole(e.currentTarget.value as RoleOption)}
          >
            <option value="viewer">viewer</option>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-all duration-150 disabled:opacity-50 active:scale-95"
            disabled={allowing() || !nodeId().trim()}
            onClick={handleAllow}
          >
            {allowing() ? "allowing..." : "allow"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// invites
// ------------------------------------------------------------------

function InvitesSection(props: { client: AdminClient }) {
  const [activeOnly, setActiveOnly] = createSignal(true);
  const [invites, { refetch }] = createResource(
    () => ({ active: activeOnly() }),
    async ({ active }) => {
      try {
        return await props.client.dispatchOrThrow("invites_list", { active_only: active });
      } catch (e) {
        toast.error(`invites list failed: ${adminErrMessage(e)}`);
        return [] as AdminInviteInfo[];
      }
    }
  );

  const [genCount, setGenCount] = createSignal(1);
  const [genWordCount, setGenWordCount] = createSignal(3);
  const [genRole, setGenRole] = createSignal<RoleOption>("viewer");
  const [genExpiresHours, setGenExpiresHours] = createSignal<number | null>(null);
  const [generating, setGenerating] = createSignal(false);
  const [lastGenerated, setLastGenerated] = createSignal<string[]>([]);

  const [revoking, setRevoking] = createSignal<string | null>(null);
  const [updatingRole, setUpdatingRole] = createSignal<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const resp = await props.client.dispatchOrThrow("invites_generate", {
        count: genCount(),
        word_count: genWordCount(),
        role: genRole(),
        expires_hours: genExpiresHours(),
      });
      const codes = resp.codes.map((c) => c.code);
      setLastGenerated(codes);
      toast.success(`generated ${codes.length} invite${codes.length === 1 ? "" : "s"}`);
      await refetch();
    } catch (e) {
      toast.error(`generate failed: ${adminErrMessage(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (invite: AdminInviteInfo) => {
    setRevoking(invite.code);
    try {
      await props.client.dispatchOrThrow("invites_revoke", { code: invite.code });
      toast.success(`revoked ${invite.code}`);
      await refetch();
    } catch (e) {
      toast.error(`revoke failed: ${adminErrMessage(e)}`);
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeAll = async () => {
    if (!confirm("revoke ALL active invites? this cannot be undone.")) return;
    try {
      const resp = await props.client.dispatchOrThrow("invites_revoke_all", undefined);
      toast.success(`revoked ${resp.revoked} invite${resp.revoked === 1 ? "" : "s"}`);
      await refetch();
    } catch (e) {
      toast.error(`revoke all failed: ${adminErrMessage(e)}`);
    }
  };

  const handleUpdateRole = async (invite: AdminInviteInfo, role: string) => {
    if (role === invite.grants_role) return;
    setUpdatingRole(invite.code);
    try {
      await props.client.dispatchOrThrow("invites_update_role", { code: invite.code, role });
      toast.success(`invite now grants ${role}`);
      await refetch();
    } catch (e) {
      toast.error(`update role failed: ${adminErrMessage(e)}`);
    } finally {
      setUpdatingRole(null);
    }
  };

  return (
    <section class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">invites</h2>
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={activeOnly()}
              onChange={(e) => setActiveOnly(e.currentTarget.checked)}
            />
            active only
          </label>
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors active:scale-95"
            onClick={() => refetch()}
          >
            refresh
          </button>
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-colors active:scale-95"
            onClick={handleRevokeAll}
          >
            revoke all
          </button>
        </div>
      </div>

      <div class="mb-4 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-3">
        <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-2">
          generate invites
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            count
            <input
              type="number"
              min="1"
              max="100"
              class="w-20 px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
              value={genCount()}
              onInput={(e) => setGenCount(Math.max(1, Number(e.currentTarget.value) || 1))}
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            words
            <input
              type="number"
              min="2"
              max="8"
              class="w-20 px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
              value={genWordCount()}
              onInput={(e) => setGenWordCount(Math.max(2, Number(e.currentTarget.value) || 3))}
            />
          </label>
          <label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            role
            <select
              class="px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
              value={genRole()}
              onChange={(e) => setGenRole(e.currentTarget.value as RoleOption)}
            >
              <option value="viewer">viewer</option>
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <label class="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
            expires (hours, blank = never)
            <input
              type="number"
              min="1"
              class="w-32 px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]"
              value={genExpiresHours() ?? ""}
              onInput={(e) => {
                const v = e.currentTarget.value;
                setGenExpiresHours(v === "" ? null : Math.max(1, Number(v) || 1));
              }}
            />
          </label>
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-all duration-150 disabled:opacity-50 active:scale-95"
            disabled={generating()}
            onClick={handleGenerate}
          >
            {generating() ? "generating..." : "generate"}
          </button>
        </div>
        <Show when={lastGenerated().length > 0}>
          <div class="mt-3 rounded border border-green-600/30 bg-green-600/10 p-2">
            <div class="text-xs font-medium text-green-400 mb-1">just generated:</div>
            <For each={lastGenerated()}>
              {(code) => (
                <div class="flex items-center gap-2 text-xs font-mono">
                  <code class="flex-1 break-all">{code}</code>
                  <CopyButton text={code} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show
        when={!invites.loading}
        fallback={<div class="text-sm text-[var(--color-text-muted)]">loading invites...</div>}
      >
        <Show
          when={(invites() ?? []).length > 0}
          fallback={<div class="text-sm text-[var(--color-text-muted)]">no invites</div>}
        >
          <div class="flex flex-col gap-2">
            <For each={invites() ?? []}>
              {(invite) => (
                <div class="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-3">
                  <div class="flex items-center justify-between gap-3 flex-wrap">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <code class="font-mono text-sm text-[var(--color-text-primary)] break-all">
                          {invite.code}
                        </code>
                        <span class="text-xs px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
                          {invite.code_type}
                        </span>
                        <Show when={!invite.is_active}>
                          <span class="text-xs px-2 py-0.5 rounded bg-red-600/20 text-red-400">
                            inactive
                          </span>
                        </Show>
                        <Show when={invite.used_at}>
                          <span class="text-xs px-2 py-0.5 rounded bg-gray-600/20 text-gray-400">
                            used
                          </span>
                        </Show>
                      </div>
                      <div class="text-xs text-[var(--color-text-muted)] mt-1 flex flex-wrap gap-3">
                        <span>created {formatDate(invite.created_at)}</span>
                        <Show when={invite.expires_at}>
                          <span>expires {formatDate(invite.expires_at!)}</span>
                        </Show>
                        <Show when={invite.used_by_username}>
                          <span>used by {invite.used_by_username}</span>
                        </Show>
                        <Show when={invite.link_for_username}>
                          <span>for {invite.link_for_username}</span>
                        </Show>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <select
                        class="text-xs px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] disabled:opacity-50"
                        value={invite.grants_role}
                        disabled={updatingRole() === invite.code || !invite.is_active}
                        onChange={(e) => handleUpdateRole(invite, e.currentTarget.value)}
                      >
                        <option value="viewer">viewer</option>
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                      </select>
                      <CopyButton text={invite.code} title="copy invite code" />
                      <Show when={invite.is_active}>
                        <button
                          class="px-2 py-1 text-xs font-medium rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-all duration-150 disabled:opacity-50 active:scale-95"
                          disabled={revoking() === invite.code}
                          onClick={() => handleRevoke(invite)}
                        >
                          {revoking() === invite.code ? "..." : "revoke"}
                        </button>
                      </Show>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}

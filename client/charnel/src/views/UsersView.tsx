import { createSignal, createEffect, For, Show } from "solid-js";
import { useAdminTransport } from "../admin/context";

interface User {
  id: string;
  username: string;
  role: string;
  created_at: number;
  deleted_at?: number | null;
}

interface PeerNodeInfo {
  user_id: string;
  node_id: string;
  instance_name: string | null;
  created_at: number;
  last_seen_at: number | null;
  username: string;
  role: string;
  deleted_at?: number | null;
  user_deleted_at?: number | null;
}

interface KnockInfo {
  id: string;
  node_id: string;
  username: string;
  message: string;
  status: string;
  created_at: number;
  processed_at: number | null;
  processed_by: string | null;
}

interface InviteCode {
  code: string;
  code_type: string;
  grants_role: string;
  created_at: number;
  expires_at: number | null;
  used_at: number | null;
  used_by: string | null;
  used_by_username: string | null;
  link_for_user_id: string | null;
  link_for_username: string | null;
  is_active: boolean;
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function UsersView() {
  const admin = useAdminTransport();
  const [users, setUsers] = createSignal<User[]>([]);
  const [invites, setInvites] = createSignal<InviteCode[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [invitesLoading, setInvitesLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [generating, setGenerating] = createSignal(false);
  const [showInactive, setShowInactive] = createSignal(false);
  const [deactivatingAll, setDeactivatingAll] = createSignal(false);
  const [confirmDeactivateAll, setConfirmDeactivateAll] = createSignal(false);
  const [includeDeleted, setIncludeDeleted] = createSignal(false);
  const [linkCopiedUserId, setLinkCopiedUserId] = createSignal<string | null>(
    null,
  );
  const [copiedInviteCode, setCopiedInviteCode] = createSignal<string | null>(
    null,
  );

  // peers and knocks (loaded across all users so we can aggregate counts
  // and surface knock messages per peer node)
  const [peers, setPeers] = createSignal<PeerNodeInfo[]>([]);
  const [knocks, setKnocks] = createSignal<KnockInfo[]>([]);
  const [expandedUserId, setExpandedUserId] = createSignal<string | null>(null);
  const [removingNodeId, setRemovingNodeId] = createSignal<string | null>(null);
  const [copiedPeerNodeId, setCopiedPeerNodeId] = createSignal<string | null>(
    null,
  );

  // reload whenever the active admin target or include-deleted flag changes
  createEffect(() => {
    admin.current();
    includeDeleted();
    void Promise.all([loadUsers(), loadInvites(), loadPeersAndKnocks()]);
  });

  async function loadPeersAndKnocks() {
    try {
      const [peerList, knockList] = await Promise.all([
        admin.dispatchOrThrow<PeerNodeInfo[]>("peers_list_all", {
          include_deleted: true,
        }),
        admin
          .dispatchOrThrow<KnockInfo[]>("knocks_list_all", {})
          .catch(() => [] as KnockInfo[]),
      ]);
      setPeers(peerList);
      setKnocks(knockList);
    } catch (e) {
      console.error("failed to load peers/knocks:", e);
    }
  }

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      // always fetch the full set; the deleted-only toggle filters
      // client-side so we can show a badge with the count without a
      // round-trip.
      const result = await admin.dispatchOrThrow<User[]>("users_list", {
        include_deleted: true,
      });
      setUsers(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadInvites() {
    setInvitesLoading(true);
    try {
      const result = await admin.dispatchOrThrow<InviteCode[]>("invites_list", {
        active_only: false,
      });
      setInvites(result);
    } catch (e) {
      console.error("failed to load invites:", e);
    } finally {
      setInvitesLoading(false);
    }
  }

  async function updateRole(userId: string, newRole: string) {
    try {
      await admin.dispatchOrThrow("users_update_role", {
        user_id: userId,
        role: newRole,
      });
      await loadUsers();
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteUser(userId: string, username: string) {
    if (!confirm(`delete user "${username}"? this cannot be undone.`)) return;
    try {
      await admin.dispatchOrThrow("users_delete", { user_id: userId });
      await loadUsers();
    } catch (e) {
      setError(String(e));
    }
  }

  async function hardDeleteUser(userId: string, username: string) {
    if (
      !confirm(
        `permanently delete user "${username}" forever?\n\nthis removes the account and all FK references that don't cascade. this cannot be undone.`,
      )
    )
      return;
    try {
      await admin.dispatchOrThrow("users_hard_delete", { user_id: userId });
      await loadUsers();
    } catch (e) {
      setError(String(e));
    }
  }

  async function restoreUser(userId: string) {
    try {
      await admin.dispatchOrThrow("users_restore", { user_id: userId });
      await loadUsers();
    } catch (e) {
      setError(String(e));
    }
  }

  async function generateInvite() {
    setGenerating(true);
    try {
      await admin.dispatchOrThrow("invites_generate", { count: 1 });
      await loadInvites();
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function deactivateInvite(code: string) {
    try {
      await admin.dispatchOrThrow("invites_revoke", { code });
      await loadInvites();
    } catch (e) {
      setError(String(e));
    }
  }

  async function deactivateAllInvites() {
    setDeactivatingAll(true);
    setConfirmDeactivateAll(false);
    try {
      await admin.dispatchOrThrow("invites_revoke_all", {});
      await loadInvites();
    } catch (e) {
      setError(String(e));
    } finally {
      setDeactivatingAll(false);
    }
  }

  async function updateInviteRole(code: string, role: string) {
    try {
      await admin.dispatchOrThrow("invites_update_role", { code, role });
      await loadInvites();
    } catch (e) {
      setError(String(e));
    }
  }

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedInviteCode(text);
      setTimeout(() => setCopiedInviteCode(null), 5000);
      return true;
    } catch (e) {
      console.error("copy failed:", e);
      return false;
    }
  }

  async function generateAccountLink(userId: string) {
    setError("");
    try {
      const result = await admin.dispatchOrThrow<{ code: string }>(
        "users_generate_account_link",
        { user_id: userId },
      );
      const code = result.code;
      console.log("generated account link code:", code);
      // show feedback immediately - code is generated and visible in invites list
      setLinkCopiedUserId(userId);
      setTimeout(() => setLinkCopiedUserId(null), 5000);
      // attempt clipboard copy (may fail due to expired user gesture)
      try {
        await navigator.clipboard.writeText(code);
      } catch (e) {
        console.log(
          "clipboard copy failed (expected after async dispatch):",
          e,
        );
      }
      await loadInvites();
    } catch (e) {
      setError(String(e));
    }
  }

  // filtered invites based on show/hide inactive toggle
  const visibleInvites = () => {
    if (showInactive()) {
      return invites();
    }
    return invites().filter((i) => i.is_active && !i.used_by);
  };

  const activeInviteCount = () =>
    invites().filter((i) => i.is_active && !i.used_by).length;

  const inactiveInviteCount = () =>
    invites().filter((i) => !i.is_active || i.used_by).length;

  // most-recent knock per node_id (for surfacing original join message).
  const knockByNodeId = (): Map<string, KnockInfo> => {
    const map = new Map<string, KnockInfo>();
    for (const k of knocks()) {
      const existing = map.get(k.node_id);
      if (!existing || k.created_at > existing.created_at) {
        map.set(k.node_id, k);
      }
    }
    return map;
  };

  // peers grouped by user_id (live + deleted peers all included).
  const peersByUserId = (): Map<string, PeerNodeInfo[]> => {
    const map = new Map<string, PeerNodeInfo[]>();
    for (const p of peers()) {
      const arr = map.get(p.user_id);
      if (arr) arr.push(p);
      else map.set(p.user_id, [p]);
    }
    return map;
  };

  // filter the user list based on the deleted-only toggle. when on,
  // shows ONLY deleted users; when off, only live ones.
  const visibleUsers = (): User[] => {
    const wantDeleted = includeDeleted();
    return users().filter((u) =>
      wantDeleted ? !!u.deleted_at : !u.deleted_at,
    );
  };

  const deletedUserCount = (): number =>
    users().filter((u) => !!u.deleted_at).length;

  function formatNodeId(nodeId: string): string {
    if (nodeId.length <= 16) return nodeId;
    return `${nodeId.slice(0, 8)}…${nodeId.slice(-8)}`;
  }

  async function copyNodeId(nodeId: string) {
    try {
      await navigator.clipboard.writeText(nodeId);
      setCopiedPeerNodeId(nodeId);
      setTimeout(() => setCopiedPeerNodeId(null), 3000);
    } catch (e) {
      console.error("copy failed:", e);
    }
  }

  function toggleExpand(userId: string) {
    setExpandedUserId(expandedUserId() === userId ? null : userId);
  }

  async function removePeerNode(userId: string, nodeId: string) {
    if (
      !confirm(
        `remove peer node ${formatNodeId(nodeId)}?\n\nthis soft-deletes the peer; you can restore it from the federation view.`,
      )
    )
      return;
    setRemovingNodeId(nodeId);
    try {
      await admin.dispatchOrThrow("peers_remove", {
        user_id: userId,
        node_id: nodeId,
      });
      await loadPeersAndKnocks();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemovingNodeId(null);
    }
  }

  async function restorePeerNode(userId: string, nodeId: string) {
    setRemovingNodeId(nodeId);
    try {
      await admin.dispatchOrThrow("peers_restore", {
        user_id: userId,
        node_id: nodeId,
      });
      await loadPeersAndKnocks();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemovingNodeId(null);
    }
  }

  async function hardDeletePeerNode(nodeId: string) {
    if (
      !confirm(
        `permanently delete peer node ${formatNodeId(nodeId)}?\n\nthis cannot be undone. all knock requests + history for this peer will be gone.`,
      )
    )
      return;
    setRemovingNodeId(nodeId);
    try {
      await admin.dispatchOrThrow("peers_hard_delete", { node_id: nodeId });
      await loadPeersAndKnocks();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemovingNodeId(null);
    }
  }

  return (
    <div class="view-content">
      <div class="view-header">
        <h1 class="active">
          user<span class="pinky">z</span>
        </h1>
      </div>

      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>

      {/* users section */}
      <div class="section">
        <div class="invite-toolbar">
          <div class="flex-spacer" />
          <button
            class={`small ${includeDeleted() ? "active" : "secondary"}`}
            onClick={() => setIncludeDeleted(!includeDeleted())}
            disabled={!includeDeleted() && deletedUserCount() === 0}
          >
            {includeDeleted()
              ? "show active"
              : `show deleted (${deletedUserCount()})`}
          </button>
        </div>
        <Show when={loading()}>
          <div class="loading">
            <div class="spinner" />
            <span class="active">
              loading user<span class="pinky">z</span>...
            </span>
          </div>
        </Show>

        <Show when={!loading()}>
          <Show when={visibleUsers().length === 0}>
            <p class="empty active">
              <Show
                when={includeDeleted()}
                fallback={
                  <>
                    no user<span class="pinky">z</span> yet.
                  </>
                }
              >
                no deleted user<span class="pinky">z</span>.
              </Show>
            </p>
          </Show>
          <For each={visibleUsers()}>
            {(user) => {
              const userPeers = () => peersByUserId().get(user.id) ?? [];
              const livePeerCount = () =>
                userPeers().filter((p) => !p.deleted_at && !p.user_deleted_at)
                  .length;
              const isExpanded = () => expandedUserId() === user.id;
              return (
                <div
                  class="list-item user-item"
                  style={{
                    ...(user.deleted_at ? { opacity: 0.6 } : {}),
                    cursor: "pointer",
                  }}
                  onClick={(e) => {
                    // don't toggle when clicking interactive controls
                    // or anywhere inside the expanded peer panel
                    const target = e.target as HTMLElement;
                    if (target.closest("select,button,input,a,textarea"))
                      return;
                    if (target.closest(".user-peer-panel")) return;
                    toggleExpand(user.id);
                  }}
                  title={isExpanded() ? "click to collapse" : "click to expand"}
                >
                  <div class="user-row">
                    <div class="item-info">
                      <div class="item-name username-row">
                        <span
                          style={
                            user.deleted_at
                              ? { "text-decoration": "line-through" }
                              : {}
                          }
                        >
                          {user.username}
                        </span>
                        <Show when={userPeers().length > 0}>
                          <span
                            class="item-meta"
                            title={`${livePeerCount()} active / ${userPeers().length} total peer node(s)`}
                            style={{
                              background: "var(--color-bg-tertiary, #2a2a2a)",
                              "border-radius": "10px",
                              padding: "0.125rem 0.5rem",
                              "font-size": "0.75rem",
                            }}
                          >
                            {livePeerCount() === userPeers().length
                              ? `${userPeers().length} peer${userPeers().length === 1 ? "" : "s"}`
                              : `${livePeerCount()}/${userPeers().length} peers`}
                          </span>
                        </Show>
                        <Show when={user.deleted_at}>
                          <span class="item-meta" style={{ color: "#ef4444" }}>
                            (deleted)
                          </span>
                        </Show>

                        <Show when={user.role !== "root" && !user.deleted_at}>
                          <span class="role-item-actions">
                            <select
                              value={user.role}
                              onChange={(e) =>
                                updateRole(user.id, e.currentTarget.value)
                              }
                            >
                              <option value="admin">admin</option>
                              <option value="member">member</option>
                              <option value="viewer">viewer</option>
                            </select>
                          </span>
                        </Show>
                        <span
                          class="item-meta"
                          style={{
                            "margin-left": "auto",
                            color: "var(--color-text-muted, #666)",
                            "font-size": "0.75rem",
                          }}
                        >
                          {isExpanded() ? "▾" : "▸"}
                        </span>
                      </div>
                      <span class="item-meta">
                        {user.role} · joined {formatDate(user.created_at)}
                      </span>
                    </div>
                  </div>
                  <Show when={user.role !== "root"}>
                    <div class="user-actions-row">
                      <Show when={!user.deleted_at}>
                        <button
                          class="danger small"
                          onClick={() => deleteUser(user.id, user.username)}
                        >
                          delete
                        </button>

                        <button
                          class="secondary small"
                          onClick={() => generateAccountLink(user.id)}
                          title="generate account-link code"
                        >
                          {linkCopiedUserId() === user.id
                            ? "created!"
                            : "+ link"}
                        </button>
                      </Show>
                      <Show when={user.deleted_at}>
                        <button
                          class="primary small"
                          style={{ color: "#ffffff" }}
                          onClick={() => restoreUser(user.id)}
                        >
                          restore
                        </button>
                        <button
                          class="danger small"
                          onClick={() => hardDeleteUser(user.id, user.username)}
                          title="permanently delete forever"
                        >
                          delete forever
                        </button>
                      </Show>
                    </div>
                  </Show>
                  <Show when={isExpanded()}>
                    <div
                      class="user-peer-panel"
                      style={{
                        "margin-top": "0.75rem",
                        "border-top": "1px solid var(--color-border, #333)",
                        "padding-top": "0.75rem",
                        display: "flex",
                        "flex-direction": "column",
                        gap: "0.75rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "0.5rem",
                        }}
                      >
                        <span
                          class="item-meta"
                          style={{
                            "font-size": "0.75rem",
                            "text-transform": "uppercase",
                            "letter-spacing": "0.05em",
                            color: "var(--color-text-tertiary, #888)",
                          }}
                        >
                          peer nodez ({userPeers().length})
                        </span>
                        <code
                          class="user-id"
                          title="click to copy user id"
                          style={{
                            "font-size": "0.7rem",
                            cursor: "pointer",
                            color: "var(--color-text-muted, #666)",
                            "margin-left": "auto",
                          }}
                          onClick={() => copyNodeId(user.id)}
                        >
                          {copiedPeerNodeId() === user.id
                            ? "copied!"
                            : `id: ${user.id}`}
                        </code>
                        <button
                          class="secondary small"
                          onClick={() => setExpandedUserId(null)}
                          title="close"
                          style={{ "min-width": "2rem" }}
                        >
                          ×
                        </button>
                      </div>
                      <Show
                        when={userPeers().length > 0}
                        fallback={
                          <div
                            class="item-meta"
                            style={{
                              "font-style": "italic",
                              color: "var(--color-text-muted, #666)",
                            }}
                          >
                            no peer nodes registered for this user.
                          </div>
                        }
                      >
                        <div
                          style={{
                            display: "flex",
                            "flex-direction": "column",
                            gap: "0.5rem",
                          }}
                        >
                          <For each={userPeers()}>
                            {(peer) => {
                              const peerDeleted = () =>
                                !!peer.deleted_at || !!peer.user_deleted_at;
                              const knock = () =>
                                knockByNodeId().get(peer.node_id);
                              return (
                                <div
                                  class="peer-node-row"
                                  style={{
                                    display: "flex",
                                    "flex-direction": "column",
                                    gap: "0.5rem",
                                    padding: "0.75rem",
                                    background:
                                      "var(--color-bg-secondary, #1a1a1a)",
                                    border:
                                      "1px solid var(--color-border, #333)",
                                    "border-radius": "6px",
                                    opacity: peerDeleted() ? 0.6 : 1,
                                  }}
                                >
                                  {/* row 1: node id + status */}
                                  <div
                                    style={{
                                      display: "flex",
                                      "align-items": "center",
                                      gap: "0.5rem",
                                      "flex-wrap": "wrap",
                                    }}
                                  >
                                    <code
                                      style={{
                                        "font-size": "0.8125rem",
                                        cursor: "pointer",
                                        "word-break": "break-all",
                                      }}
                                      title={`click to copy: ${peer.node_id}`}
                                      onClick={() => copyNodeId(peer.node_id)}
                                    >
                                      {copiedPeerNodeId() === peer.node_id
                                        ? "copied!"
                                        : formatNodeId(peer.node_id)}
                                    </code>
                                    <Show when={peerDeleted()}>
                                      <span
                                        class="item-meta"
                                        style={{
                                          color: "#ef4444",
                                          "font-size": "0.7rem",
                                          background: "rgba(239,68,68,0.15)",
                                          padding: "0.125rem 0.5rem",
                                          "border-radius": "10px",
                                        }}
                                      >
                                        {peer.user_deleted_at
                                          ? "user deleted"
                                          : "deleted"}
                                      </span>
                                    </Show>
                                  </div>

                                  {/* row 2: metadata */}
                                  <div
                                    style={{
                                      display: "flex",
                                      "flex-wrap": "wrap",
                                      gap: "0.75rem",
                                      "font-size": "0.75rem",
                                      color:
                                        "var(--color-text-secondary, #888)",
                                    }}
                                  >
                                    <Show when={peer.instance_name}>
                                      <span>
                                        instance:{" "}
                                        <strong>{peer.instance_name}</strong>
                                      </span>
                                    </Show>
                                    <span>
                                      added {formatDateTime(peer.created_at)}
                                    </span>
                                    <Show when={peer.last_seen_at}>
                                      <span>
                                        last seen{" "}
                                        {formatDateTime(peer.last_seen_at!)}
                                      </span>
                                    </Show>
                                  </div>

                                  {/* row 3: knock message */}
                                  <Show when={knock()?.message}>
                                    <div
                                      style={{
                                        "font-size": "0.8125rem",
                                        "font-style": "italic",
                                        color:
                                          "var(--color-text-secondary, #888)",
                                        "border-left":
                                          "2px solid var(--color-accent-500, #ff69b4)",
                                        padding: "0.25rem 0.5rem",
                                        background:
                                          "var(--color-bg-tertiary, #2a2a2a)",
                                        "border-radius": "0 4px 4px 0",
                                      }}
                                      title="original knock request message"
                                    >
                                      “{knock()!.message}”
                                    </div>
                                  </Show>

                                  {/* row 4: actions */}
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: "0.5rem",
                                      "justify-content": "flex-end",
                                      "flex-wrap": "wrap",
                                    }}
                                  >
                                    <Show when={peer.deleted_at}>
                                      <button
                                        class="primary small"
                                        style={{ color: "#ffffff" }}
                                        onClick={() =>
                                          restorePeerNode(user.id, peer.node_id)
                                        }
                                        disabled={
                                          removingNodeId() === peer.node_id
                                        }
                                        title="restore this peer node"
                                      >
                                        {removingNodeId() === peer.node_id
                                          ? "..."
                                          : "restore"}
                                      </button>
                                      <button
                                        class="danger small"
                                        onClick={() =>
                                          hardDeletePeerNode(peer.node_id)
                                        }
                                        disabled={
                                          removingNodeId() === peer.node_id
                                        }
                                        title="permanently delete forever"
                                      >
                                        delete forever
                                      </button>
                                    </Show>
                                    <Show when={!peer.deleted_at}>
                                      <button
                                        class="danger small"
                                        onClick={() =>
                                          removePeerNode(user.id, peer.node_id)
                                        }
                                        disabled={
                                          removingNodeId() === peer.node_id
                                        }
                                        title="remove this peer node"
                                      >
                                        {removingNodeId() === peer.node_id
                                          ? "..."
                                          : "drop"}
                                      </button>
                                    </Show>
                                  </div>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </div>

      {/* invites section */}
      <div class="section">
        <h2 class="active">
          invite<span class="pinky">z</span>
        </h2>
        <div class="invite-toolbar">
          <button
            class="primary small"
            onClick={generateInvite}
            disabled={generating()}
          >
            {generating() ? "generating..." : "generate invite"}
          </button>
          <Show when={activeInviteCount() > 0 && !confirmDeactivateAll()}>
            <button
              class="danger small"
              onClick={() => setConfirmDeactivateAll(true)}
              disabled={deactivatingAll()}
            >
              {deactivatingAll()
                ? "deactivating..."
                : `deactivate all (${activeInviteCount()})`}
            </button>
          </Show>
          <Show when={confirmDeactivateAll()}>
            <button
              class="danger small"
              onClick={deactivateAllInvites}
              disabled={deactivatingAll()}
            >
              {deactivatingAll() ? "deactivating..." : "confirm"}
            </button>
            <button
              class="secondary small"
              onClick={() => setConfirmDeactivateAll(false)}
            >
              cancel
            </button>
          </Show>
          <div class="flex-spacer" />
          <Show when={inactiveInviteCount() > 0}>
            <button
              class={`small ${showInactive() ? "active" : "secondary"}`}
              onClick={() => setShowInactive(!showInactive())}
            >
              {showInactive()
                ? `hide inactive (${inactiveInviteCount()})`
                : `show inactive (${inactiveInviteCount()})`}
            </button>
          </Show>
        </div>

        <Show when={invitesLoading()}>
          <div class="loading">
            <div class="spinner" />
            <span>loading invitez...</span>
          </div>
        </Show>

        <Show when={!invitesLoading()}>
          <Show when={visibleInvites().length === 0}>
            <p class="empty">no invite codez yet.</p>
          </Show>
          <For each={visibleInvites()}>
            {(invite) => (
              <div
                class={`list-item invite-item ${!invite.is_active || invite.used_by ? "inactive" : ""}`}
              >
                <div class="item-info invite-info">
                  <div class="invite-main">
                    <span class="invite-type">{invite.code_type}</span>
                    <code class="invite-code">{invite.code}</code>
                    <Show when={invite.is_active && !invite.used_by}>
                      <button
                        class="secondary small copy-btn"
                        onClick={() => copyToClipboard(invite.code)}
                      >
                        {copiedInviteCode() === invite.code
                          ? "copied!"
                          : "copy"}
                      </button>
                    </Show>
                  </div>
                  <span class="item-meta">
                    {invite.used_by ? (
                      <>
                        used by{" "}
                        <strong>
                          {invite.used_by_username || invite.used_by}
                        </strong>
                        <Show when={invite.code_type === "invite"}>
                          {" "}
                          (granted {invite.grants_role})
                        </Show>
                      </>
                    ) : invite.code_type === "accountlink" &&
                      invite.link_for_username ? (
                      <>
                        for <strong>{invite.link_for_username}</strong>
                      </>
                    ) : invite.is_active ? (
                      <>grants {invite.grants_role}</>
                    ) : (
                      <>inactive</>
                    )}
                    {" · "}created {formatDateTime(invite.created_at)}
                    <Show when={invite.expires_at}>
                      <span class="expires-text">
                        {" · "}expires {formatDateTime(invite.expires_at!)}
                      </span>
                    </Show>
                  </span>
                </div>
                <div class="item-actions">
                  <Show
                    when={
                      invite.is_active &&
                      !invite.used_by &&
                      invite.code_type === "invite"
                    }
                  >
                    <select
                      value={invite.grants_role}
                      onChange={(e) =>
                        updateInviteRole(invite.code, e.currentTarget.value)
                      }
                    >
                      <option value="admin">admin</option>
                      <option value="member">member</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </Show>
                  <Show when={invite.is_active && !invite.used_by}>
                    <button
                      class="danger small"
                      onClick={() => deactivateInvite(invite.code)}
                    >
                      deactivate
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

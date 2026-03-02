import { createSignal, onMount, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface User {
  id: string;
  username: string;
  role: string;
  created_at: number;
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
  const [users, setUsers] = createSignal<User[]>([]);
  const [invites, setInvites] = createSignal<InviteCode[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [invitesLoading, setInvitesLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [generating, setGenerating] = createSignal(false);

  onMount(async () => {
    await Promise.all([loadUsers(), loadInvites()]);
  });

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      const result = await invoke<User[]>("list_users");
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
      const result = await invoke<InviteCode[]>("list_invites", {
        activeOnly: false,
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
      await invoke("update_user_role", { userId, role: newRole });
      await loadUsers();
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteUser(userId: string, username: string) {
    if (!confirm(`delete user "${username}"? this cannot be undone.`)) return;
    try {
      await invoke("delete_user", { userId });
      await loadUsers();
    } catch (e) {
      setError(String(e));
    }
  }

  async function generateInvite() {
    setGenerating(true);
    try {
      await invoke("generate_invites", { count: 1 });
      await loadInvites();
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function deactivateInvite(code: string) {
    try {
      await invoke("deactivate_invite", { code });
      await loadInvites();
    } catch (e) {
      setError(String(e));
    }
  }

  async function updateInviteRole(code: string, role: string) {
    try {
      await invoke("update_invite_role", { code, role });
      await loadInvites();
    } catch (e) {
      setError(String(e));
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error("copy failed:", e);
    }
  }

  async function generateAccountLink(userId: string) {
    try {
      const code = await invoke<string>("generate_account_link_code", {
        userId,
      });
      await copyToClipboard(code);
      await loadInvites();
    } catch (e) {
      setError(String(e));
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
        <Show when={loading()}>
          <div class="loading">
            <div class="spinner" />
            <span class="active">
              loading user<span class="pinky">z</span>...
            </span>
          </div>
        </Show>

        <Show when={!loading()}>
          <Show when={users().length === 0}>
            <p class="empty active">
              no user<span class="pinky">z</span> yet.
            </p>
          </Show>
          <For each={users()}>
            {(user) => (
              <div class="list-item user-item">
                <div class="user-row">
                  <div class="item-info">
                    <div class="item-name username-row">
                      {user.username}

                      <Show when={user.role !== "root"}>
                        <span class="role-item-actions">
                          <select
                            value={user.role}
                            onChange={(e) =>
                              updateRole(user.id, e.currentTarget.value)
                            }
                          >
                            <option value="admin">admin</option>
                            <option value="member">member</option>
                            <option value="guest">guest</option>
                          </select>
                        </span>
                      </Show>
                    </div>
                    <span class="item-meta">
                      {user.role} · joined {formatDate(user.created_at)}
                    </span>
                    <span class="user-id">{user.id}</span>
                  </div>
                </div>
                <Show when={user.role !== "root"}>
                  <div class="user-actions-row">
                    <button
                      class="danger small"
                      onClick={() => deleteUser(user.id, user.username)}
                    >
                      delete
                    </button>

                    <button
                      class="secondary small"
                      onClick={() => generateAccountLink(user.id)}
                      title="generate account-link code (copies to clipboard)"
                    >
                      + link
                    </button>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* invites section */}
      <div class="section">
        <h2 class="active">
          invite<span class="pinky">z</span>
        </h2>
        <div class="invite-generator">
          <button
            class="primary small"
            onClick={generateInvite}
            disabled={generating()}
          >
            {generating() ? "generating..." : "generate invite"}
          </button>
        </div>

        <Show when={invitesLoading()}>
          <div class="loading">
            <div class="spinner" />
            <span>loading invitez...</span>
          </div>
        </Show>

        <Show when={!invitesLoading()}>
          <Show when={invites().length === 0}>
            <p class="empty">no invite codez yet.</p>
          </Show>
          <For each={invites()}>
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
                        copy
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
                      {" · "}expires {formatDateTime(invite.expires_at!)}
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

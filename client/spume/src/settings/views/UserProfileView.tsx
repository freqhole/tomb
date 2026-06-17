// user profile settings view
//
// route: /settings/remotes/:remoteId/profile
// lets the authenticated user:
//   - update their own username
//   - generate a short-lived account-link invite code (to add a new passkey/device)
//   - manage their passkeys (moved here from passkeys-only view)

import { createResource, createSignal, For, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { getClientForRemote, isCharnelAvailable } from "../../app/api/client";
import { isP2PRemote } from "../../app/services/storage/types";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import {
  registerWithWebauthnP2P,
  loginWithWebauthnP2P,
} from "../../app/services/remotes/authService";
import { debug } from "../../utils/logger";
import { toast } from "../../components/feedback/Toast";
import { formatDate } from "../../utils/dateTime";

interface PasskeySummary {
  id: string;
  name?: string | null;
  created_at: number;
  last_used_at: number | null;
}

interface InviteCodeSummary {
  code: string;
  expires_at: number;
}

function buildLinkPayload(
  peerAddr: string,
  remoteName: string,
  description?: string | null
): string {
  const obj = {
    peer_addr: peerAddr,
    name: remoteName,
    description: description ?? null,
  };
  return btoa(JSON.stringify(obj));
}

function formatExpiresAt(expiresAt: number): string {
  if (!expiresAt) return "unknown expiry";
  const d = new Date(expiresAt * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function UserProfileView() {
  const params = useParams<{ remoteId: string }>();
  const navigate = useNavigate();

  // ---- username edit state ----
  const [usernameInput, setUsernameInput] = createSignal("");
  const [usernameBusy, setUsernameBusy] = createSignal(false);
  const [usernameError, setUsernameError] = createSignal<string | null>(null);
  const [usernameEditing, setUsernameEditing] = createSignal(false);

  // ---- invite code state ----
  const [generatingInvite, setGeneratingInvite] = createSignal(false);
  const [inviteCodes, setInviteCodes] = createSignal<InviteCodeSummary[]>([]);
  const [revokingCode, setRevokingCode] = createSignal<string | null>(null);

  // ---- passkey state ----
  // ---- passkey name editing state ----
  const [editingNameId, setEditingNameId] = createSignal<string | null>(null);
  const [nameInput, setNameInput] = createSignal("");
  const [nameBusy, setNameBusy] = createSignal(false);

  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [addMode, setAddMode] = createSignal<"register" | "login" | null>(null);
  const [addUsername, setAddUsername] = createSignal("");
  const [addInviteCode, setAddInviteCode] = createSignal("");
  const [addBusy, setAddBusy] = createSignal(false);
  const [addError, setAddError] = createSignal<string | null>(null);
  const [linkPayload, setLinkPayload] = createSignal<string | null>(null);

  // ---- load remote + passkeys ----
  const [data, { refetch }] = createResource(
    () => params.remoteId,
    async (remoteId) => {
      const remote = await getRemoteById(remoteId);
      if (!remote || !isP2PRemote(remote)) return null;

      const client = await getClientForRemote(remote);

      // load passkeys
      const result = await client.auth.listPasskeys();
      const passkeys: PasskeySummary[] =
        result.success && result.data
          ? ([] as PasskeySummary[]).concat(result.data as PasskeySummary | PasskeySummary[])
          : [];

      // load invite codes
      const inviteResult = await client.auth.listOwnInvites();
      const codes: InviteCodeSummary[] =
        inviteResult.success && Array.isArray(inviteResult.data)
          ? (inviteResult.data as InviteCodeSummary[])
          : [];
      setInviteCodes(codes);

      // load current user info for the username display
      const whoami = await client.auth.whoami();
      const currentUser =
        whoami.success && whoami.data
          ? { username: whoami.data.username, role: whoami.data.role }
          : null;

      // seed the username input with the current value
      if (currentUser?.username && !usernameEditing()) {
        setUsernameInput(currentUser.username);
      }

      // build charnel link payload
      const payload = buildLinkPayload(remote.peer_addr!, remote.name, remote.description);
      setLinkPayload(payload);

      return { remote, passkeys, currentUser };
    }
  );

  // ---- username update ----
  async function handleUpdateUsername() {
    const remote = data()?.remote;
    if (!remote || !isP2PRemote(remote)) return;

    const newUsername = usernameInput().trim();
    if (!newUsername) {
      setUsernameError("username cannot be empty");
      return;
    }

    setUsernameBusy(true);
    setUsernameError(null);
    try {
      const client = await getClientForRemote(remote);
      const result = await client.auth.updateUsername({ username: newUsername });
      if (!result.success) {
        // the error_type is encoded as a path entry in the ZodError issues
        const errType = result.error?.issues?.[0]?.path?.find(
          (p): p is string => typeof p === "string" && p !== "__auth_expired__"
        );
        if (errType === "user_already_exists") {
          setUsernameError(
            "ohey, that handle is already taken, choose a different username; or if you ask the admin nicely, they might be able to help."
          );
        } else {
          setUsernameError(result.error?.issues?.[0]?.message ?? "failed to update username");
        }
        return;
      }
      toast.success("username updated");
      setUsernameEditing(false);
      void refetch();
    } catch (e: unknown) {
      debug("user-profile", "update username failed:", e);
      setUsernameError(e instanceof Error ? e.message : "failed to update username");
    } finally {
      setUsernameBusy(false);
    }
  }

  // ---- generate self invite code ----
  async function handleGenerateInvite() {
    const remote = data()?.remote;
    if (!remote || !isP2PRemote(remote)) return;

    setGeneratingInvite(true);
    try {
      const client = await getClientForRemote(remote);
      const result = await client.auth.generateSelfAccountLink();
      if (!result.success || !result.data) {
        toast.error("failed to generate invite code");
        return;
      }
      setInviteCodes((prev) => [
        ...prev,
        { code: result.data!.code, expires_at: result.data!.expires_at },
      ]);
    } catch (e) {
      debug("user-profile", "generate invite failed:", e);
      toast.error(e instanceof Error ? e.message : "failed to generate invite code");
    } finally {
      setGeneratingInvite(false);
    }
  }

  // ---- revoke invite code ----
  async function handleRevokeInvite(code: string) {
    const remote = data()?.remote;
    if (!remote || !isP2PRemote(remote)) return;

    setRevokingCode(code);
    try {
      const client = await getClientForRemote(remote);
      const result = await client.auth.revokeOwnInvite({ code });
      if (!result.success) {
        toast.error("failed to revoke code");
        return;
      }
      setInviteCodes((prev) => prev.filter((c) => c.code !== code));
    } catch (e) {
      debug("user-profile", "revoke invite failed:", e);
      toast.error(e instanceof Error ? e.message : "revoke failed");
    } finally {
      setRevokingCode(null);
    }
  }

  // ---- passkey name update ----
  async function handleSavePasskeyName(credentialId: string) {
    const remote = data()?.remote;
    if (!remote || !isP2PRemote(remote)) return;

    setNameBusy(true);
    try {
      const client = await getClientForRemote(remote);
      const name = nameInput().trim() || null;
      const result = await client.auth.updatePasskeyName({ credential_id: credentialId, name });
      if (!result.success) {
        toast.error("failed to save name");
        return;
      }
      setEditingNameId(null);
      void refetch();
    } catch (e) {
      debug("user-profile", "update passkey name failed:", e);
      toast.error(e instanceof Error ? e.message : "failed to save name");
    } finally {
      setNameBusy(false);
    }
  }

  // ---- passkey delete ----
  async function handleDelete(credentialId: string) {
    const remote = data()?.remote;
    if (!remote || !isP2PRemote(remote)) return;

    setDeleting(credentialId);
    try {
      const client = await getClientForRemote(remote);
      const result = await client.auth.deletePasskey({ credential_id: credentialId });
      if (!result.success) {
        toast.error("failed to delete passkey");
        return;
      }
      toast.success("passkey deleted");
      void refetch();
    } catch (e) {
      debug("user-profile", "delete passkey failed:", e);
      toast.error(e instanceof Error ? e.message : "delete failed");
    } finally {
      setDeleting(null);
    }
  }

  // ---- passkey add ----
  async function handleAddPasskey(mode: "register" | "login") {
    const remote = data()?.remote;
    if (!remote || !isP2PRemote(remote)) return;

    const username = addUsername().trim() || undefined;
    const inviteCode = addInviteCode().trim();

    if (mode === "register" && !username) {
      setAddError("username is required for registration");
      return;
    }
    if (mode === "register" && !inviteCode) {
      setAddError("invite code is required to register a new passkey");
      return;
    }

    setAddBusy(true);
    setAddError(null);
    try {
      const result =
        mode === "register"
          ? await registerWithWebauthnP2P(remote.peer_addr!, username!, inviteCode)
          : await loginWithWebauthnP2P(remote.peer_addr!, username);

      if (!result.success) {
        setAddError(result.error ?? `passkey ${mode} failed`);
        return;
      }
      toast.success(`passkey ${mode === "register" ? "registered" : "added"}`);
      setAddMode(null);
      setAddUsername("");
      setAddInviteCode("");
      void refetch();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : `passkey ${mode} failed`);
    } finally {
      setAddBusy(false);
    }
  }

  return (
    <div class="p-4 wide:p-6">
      {/* back nav */}
      <div class="mb-6">
        <button
          class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors mb-3"
          onClick={() => navigate(`/settings/remotes`)}
        >
          back
        </button>
        <div>
          <h1 class="text-xl font-semibold text-[var(--color-text-primary)]">profile</h1>
          <Show when={data()?.remote}>
            <p class="text-sm text-[var(--color-text-muted)]">{data()!.remote.name}</p>
          </Show>
        </div>
      </div>

      <Show when={data.loading}>
        <div class="flex items-center justify-center py-12">
          <div class="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-accent-500)] border-t-transparent" />
        </div>
      </Show>

      <Show when={!data.loading && data() === null}>
        <p class="text-sm text-[var(--color-status-error)]">remote not found or not a p2p remote</p>
      </Show>

      <Show when={data()}>
        <div class="space-y-8">
          {/* username section */}
          <section>
            <h2 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 uppercase tracking-wide">
              username
            </h2>
            <Show
              when={usernameEditing()}
              fallback={
                <div class="flex items-center gap-3">
                  <span class="text-sm text-[var(--color-text-primary)] font-medium">
                    {data()!.currentUser?.username ?? "unknown"}
                  </span>
                  <Show when={data()!.currentUser?.role}>
                    <span class="text-xs text-[var(--color-text-muted)]">
                      ({data()!.currentUser!.role})
                    </span>
                  </Show>
                  <button
                    class="text-xs text-[var(--color-accent-500)] hover:underline"
                    onClick={() => {
                      setUsernameInput(data()!.currentUser?.username ?? "");
                      setUsernameError(null);
                      setUsernameEditing(true);
                    }}
                  >
                    edit
                  </button>
                </div>
              }
            >
              <div class="space-y-2">
                <input
                  type="text"
                  value={usernameInput()}
                  onInput={(e) => setUsernameInput(e.currentTarget.value)}
                  placeholder="new username"
                  class="w-full max-w-xs px-2 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]"
                  disabled={usernameBusy()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleUpdateUsername();
                    if (e.key === "Escape") {
                      setUsernameEditing(false);
                      setUsernameError(null);
                    }
                  }}
                />
                <Show when={usernameError()}>
                  <p class="text-sm text-[var(--color-status-error)]">{usernameError()}</p>
                </Show>
                <div class="flex gap-2">
                  <button
                    class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors disabled:opacity-50"
                    onClick={() => void handleUpdateUsername()}
                    disabled={usernameBusy()}
                  >
                    {usernameBusy() ? "saving..." : "save"}
                  </button>
                  <button
                    class="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                    onClick={() => {
                      setUsernameEditing(false);
                      setUsernameError(null);
                    }}
                    disabled={usernameBusy()}
                  >
                    cancel
                  </button>
                </div>
              </div>
            </Show>
          </section>

          {/* invite code section */}
          <section>
            <div class="flex items-center justify-between mb-1">
              <h2 class="text-sm font-semibold text-[var(--color-text-primary)] uppercase tracking-wide">
                account-link invite codes
              </h2>
              <button
                class="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-50"
                onClick={() => void handleGenerateInvite()}
                disabled={generatingInvite()}
              >
                {generatingInvite() ? "generating..." : "generate new code"}
              </button>
            </div>
            <p class="text-xs text-[var(--color-text-muted)] mb-3">
              one-time codes to link a new passkey or device to your account. each expires in 1
              hour.
            </p>
            <Show
              when={inviteCodes().length > 0}
              fallback={
                <p class="text-sm text-[var(--color-text-muted)] py-3 text-center border border-dashed border-[var(--color-border-subtle)] rounded-lg">
                  no active invite codes
                </p>
              }
            >
              <div class="space-y-2">
                <For each={inviteCodes()}>
                  {(invite) => (
                    <div class="p-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg space-y-1.5">
                      <div class="flex items-center gap-2">
                        <code class="flex-1 font-mono text-sm text-[var(--color-text-primary)] bg-[var(--color-bg-primary)] px-2 py-1 rounded border border-[var(--color-border-subtle)] truncate">
                          {invite.code}
                        </code>
                        <button
                          class="shrink-0 px-2 py-1 text-xs rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                          onClick={() => {
                            void navigator.clipboard.writeText(invite.code);
                            toast.success("copied");
                          }}
                        >
                          copy
                        </button>
                        <button
                          class="shrink-0 px-2 py-1 text-xs rounded border border-red-600/30 text-red-400 bg-red-600/10 hover:bg-red-600/20 transition-colors disabled:opacity-50"
                          onClick={() => void handleRevokeInvite(invite.code)}
                          disabled={revokingCode() === invite.code}
                        >
                          {revokingCode() === invite.code ? "revoking..." : "revoke"}
                        </button>
                      </div>
                      <p class="text-xs text-[var(--color-text-muted)]">
                        expires at {formatExpiresAt(invite.expires_at)}
                      </p>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>

          {/* passkeys section */}
          <section>
            <h2 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 uppercase tracking-wide">
              passkeys
            </h2>

            <Show
              when={data()!.passkeys.length > 0}
              fallback={
                <p class="text-sm text-[var(--color-text-muted)] py-4 text-center border border-dashed border-[var(--color-border-subtle)] rounded-lg mb-4">
                  no passkeys registered on this remote
                </p>
              }
            >
              <div class="space-y-2 mb-4">
                <For each={data()!.passkeys}>
                  {(passkey) => (
                    <div class="flex items-center justify-between p-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg">
                      <div class="min-w-0 flex-1">
                        {/* passkey name - inline editable */}
                        <Show
                          when={editingNameId() === passkey.id}
                          fallback={
                            <button
                              class="text-xs text-left text-[var(--color-text-primary)] hover:text-[var(--color-accent-500)] transition-colors mb-0.5"
                              onClick={() => {
                                setNameInput(passkey.name ?? "");
                                setEditingNameId(passkey.id);
                              }}
                            >
                              {passkey.name ? (
                                passkey.name
                              ) : (
                                <span class="text-[var(--color-text-tertiary)] italic">
                                  add a label
                                </span>
                              )}
                            </button>
                          }
                        >
                          <div class="flex items-center gap-1.5 mb-0.5">
                            <input
                              type="text"
                              value={nameInput()}
                              onInput={(e) => setNameInput(e.currentTarget.value)}
                              placeholder="label this passkey"
                              class="px-1.5 py-0.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)] w-36"
                              disabled={nameBusy()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void handleSavePasskeyName(passkey.id);
                                if (e.key === "Escape") setEditingNameId(null);
                              }}
                            />
                            <button
                              class="text-xs text-[var(--color-accent-500)] hover:underline disabled:opacity-50"
                              onClick={() => void handleSavePasskeyName(passkey.id)}
                              disabled={nameBusy()}
                            >
                              save
                            </button>
                            <button
                              class="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                              onClick={() => setEditingNameId(null)}
                              disabled={nameBusy()}
                            >
                              cancel
                            </button>
                          </div>
                        </Show>
                        <p class="text-xs text-[var(--color-text-muted)] font-mono truncate">
                          id: {passkey.id.slice(0, 16)}...
                        </p>
                        <p class="text-xs text-[var(--color-text-muted)]">
                          registered {formatDate(passkey.created_at * 1000)}
                        </p>
                        <Show when={passkey.last_used_at}>
                          <p class="text-xs text-[var(--color-text-muted)]">
                            last used {formatDate(passkey.last_used_at! * 1000)}
                          </p>
                        </Show>
                      </div>
                      <button
                        class="ml-3 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-colors disabled:opacity-50"
                        onClick={() => void handleDelete(passkey.id)}
                        disabled={deleting() === passkey.id}
                      >
                        {deleting() === passkey.id ? "deleting..." : "delete"}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* add passkey */}
            <Show when={!isCharnelAvailable()}>
              <Show
                when={addMode() !== null}
                fallback={
                  <div class="flex gap-2">
                    <button
                      class="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors"
                      onClick={() => {
                        setAddUsername(data()!.currentUser?.username ?? "");
                        setAddMode("login");
                        setAddError(null);
                      }}
                    >
                      new passkey
                    </button>
                    <button
                      class="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] transition-colors"
                      onClick={() => {
                        setAddUsername(data()!.currentUser?.username ?? "");
                        setAddMode("register");
                        setAddError(null);
                      }}
                    >
                      register with invite code
                    </button>
                  </div>
                }
              >
                <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg space-y-3">
                  <p class="text-sm text-[var(--color-text-secondary)]">
                    {addMode() === "register"
                      ? "register a new passkey using an account-link invite code"
                      : "sign in with an existing passkey to link this browser session"}
                  </p>

                  <Show when={addError()}>
                    <p class="text-sm text-[var(--color-status-error)]">{addError()}</p>
                  </Show>

                  <div>
                    <label class="block text-xs font-medium text-[var(--color-text-primary)] mb-1">
                      username
                      {addMode() === "login" && (
                        <span class="text-[var(--color-text-muted)] font-normal ml-1">
                          (optional)
                        </span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={addUsername()}
                      onInput={(e) => setAddUsername(e.currentTarget.value)}
                      placeholder={
                        addMode() === "login"
                          ? "username (optional)"
                          : "your username on this server"
                      }
                      class="w-full px-2 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]"
                      disabled={addBusy()}
                    />
                  </div>

                  <Show when={addMode() === "register"}>
                    <div>
                      <label class="block text-xs font-medium text-[var(--color-text-primary)] mb-1">
                        invite code
                      </label>
                      <input
                        type="text"
                        value={addInviteCode()}
                        onInput={(e) => setAddInviteCode(e.currentTarget.value)}
                        placeholder="account-link code"
                        class="w-full px-2 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]"
                        disabled={addBusy()}
                      />
                    </div>
                  </Show>

                  <div class="flex gap-2">
                    <button
                      class="flex-1 px-3 py-1.5 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                      onClick={() => {
                        setAddMode(null);
                        setAddError(null);
                      }}
                      disabled={addBusy()}
                    >
                      cancel
                    </button>
                    <button
                      class="flex-1 px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors disabled:opacity-50"
                      onClick={() => void handleAddPasskey(addMode()!)}
                      disabled={addBusy()}
                    >
                      {addBusy()
                        ? addMode() === "register"
                          ? "registering..."
                          : "signing in..."
                        : addMode() === "register"
                          ? "register passkey"
                          : "sign in with passkey"}
                    </button>
                  </div>
                </div>
              </Show>
            </Show>

            {/* charnel/tauri: link via spume.freqhole.net */}
            <Show when={isCharnelAvailable()}>
              <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg space-y-3">
                <p class="text-sm text-[var(--color-text-secondary)]">
                  to add a passkey in the desktop app, open the link below in a browser where you
                  already have (or can register) a passkey. you will need an account-link invite
                  code from above.
                </p>
                <Show when={linkPayload()}>
                  {(payload) => {
                    const url = () =>
                      `https://spume.freqhole.net/?link=${encodeURIComponent(payload())}`;
                    return (
                      <div class="space-y-2">
                        <div class="p-2 bg-[var(--color-bg-primary)] border border-[var(--color-border-subtle)] rounded font-mono text-xs text-[var(--color-text-muted)] break-all">
                          {url()}
                        </div>
                        <button
                          class="w-full px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors"
                          onClick={() => {
                            void navigator.clipboard.writeText(url());
                            toast.success("link copied");
                          }}
                        >
                          copy link
                        </button>
                      </div>
                    );
                  }}
                </Show>
              </div>
            </Show>
          </section>
        </div>
      </Show>
    </div>
  );
}

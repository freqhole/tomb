// passkey management view for a single p2p remote
//
// route: /settings/remotes/:remoteId/passkeys
// shows the authenticated user's passkeys on this remote,
// allows deleting individual passkeys, and offers two flows
// to add a new passkey: register (with invite code) or login
// (if they already have a passkey elsewhere).
//
// only shown when:
//   - the remote has passkey_p2p_enabled (checked by the parent)
//   - the user is authenticated (node_id is a known peer)

import { createResource, createSignal, For, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { getClientForRemote, getLocalNodeId, isCharnelAvailable } from "../../app/api/client";
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
  created_at: number;
  last_used_at: number | null;
}

// encode a link payload for the ?link= param so context (remote name, node_id, description)
// travels with it. the tauri/charnel app reads this and shows context before the user
// confirms the link.
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

export function PasskeyManageView() {
  const params = useParams<{ remoteId: string }>();
  const navigate = useNavigate();

  // ---- state ----
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

      const result = await client.auth.listPasskeys();
      const passkeys: PasskeySummary[] =
        result.success && result.data
          ? ([] as PasskeySummary[]).concat(result.data as PasskeySummary | PasskeySummary[])
          : [];

      // build link payload for charnel "link device" flow
      const payload = buildLinkPayload(remote.peer_addr!, remote.name, remote.description);
      setLinkPayload(payload);

      return { remote, passkeys };
    }
  );

  // ---- delete a passkey ----
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
      debug("passkey-manage", "delete failed:", e);
      toast.error(e instanceof Error ? e.message : "delete failed");
    } finally {
      setDeleting(null);
    }
  }

  // ---- add passkey (register or login) ----
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
      <div class="mb-6 flex items-center gap-3">
        <button
          class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          onClick={() => navigate(`/settings/remotes`)}
        >
          ← back
        </button>
        <div>
          <h1 class="text-xl font-semibold text-[var(--color-text-primary)]">passkeys</h1>
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
        <div class="space-y-6">
          {/* passkey list */}
          <section>
            <h2 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 uppercase tracking-wide">
              your passkeys
            </h2>

            <Show
              when={data()!.passkeys.length > 0}
              fallback={
                <p class="text-sm text-[var(--color-text-muted)] py-4 text-center border border-dashed border-[var(--color-border-subtle)] rounded-lg">
                  no passkeys registered on this remote
                </p>
              }
            >
              <div class="space-y-2">
                <For each={data()!.passkeys}>
                  {(passkey) => (
                    <div class="flex items-center justify-between p-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg">
                      <div class="min-w-0">
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
          </section>

          {/* add passkey */}
          <section>
            <h2 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 uppercase tracking-wide">
              add a passkey
            </h2>

            <Show when={!isCharnelAvailable()}>
              {/* web browser: register or login flow */}
              <Show
                when={addMode() !== null}
                fallback={
                  <div class="flex gap-2">
                    <button
                      class="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] transition-colors"
                      onClick={() => {
                        setAddMode("login");
                        setAddError(null);
                      }}
                    >
                      sign in with existing passkey
                    </button>
                    <button
                      class="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors"
                      onClick={() => {
                        setAddMode("register");
                        setAddError(null);
                      }}
                    >
                      register new passkey
                    </button>
                  </div>
                }
              >
                <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg space-y-3">
                  <p class="text-sm text-[var(--color-text-secondary)]">
                    {addMode() === "register"
                      ? "register a new passkey using an account-link invite code from the server admin"
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
                        placeholder="account-link code from the server admin"
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
                          : "sign in"}
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
                  already have (or can register) a passkey.
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

          {/* link this node */}
          <Show when={!isCharnelAvailable()}>
            <section>
              <h2 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 uppercase tracking-wide">
                your node id
              </h2>
              <Show when={getLocalNodeId()}>
                {(nodeId) => (
                  <div class="p-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg">
                    <p class="text-xs text-[var(--color-text-muted)] font-mono break-all">
                      {nodeId()}
                    </p>
                    <p class="text-xs text-[var(--color-text-muted)] mt-1">
                      this browser's iroh node id. a successful passkey login above automatically
                      links it to your account.
                    </p>
                  </div>
                )}
              </Show>
            </section>
          </Show>
        </div>
      </Show>
    </div>
  );
}

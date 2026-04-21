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
import { isP2PRemote, type Remote } from "../../app/services/storage/schemas/remote";
import {
  AdminClient,
  AdminCommandError,
  type AdminUserSummary,
  type AdminInviteInfo,
  type AdminPeerSummary,
} from "freqhole-api-client";
import { toast } from "../../components/feedback/Toast";
import { formatDate } from "../../utils/dateTime";
import { UserAutocomplete, type UserSelection } from "./UserAutocomplete";

interface KnockRow {
  id: string;
  node_id: string;
  username: string;
  message: string;
  status: string;
  created_at: number;
  processed_at?: number | null;
  processed_by?: string | null;
}

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
          <UsersSection client={adminClient()!} />
          <InvitesSection client={adminClient()!} />
          <PeersSection client={adminClient()!} remote={remote()!} />
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

  const [showQr, setShowQr] = createSignal(false);
  const [qrUrl, setQrUrl] = createSignal<string | null>(null);

  const generate = async () => {
    if (!showQr()) {
      setShowQr(true);
      try {
        const url = await QRCode.toDataURL(nodeId(), {
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

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(nodeId());
      toast.success("node id copied");
    } catch {
      toast.error("clipboard write failed");
    }
  };

  return (
    <section class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-5">
      <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-3">remote node id</h2>
      <p class="text-sm text-[var(--color-text-muted)] mb-3">
        share this with peers who want to knock for access.
      </p>
      <div class="flex items-center gap-2">
        <code class="flex-1 break-all rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          {nodeId()}
        </code>
        <button
          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors"
          onClick={copy}
        >
          copy
        </button>
        <button
          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors"
          onClick={generate}
        >
          {showQr() ? "hide qr" : "show qr"}
        </button>
      </div>
      <Show when={showQr() && qrUrl()}>
        <div class="mt-4 flex justify-center">
          <img src={qrUrl()!} alt="node id qr" class="rounded bg-white p-2" />
        </div>
      </Show>
    </section>
  );
}

// ------------------------------------------------------------------
// knocks
// ------------------------------------------------------------------

function KnocksSection(props: { client: AdminClient; remote: Remote }) {
  const [includeAll, setIncludeAll] = createSignal(false);
  // note: createResource skips the fetcher when the source returns a falsy
  // value (false/null/undefined). wrap in an object so initial `false` still
  // triggers the fetch.
  const [knocks, { refetch }] = createResource(
    () => ({ all: includeAll() }),
    async ({ all }) => {
      try {
        const cmd = all ? "knocks_list_all" : "knocks_list";
        console.debug("[admin-p2p] dispatching", cmd);
        const data = await props.client.dispatchOrThrow(cmd, undefined);
        console.debug("[admin-p2p] knocks result", {
          cmd,
          count: Array.isArray(data) ? data.length : "not-array",
          data,
        });
        return (data as KnockRow[]) ?? [];
      } catch (e) {
        console.error("[admin-p2p] knocks list failed", e);
        if (e instanceof AdminCommandError) {
          toast.error(`knocks list failed: ${e.message}`);
        } else {
          toast.error(`knocks list failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        return [];
      }
    }
  );

  const [accepting, setAccepting] = createSignal<string | null>(null);
  const [rejecting, setRejecting] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [acceptRole, setAcceptRole] = createSignal<Record<string, string>>({});
  const [acceptSelection, setAcceptSelection] = createSignal<Record<string, UserSelection | null>>(
    {}
  );

  // per-knock inline errors keyed by knock id. cleared on retry/success.
  type KnockErr = { action: string; title?: string; detail: string; error_type?: string };
  const [rowErrors, setRowErrors] = createSignal<Record<string, KnockErr[]>>({});
  const setRowError = (id: string, action: string, e: unknown) => {
    const errs: KnockErr[] =
      e instanceof AdminCommandError && e.response.errors && e.response.errors.length > 0
        ? e.response.errors.map((err) => ({
            action,
            title: err.title,
            detail: err.detail,
            error_type: err.error_type,
          }))
        : [{ action, detail: e instanceof Error ? e.message : String(e) }];
    setRowErrors({ ...rowErrors(), [id]: errs });
  };
  const clearRowError = (id: string) => {
    const { [id]: _, ...rest } = rowErrors();
    setRowErrors(rest);
  };

  const handleAccept = async (knock: KnockRow) => {
    setAccepting(knock.id);
    clearRowError(knock.id);
    try {
      const selection = acceptSelection()[knock.id] ?? null;
      // when an existing user is picked, reuse their id+role. when it's a
      // new username, fall back to the role dropdown (defaults to viewer).
      const role = selection?.isExisting
        ? selection.role
        : (selection?.role ?? acceptRole()[knock.id] ?? "viewer");
      const username = selection?.username?.trim() || knock.username || null;
      const userId = selection?.isExisting ? (selection.id ?? null) : null;
      await props.client.dispatchOrThrow("knocks_accept", {
        knock_id: knock.id,
        role,
        username,
        user_id: userId,
      });
      toast.success(`accepted knock from ${username ?? knock.username} as ${role}`);
      await refetch();
    } catch (e) {
      setRowError(knock.id, "accept", e);
      const msg = e instanceof AdminCommandError ? e.message : String(e);
      toast.error(`accept failed: ${msg}`);
    } finally {
      setAccepting(null);
    }
  };

  const handleReject = async (knock: KnockRow) => {
    setRejecting(knock.id);
    clearRowError(knock.id);
    try {
      await props.client.dispatchOrThrow("knocks_reject", { knock_id: knock.id });
      toast.success("knock rejected");
      await refetch();
    } catch (e) {
      setRowError(knock.id, "reject", e);
      const msg = e instanceof AdminCommandError ? e.message : String(e);
      toast.error(`reject failed: ${msg}`);
    } finally {
      setRejecting(null);
    }
  };

  const handleDelete = async (knock: KnockRow) => {
    setDeleting(knock.id);
    clearRowError(knock.id);
    try {
      await props.client.dispatchOrThrow("knocks_delete", { knock_id: knock.id });
      toast.success("knock deleted");
      await refetch();
    } catch (e) {
      setRowError(knock.id, "delete", e);
      const msg = e instanceof AdminCommandError ? e.message : String(e);
      toast.error(`delete failed: ${msg}`);
    } finally {
      setDeleting(null);
    }
  };

  const handleRejectAll = async () => {
    try {
      const data = (await props.client.dispatchOrThrow("knocks_reject_all", undefined)) as {
        rejected: number;
      };
      toast.success(`rejected ${data?.rejected ?? 0} knocks`);
      await refetch();
    } catch (e) {
      const msg = e instanceof AdminCommandError ? e.message : String(e);
      toast.error(`reject all failed: ${msg}`);
    }
  };

  return (
    <section class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">knock requests</h2>
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={includeAll()}
              onChange={(e) => setIncludeAll(e.currentTarget.checked)}
            />
            show processed
          </label>
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors"
            onClick={() => refetch()}
          >
            refresh
          </button>
          <Show when={(knocks() ?? []).some((k) => k.status === "pending")}>
            <button
              class="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-colors"
              onClick={handleRejectAll}
            >
              reject all
            </button>
          </Show>
        </div>
      </div>

      <Show
        when={!knocks.loading}
        fallback={<div class="text-sm text-[var(--color-text-muted)]">loading knocks...</div>}
      >
        <Show
          when={(knocks() ?? []).length > 0}
          fallback={<div class="text-sm text-[var(--color-text-muted)]">no knock requests</div>}
        >
          <div class="flex flex-col gap-3">
            <For each={knocks() ?? []}>
              {(knock) => (
                <div class="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-4">
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="font-medium text-[var(--color-text-primary)]">
                          {knock.username}
                        </span>
                        <span
                          class={`text-xs px-2 py-0.5 rounded ${
                            knock.status === "pending"
                              ? "bg-yellow-600/20 text-yellow-400"
                              : knock.status === "accepted"
                                ? "bg-green-600/20 text-green-400"
                                : "bg-red-600/20 text-red-400"
                          }`}
                        >
                          {knock.status}
                        </span>
                      </div>
                      <Show when={knock.message}>
                        <p class="text-sm text-[var(--color-text-secondary)] mb-2">
                          {knock.message}
                        </p>
                      </Show>
                      <div class="text-xs text-[var(--color-text-muted)] flex flex-wrap gap-3">
                        <span>
                          node: <code>{knock.node_id.slice(0, 16)}...</code>
                        </span>
                        <span>requested {formatDate(knock.created_at)}</span>
                        <Show when={knock.processed_at}>
                          <span>processed {formatDate(knock.processed_at!)}</span>
                        </Show>
                      </div>
                    </div>

                    <Show when={knock.status === "pending"}>
                      <div class="flex flex-col gap-2 shrink-0 w-56">
                        <UserAutocomplete
                          remote={props.remote}
                          initialValue={knock.username ?? ""}
                          placeholder={knock.username || "username..."}
                          defaultRole={acceptRole()[knock.id] ?? "viewer"}
                          onSelect={(sel) =>
                            setAcceptSelection({
                              ...acceptSelection(),
                              [knock.id]: sel,
                            })
                          }
                        />
                        <select
                          class="w-full text-xs px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] disabled:opacity-50"
                          value={
                            acceptSelection()[knock.id]?.isExisting
                              ? acceptSelection()[knock.id]!.role
                              : (acceptRole()[knock.id] ?? "viewer")
                          }
                          disabled={acceptSelection()[knock.id]?.isExisting ?? false}
                          onChange={(e) =>
                            setAcceptRole({
                              ...acceptRole(),
                              [knock.id]: e.currentTarget.value,
                            })
                          }
                        >
                          <option value="viewer">viewer</option>
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                        <button
                          class="px-3 py-1 text-xs font-medium rounded bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors disabled:opacity-50"
                          disabled={accepting() === knock.id}
                          onClick={() => handleAccept(knock)}
                        >
                          {accepting() === knock.id ? "accepting..." : "accept"}
                        </button>
                        <button
                          class="px-3 py-1 text-xs font-medium rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-colors disabled:opacity-50"
                          disabled={rejecting() === knock.id}
                          onClick={() => handleReject(knock)}
                        >
                          {rejecting() === knock.id ? "rejecting..." : "reject"}
                        </button>
                      </div>
                    </Show>

                    <Show when={knock.status !== "pending"}>
                      <button
                        class="px-3 py-1 text-xs font-medium rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-colors disabled:opacity-50 shrink-0"
                        disabled={deleting() === knock.id}
                        onClick={() => handleDelete(knock)}
                      >
                        {deleting() === knock.id ? "deleting..." : "delete"}
                      </button>
                    </Show>
                  </div>
                  <Show when={rowErrors()[knock.id]?.length}>
                    <div class="mt-3 rounded border border-red-600/40 bg-red-600/10 p-2 text-xs">
                      <div class="flex items-start justify-between gap-2 mb-1">
                        <span class="font-medium text-red-400">
                          {rowErrors()[knock.id]![0].action} failed
                        </span>
                        <button
                          class="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                          onClick={() => clearRowError(knock.id)}
                          aria-label="dismiss error"
                        >
                          ×
                        </button>
                      </div>
                      <For each={rowErrors()[knock.id]}>
                        {(err) => (
                          <div class="text-red-300">
                            <Show when={err.error_type}>
                              <code class="mr-1 text-red-400/80">{err.error_type}</code>
                            </Show>
                            <span>{err.detail}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}

// ------------------------------------------------------------------
// users
// ------------------------------------------------------------------

type RoleOption = "admin" | "member" | "viewer";

function copyToClipboard(text: string, label: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${label} copied`))
    .catch(() => toast.error("clipboard write failed"));
}

function adminErrMessage(e: unknown): string {
  if (e instanceof AdminCommandError) {
    const first = e.response.errors?.[0];
    if (first?.detail) return first.detail;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

function UsersSection(props: { client: AdminClient }) {
  const [includeDeleted, setIncludeDeleted] = createSignal(false);
  const [users, { refetch }] = createResource(
    () => ({ deleted: includeDeleted() }),
    async ({ deleted }) => {
      try {
        return await props.client.dispatchOrThrow("users_list", {
          include_deleted: deleted,
          limit: null,
          offset: null,
          username: null,
          role: null,
        });
      } catch (e) {
        toast.error(`users list failed: ${adminErrMessage(e)}`);
        return [] as AdminUserSummary[];
      }
    }
  );

  const [updating, setUpdating] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [linking, setLinking] = createSignal<string | null>(null);

  const handleRoleChange = async (user: AdminUserSummary, role: string) => {
    if (role === user.role) return;
    setUpdating(user.id);
    try {
      await props.client.dispatchOrThrow("users_update_role", { user_id: user.id, role });
      toast.success(`${user.username} is now ${role}`);
      await refetch();
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
      await refetch();
    } catch (e) {
      toast.error(`delete failed: ${adminErrMessage(e)}`);
    } finally {
      setDeleting(null);
    }
  };

  const handleGenerateLink = async (user: AdminUserSummary) => {
    setLinking(user.id);
    try {
      const resp = await props.client.dispatchOrThrow("users_generate_account_link", {
        user_id: user.id,
      });
      copyToClipboard(resp.code, `account link for ${user.username}`);
    } catch (e) {
      toast.error(`generate link failed: ${adminErrMessage(e)}`);
    } finally {
      setLinking(null);
    }
  };

  return (
    <section class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">users</h2>
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={includeDeleted()}
              onChange={(e) => setIncludeDeleted(e.currentTarget.checked)}
            />
            include deleted
          </label>
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors"
            onClick={() => refetch()}
          >
            refresh
          </button>
        </div>
      </div>

      <Show
        when={!users.loading}
        fallback={<div class="text-sm text-[var(--color-text-muted)]">loading users...</div>}
      >
        <Show
          when={(users() ?? []).length > 0}
          fallback={<div class="text-sm text-[var(--color-text-muted)]">no users</div>}
        >
          <div class="flex flex-col gap-2">
            <For each={users() ?? []}>
              {(user) => (
                <div class="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-3">
                  <div class="flex items-center justify-between gap-4 flex-wrap">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="font-medium text-[var(--color-text-primary)]">
                          {user.username}
                        </span>
                        <Show when={user.deleted_at}>
                          <span class="text-xs px-2 py-0.5 rounded bg-red-600/20 text-red-400">
                            deleted
                          </span>
                        </Show>
                        <Show when={user.haruspex_user_id}>
                          <span class="text-xs px-2 py-0.5 rounded bg-blue-600/20 text-blue-400">
                            linked
                          </span>
                        </Show>
                      </div>
                      <div class="text-xs text-[var(--color-text-muted)] mt-1">
                        <code class="mr-2">{user.id.slice(0, 12)}...</code>
                        created {formatDate(user.created_at)}
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
                      <button
                        class="px-2 py-1 text-xs font-medium rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors disabled:opacity-50"
                        disabled={linking() === user.id || !!user.deleted_at}
                        onClick={() => handleGenerateLink(user)}
                        title="generate a one-time account link code"
                      >
                        {linking() === user.id ? "..." : "account link"}
                      </button>
                      <button
                        class="px-2 py-1 text-xs font-medium rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-colors disabled:opacity-50"
                        disabled={
                          deleting() === user.id || user.role === "root" || !!user.deleted_at
                        }
                        onClick={() => handleDelete(user)}
                      >
                        {deleting() === user.id ? "..." : "delete"}
                      </button>
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
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors"
            onClick={() => refetch()}
          >
            refresh
          </button>
          <button
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-colors"
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
            class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors disabled:opacity-50"
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
                  <button
                    class="px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]"
                    onClick={() => copyToClipboard(code, "invite code")}
                  >
                    copy
                  </button>
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
                      <button
                        class="px-2 py-1 text-xs font-medium rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors"
                        onClick={() => copyToClipboard(invite.code, "invite code")}
                      >
                        copy
                      </button>
                      <Show when={invite.is_active}>
                        <button
                          class="px-2 py-1 text-xs font-medium rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-colors disabled:opacity-50"
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

// ------------------------------------------------------------------
// peers
// ------------------------------------------------------------------

function PeersSection(props: { client: AdminClient; remote: Remote }) {
  const [peers, { refetch }] = createResource(
    () => ({ tick: 0 }),
    async () => {
      try {
        return await props.client.dispatchOrThrow("peers_list_all", undefined);
      } catch (e) {
        toast.error(`peers list failed: ${adminErrMessage(e)}`);
        return [] as AdminPeerSummary[];
      }
    }
  );

  const [removing, setRemoving] = createSignal<string | null>(null);

  const rowKey = (p: AdminPeerSummary) => `${p.user_id}:${p.node_id}`;

  const handleRemove = async (peer: AdminPeerSummary) => {
    if (!confirm(`remove peer ${peer.node_id.slice(0, 12)}... from ${peer.username}?`)) return;
    setRemoving(rowKey(peer));
    try {
      await props.client.dispatchOrThrow("peers_remove", {
        user_id: peer.user_id,
        node_id: peer.node_id,
      });
      toast.success("peer removed");
      await refetch();
    } catch (e) {
      toast.error(`remove failed: ${adminErrMessage(e)}`);
    } finally {
      setRemoving(null);
    }
  };

  // manual allow form
  const [nodeId, setNodeId] = createSignal("");
  const [allowSelection, setAllowSelection] = createSignal<UserSelection | null>(null);
  const [allowRole, setAllowRole] = createSignal<RoleOption>("viewer");
  const [allowing, setAllowing] = createSignal(false);

  const handleAllow = async () => {
    const nid = nodeId().trim();
    if (nid.length !== 64 || !/^[0-9a-f]{64}$/i.test(nid)) {
      toast.error("node id must be 64 hex characters");
      return;
    }
    const sel = allowSelection();
    const role = sel?.isExisting ? sel.role : (sel?.role ?? allowRole());
    const username = sel?.username?.trim() || null;
    const userId = sel?.isExisting ? (sel.id ?? null) : null;
    setAllowing(true);
    try {
      const resp = await props.client.dispatchOrThrow("peers_allow", {
        node_id: nid,
        role,
        username,
        user_id: userId,
      });
      toast.success(
        resp.created_user
          ? `created ${resp.username} and allowed peer`
          : `allowed peer for ${resp.username}`
      );
      setNodeId("");
      setAllowSelection(null);
      await refetch();
    } catch (e) {
      toast.error(`allow failed: ${adminErrMessage(e)}`);
    } finally {
      setAllowing(false);
    }
  };

  return (
    <section class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">peers</h2>
        <button
          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors"
          onClick={() => refetch()}
        >
          refresh
        </button>
      </div>

      <div class="mb-4 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-3">
        <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-2">
          allow peer manually
        </div>
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
                defaultRole={allowRole()}
                onSelect={(sel) => setAllowSelection(sel)}
              />
            </div>
            <select
              class="text-xs px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] disabled:opacity-50"
              value={allowSelection()?.isExisting ? allowSelection()!.role : allowRole()}
              disabled={allowSelection()?.isExisting ?? false}
              onChange={(e) => setAllowRole(e.currentTarget.value as RoleOption)}
            >
              <option value="viewer">viewer</option>
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            <button
              class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors disabled:opacity-50"
              disabled={allowing() || !nodeId().trim()}
              onClick={handleAllow}
            >
              {allowing() ? "allowing..." : "allow"}
            </button>
          </div>
        </div>
      </div>

      <Show
        when={!peers.loading}
        fallback={<div class="text-sm text-[var(--color-text-muted)]">loading peers...</div>}
      >
        <Show
          when={(peers() ?? []).length > 0}
          fallback={<div class="text-sm text-[var(--color-text-muted)]">no peers</div>}
        >
          <div class="flex flex-col gap-2">
            <For each={peers() ?? []}>
              {(peer) => (
                <div class="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-3">
                  <div class="flex items-center justify-between gap-3 flex-wrap">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-medium text-[var(--color-text-primary)]">
                          {peer.username}
                        </span>
                        <span class="text-xs px-2 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
                          {peer.role}
                        </span>
                        <Show when={peer.instance_name}>
                          <span class="text-xs text-[var(--color-text-muted)]">
                            ({peer.instance_name})
                          </span>
                        </Show>
                      </div>
                      <div class="text-xs text-[var(--color-text-muted)] mt-1 flex flex-wrap gap-3">
                        <code>{peer.node_id.slice(0, 16)}...</code>
                        <span>added {formatDate(peer.created_at)}</span>
                        <Show when={peer.last_seen_at}>
                          <span>last seen {formatDate(peer.last_seen_at!)}</span>
                        </Show>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <button
                        class="px-2 py-1 text-xs font-medium rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors"
                        onClick={() => copyToClipboard(peer.node_id, "node id")}
                      >
                        copy id
                      </button>
                      <button
                        class="px-2 py-1 text-xs font-medium rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 transition-colors disabled:opacity-50"
                        disabled={removing() === rowKey(peer)}
                        onClick={() => handleRemove(peer)}
                      >
                        {removing() === rowKey(peer) ? "..." : "remove"}
                      </button>
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

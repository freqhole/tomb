// extracted from RemoteAdminView so the cross-remote PendingKnocksView
// can reuse the same UI per admin remote without circular deps.

import { createSignal, createResource, Show, For } from "solid-js";
import { AdminClient, AdminCommandError } from "freqhole-api-client";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import { toast } from "../../../components/feedback/Toast";
import { CopyButton } from "../../../components/buttons/CopyButton";
import { formatDate } from "../../../utils/dateTime";
import { truncateMiddle } from "../../../utils/truncate";
import { UserAutocomplete, type UserSelection } from "../UserAutocomplete";

export interface KnockRow {
  id: string;
  node_id: string;
  username: string;
  message: string;
  status: string;
  created_at: number;
  processed_at?: number | null;
  processed_by?: string | null;
}

export function KnocksSection(props: {
  client: AdminClient;
  remote: Remote;
  /** optional callback fired after any successful mutation so the parent
   *  can refresh aggregate counts (e.g. the cross-remote toast). */
  onChanged?: () => void;
}) {
  const [includeAll, setIncludeAll] = createSignal(false);
  // note: createResource skips the fetcher when the source returns a falsy
  // value (false/null/undefined). wrap in an object so initial `false` still
  // triggers the fetch.
  const [knocks, { refetch }] = createResource(
    () => ({ all: includeAll() }),
    async ({ all }) => {
      try {
        const cmd = all ? "knocks_list_all" : "knocks_list";
        const data = await props.client.dispatchOrThrow(cmd, undefined);
        return (data as KnockRow[]) ?? [];
      } catch (e) {
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

  const notifyChanged = async () => {
    await refetch();
    props.onChanged?.();
  };

  const handleAccept = async (knock: KnockRow) => {
    setAccepting(knock.id);
    clearRowError(knock.id);
    try {
      const selection = acceptSelection()[knock.id] ?? null;
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
      await notifyChanged();
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
      await notifyChanged();
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
      await notifyChanged();
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
      await notifyChanged();
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
                      <div class="text-xs text-[var(--color-text-muted)] flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span class="flex items-center gap-1.5">
                          node id:{" "}
                          <code title={knock.node_id}>{truncateMiddle(knock.node_id, 20)}</code>
                          <CopyButton
                            text={knock.node_id}
                            label="copy"
                            copiedLabel="copied!"
                            title="copy node id"
                          />
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

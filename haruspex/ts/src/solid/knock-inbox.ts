// headless knock-inbox state: lists pending (or all) knocks for a
// resource the caller administers, tracks per-row accept/reject/delete
// loading state and per-row errors, and exposes accept/reject/delete/
// reject-all actions - all with zero markup, list-transport, or error-
// shape opinions of its own.
//
// the caller supplies how a row is listed/decided (any admin api, any
// row shape) and how to identify a row's key; this module only owns the
// resource-loading/action/error-tracking state around those calls.

import { createResource, createSignal, type Accessor, type Resource } from "solid-js";

/** one decision made when accepting a knock. */
export interface KnockAcceptDecision {
  role: string;
  username?: string | null;
  userId?: string | null;
}

/** one error surfaced by a row-level action. */
export interface KnockRowError {
  action: string;
  title?: string;
  detail: string;
  errorType?: string;
}

export interface KnockInboxDeps<TRow> {
  /** fetches the current list. `includeAll` reflects the inbox's own
   *  toggle (e.g. "show resolved knocks too"). */
  listKnocks(includeAll: boolean): Promise<TRow[]>;
  acceptKnock(knock: TRow, decision: KnockAcceptDecision): Promise<void>;
  rejectKnock(knock: TRow): Promise<void>;
  deleteKnock(knock: TRow): Promise<void>;
  /** optional bulk reject; omit if the caller's api has no such endpoint. */
  rejectAllKnocks?(): Promise<{ rejected: number }>;
  /** extracts a stable key from a row, used for per-row loading/error
   *  tracking. */
  getId(knock: TRow): string;
  /** maps a thrown error into one or more row errors. defaults to a
   *  single generic error built from `error.message`/`String(error)`. */
  mapError?(action: string, error: unknown): KnockRowError[];
  /** fired after any successful mutation (accept/reject/delete/rejectAll). */
  onChanged?(): void;
  /** fired on any action's success, for toast-like side effects. */
  onActionSuccess?(action: string, knock: TRow | null, result?: unknown): void;
  /** fired on any action's failure, for toast-like side effects. */
  onActionError?(action: string, knock: TRow | null, error: unknown): void;
}

export interface KnockInboxState<TRow> {
  /** the current list resource (undefined while first loading). */
  knocks: Resource<TRow[]>;
  /** true while the list itself is (re)loading. */
  loading: Accessor<boolean>;
  includeAll: Accessor<boolean>;
  setIncludeAll(value: boolean): void;
  /** id of the row currently being accepted, or null. */
  accepting: Accessor<string | null>;
  /** id of the row currently being rejected, or null. */
  rejecting: Accessor<string | null>;
  /** id of the row currently being deleted, or null. */
  deleting: Accessor<string | null>;
  rowErrors: Accessor<Record<string, KnockRowError[]>>;
  clearRowError(id: string): void;
  accept(knock: TRow, decision: KnockAcceptDecision): Promise<void>;
  reject(knock: TRow): Promise<void>;
  remove(knock: TRow): Promise<void>;
  rejectAll(): Promise<void>;
  refetch(): TRow[] | Promise<TRow[] | undefined> | undefined | null;
}

const defaultMapError = (action: string, error: unknown): KnockRowError[] => [
  { action, detail: error instanceof Error ? error.message : String(error) },
];

export function createKnockInbox<TRow>(deps: KnockInboxDeps<TRow>): KnockInboxState<TRow> {
  const mapError = deps.mapError ?? defaultMapError;
  const [includeAll, setIncludeAll] = createSignal(false);

  // createResource skips its fetcher when the source returns a falsy
  // value (false/null/undefined) - wrapping in an object so the initial
  // `false` still triggers the first fetch.
  const [knocks, { refetch }] = createResource(
    () => ({ all: includeAll() }),
    async ({ all }) => {
      try {
        return await deps.listKnocks(all);
      } catch (error) {
        deps.onActionError?.("list", null, error);
        return [];
      }
    },
  );

  const [accepting, setAccepting] = createSignal<string | null>(null);
  const [rejecting, setRejecting] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal<string | null>(null);
  const [rowErrors, setRowErrors] = createSignal<Record<string, KnockRowError[]>>({});

  function setRowError(id: string, action: string, error: unknown): void {
    setRowErrors({ ...rowErrors(), [id]: mapError(action, error) });
  }

  function clearRowError(id: string): void {
    const { [id]: _removed, ...rest } = rowErrors();
    setRowErrors(rest);
  }

  async function notifyChanged(): Promise<void> {
    await refetch();
    deps.onChanged?.();
  }

  async function accept(knock: TRow, decision: KnockAcceptDecision): Promise<void> {
    const id = deps.getId(knock);
    setAccepting(id);
    clearRowError(id);
    try {
      await deps.acceptKnock(knock, decision);
      deps.onActionSuccess?.("accept", knock);
      await notifyChanged();
    } catch (error) {
      setRowError(id, "accept", error);
      deps.onActionError?.("accept", knock, error);
    } finally {
      setAccepting(null);
    }
  }

  async function reject(knock: TRow): Promise<void> {
    const id = deps.getId(knock);
    setRejecting(id);
    clearRowError(id);
    try {
      await deps.rejectKnock(knock);
      deps.onActionSuccess?.("reject", knock);
      await notifyChanged();
    } catch (error) {
      setRowError(id, "reject", error);
      deps.onActionError?.("reject", knock, error);
    } finally {
      setRejecting(null);
    }
  }

  async function remove(knock: TRow): Promise<void> {
    const id = deps.getId(knock);
    setDeleting(id);
    clearRowError(id);
    try {
      await deps.deleteKnock(knock);
      deps.onActionSuccess?.("delete", knock);
      await notifyChanged();
    } catch (error) {
      setRowError(id, "delete", error);
      deps.onActionError?.("delete", knock, error);
    } finally {
      setDeleting(null);
    }
  }

  async function rejectAll(): Promise<void> {
    if (!deps.rejectAllKnocks) return;
    try {
      const result = await deps.rejectAllKnocks();
      deps.onActionSuccess?.("rejectAll", null, result);
      await notifyChanged();
    } catch (error) {
      deps.onActionError?.("rejectAll", null, error);
    }
  }

  return {
    knocks,
    loading: () => knocks.loading,
    includeAll,
    setIncludeAll,
    accepting,
    rejecting,
    deleting,
    rowErrors,
    clearRowError,
    accept,
    reject,
    remove,
    rejectAll,
    refetch,
  };
}

/**
 * one-shot drain: copy IndexedDB `remotes` store into the sqlite `remotez`
 * table on first boot in tauri context.
 *
 * - non-destructive: IDB rows are NOT deleted; they remain as a backup
 *   until we're confident in the sqlite source-of-truth path
 * - idempotent: a `remotes_drained_to_sqlite_at` flag in STORE_APP_STATE
 *   prevents repeat drains
 * - dedup: skips any row whose remote_id OR peer_addr already exists in
 *   sqlite
 *
 * see docs/wizard-remote-admin.md for the full plan.
 */

import { isCharnelMode } from "../charnel/mode";
import { initAppDB } from "../storage/db";
import { STORE_APP_STATE, STORE_PENDING_REMOTES, STORE_REMOTES } from "../storage/types";
import { parseRemotes, type PendingRemote } from "../storage/types";
import { debug, error as errorLog } from "../../../utils/logger";
import { listRemotes, upsertRemote, type UpsertRemoteRequest } from "./sqliteRemotes";
import { createPendingRemoteSqlite } from "./sqlitePendingRemotes";

const DRAIN_FLAG_KEY = "remotes_drained_to_sqlite_at";

async function getDrainFlag(): Promise<number | null> {
  const db = await initAppDB();
  const state = (await db.get(STORE_APP_STATE, DRAIN_FLAG_KEY)) as
    { id: string; value: number } | undefined;
  return state?.value ?? null;
}

async function setDrainFlag(timestamp: number): Promise<void> {
  const db = await initAppDB();
  await db.put(STORE_APP_STATE, { id: DRAIN_FLAG_KEY, value: timestamp });
}

/**
 * drain IDB remotes into sqlite. safe to call on every boot; only runs once.
 * no-op outside tauri context.
 */
export async function drainIdbRemotesToSqlite(): Promise<void> {
  if (!isCharnelMode()) return;

  if ((await getDrainFlag()) !== null) {
    debug("[remotes-drain] already drained, skipping");
    return;
  }

  try {
    const db = await initAppDB();
    const rawIdbRemotes = await db.getAll(STORE_REMOTES);
    const idbRemotes = parseRemotes(rawIdbRemotes);

    if (idbRemotes.length === 0) {
      debug("[remotes-drain] no IDB remotes to drain");
      await setDrainFlag(Date.now());
      return;
    }

    const sqliteRemotes = await listRemotes();
    const existingIds = new Set(sqliteRemotes.map((r) => r.remote_id));
    const existingPeerAddrs = new Set(
      sqliteRemotes
        .map((r) => r.peer_addr)
        .filter((a): a is string => typeof a === "string" && a.length > 0)
    );

    let drained = 0;
    let skipped = 0;

    for (const r of idbRemotes) {
      if (existingIds.has(r.remote_id)) {
        skipped++;
        continue;
      }
      const peerAddr = "peer_addr" in r ? r.peer_addr : undefined;
      if (peerAddr && existingPeerAddrs.has(peerAddr)) {
        skipped++;
        continue;
      }

      const req: UpsertRemoteRequest = {
        remote_id: r.remote_id,
        name: r.name,
        transport: r.transport,
        base_url: r.base_url ?? null,
        peer_addr: peerAddr ?? null,
        api_key: r.api_key ?? null,
        is_active: r.is_active,
        is_charnel_managed: r.is_charnel_managed ?? false,
        last_connected_at: r.last_connected_at,
        description: r.description,
        image_url: r.image_url,
        image_blob_id: r.image_blob_id,
        version: r.version,
        last_info_check: r.last_info_check,
        is_offline: r.is_offline ?? null,
        offline_since: r.offline_since ?? null,
        last_checked: r.last_checked ?? null,
        metadata: null,
      };

      try {
        await upsertRemote(req);
        drained++;
      } catch (e) {
        errorLog(`[remotes-drain] failed to upsert ${r.remote_id}:`, e);
      }
    }

    debug(`[remotes-drain] complete: ${drained} drained, ${skipped} skipped (already in sqlite)`);
    await setDrainFlag(Date.now());
  } catch (e) {
    errorLog("[remotes-drain] drain failed:", e);
    // do NOT set the flag — try again next boot
  }
}

const PENDING_DRAIN_FLAG_KEY = "pending_remotes_drained_to_sqlite_at";

async function getPendingDrainFlag(): Promise<number | null> {
  const db = await initAppDB();
  const state = (await db.get(STORE_APP_STATE, PENDING_DRAIN_FLAG_KEY)) as
    { id: string; value: number } | undefined;
  return state?.value ?? null;
}

async function setPendingDrainFlag(timestamp: number): Promise<void> {
  const db = await initAppDB();
  await db.put(STORE_APP_STATE, { id: PENDING_DRAIN_FLAG_KEY, value: timestamp });
}

/**
 * one-shot drain: copy IndexedDB `pending_remotes` store into the sqlite
 * `remotez` table (as `pending_stage`-tagged rows - see
 * `grimoire::pending_remotez`'s doc comment for why there's no separate
 * table) on first boot in tauri context, for anyone upgrading from a
 * charnel build where pending remotes only ever lived in IDB (<=0.3.14 -
 * this feature's own first release). mirrors `drainIdbRemotesToSqlite`'s
 * shape exactly, including its own separate idempotency flag (a pending
 * remote isn't a `Remote`, so it can't share that drain's flag/dedup
 * bookkeeping even though it runs in the same boot step).
 *
 * - non-destructive: IDB rows are NOT deleted; they remain as a backup
 * - idempotent: a `pending_remotes_drained_to_sqlite_at` flag in
 *   STORE_APP_STATE prevents repeat drains - the only safety net needed
 *   here (unlike established remotes, a pending row has no id/peer_addr
 *   uniqueness to dedup against even if this somehow ran twice - sqlite
 *   always assigns a fresh id on create, so an id-based dedup check
 *   against the drained rows would never actually match anything)
 *
 * safe to call on every boot; only runs once. no-op outside tauri context.
 */
export async function drainIdbPendingRemotesToSqlite(): Promise<void> {
  if (!isCharnelMode()) return;

  if ((await getPendingDrainFlag()) !== null) {
    debug("[pending-remotes-drain] already drained, skipping");
    return;
  }

  try {
    const db = await initAppDB();
    const idbPending = (await db.getAll(STORE_PENDING_REMOTES)) as PendingRemote[];

    if (idbPending.length === 0) {
      debug("[pending-remotes-drain] no IDB pending remotes to drain");
      await setPendingDrainFlag(Date.now());
      return;
    }

    let drained = 0;

    for (const p of idbPending) {
      try {
        // sqlite assigns its own fresh id on create (same as the IDB
        // store always has, via generateUUID() at creation time) - the
        // original IDB id isn't preserved, since nothing else references
        // a pending remote by id across a drain boundary like this.
        await createPendingRemoteSqlite({
          peer_addr: p.peer_addr,
          transport: p.transport,
          stage: p.stage,
          server_name: p.server_name,
          server_description: p.server_description,
          server_version: p.server_version,
          server_image_data: p.server_image_data,
          server_image_type: p.server_image_type,
          knock_username: p.knock_username,
          knock_message: p.knock_message,
          error_message: p.error_message,
        });
        drained++;
      } catch (e) {
        errorLog(`[pending-remotes-drain] failed to create ${p.id}:`, e);
      }
    }

    debug(`[pending-remotes-drain] complete: ${drained} drained`);
    await setPendingDrainFlag(Date.now());
  } catch (e) {
    errorLog("[pending-remotes-drain] drain failed:", e);
    // do NOT set the flag — try again next boot
  }
}

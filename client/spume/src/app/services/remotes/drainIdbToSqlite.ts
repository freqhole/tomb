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
import { STORE_APP_STATE, STORE_REMOTES } from "../storage/types";
import { parseRemotes } from "../storage/types";
import { debug, error as errorLog } from "../../../utils/logger";
import {
  listRemotes,
  upsertRemote,
  type UpsertRemoteRequest,
} from "./sqliteRemotes";

const DRAIN_FLAG_KEY = "remotes_drained_to_sqlite_at";

async function getDrainFlag(): Promise<number | null> {
  const db = await initAppDB();
  const state = (await db.get(STORE_APP_STATE, DRAIN_FLAG_KEY)) as
    | { id: string; value: number }
    | undefined;
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

    debug(
      `[remotes-drain] complete: ${drained} drained, ${skipped} skipped (already in sqlite)`
    );
    await setDrainFlag(Date.now());
  } catch (e) {
    errorLog("[remotes-drain] drain failed:", e);
    // do NOT set the flag — try again next boot
  }
}

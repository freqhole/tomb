import { createSignal } from "solid-js";
import { decodeShareToken, encodeShareToken } from "../../../utils/permalink";
import { initAppDB } from "./db";
import { STORE_SHARED_ITEMS, type SharedItemEntry } from "./types";

const [sharedItems, setSharedItems] = createSignal<SharedItemEntry[]>([]);

export { sharedItems };

function dedupeKeyFromPayload(payload: ReturnType<typeof decodeShareToken>): string {
  return [
    payload.k,
    payload.i,
    payload.p ?? "",
    payload.s.n ?? "",
    payload.s.h ?? "",
  ].join("|");
}

export async function loadSharedItems(): Promise<SharedItemEntry[]> {
  const db = await initAppDB();
  const rows = await db.getAll(STORE_SHARED_ITEMS);
  rows.sort((a, b) => b.last_seen_at - a.last_seen_at);
  setSharedItems(rows);
  return rows;
}

export async function recordSharedItemFromToken(token: string): Promise<SharedItemEntry | null> {
  try {
    const db = await initAppDB();
    const payload = decodeShareToken(token);
    const canonicalToken = encodeShareToken(payload);
    const id = dedupeKeyFromPayload(payload);
    const now = Date.now();

    const existing = await db.get(STORE_SHARED_ITEMS, id);
    const next: SharedItemEntry = {
      id,
      token: canonicalToken,
      kind: payload.k,
      entity_id: payload.i,
      parent_id: payload.p,
      title: payload.t,
      source_node_id: payload.s.n,
      source_http_origin: payload.s.h,
      first_seen_at: existing?.first_seen_at ?? now,
      last_seen_at: now,
      seen_count: (existing?.seen_count ?? 0) + 1,
    };

    await db.put(STORE_SHARED_ITEMS, next);
    await loadSharedItems();
    return next;
  } catch (error) {
    console.warn("failed to record shared item:", error);
    return null;
  }
}

export async function deleteSharedItem(id: string): Promise<void> {
  const db = await initAppDB();
  await db.delete(STORE_SHARED_ITEMS, id);
  await loadSharedItems();
}

export async function clearSharedItems(): Promise<void> {
  const db = await initAppDB();
  await db.clear(STORE_SHARED_ITEMS);
  setSharedItems([]);
}

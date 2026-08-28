// paired player devices (freqhole-player/1 remotes) — IDB-backed, own
// object store. NOT part of the `Remote` schema: a paired player has no
// http/admin api surface, just pairing + a small control-command
// protocol, so folding it into the `Remote` discriminated union would
// leak player-only concerns (pin state, control acks) into every
// generic remote/api-dispatch call site. see
// docs/player-remote-site-plan.md phase 5 for the full rationale.

import { initAppDB } from "../storage/db";
import { STORE_PAIRED_PLAYERS, type PairedPlayer } from "../storage/types";
import { createSignal } from "solid-js";

// bumped whenever players are paired/renamed/forgotten so views can
// refresh without polling (mirrors radioHistoryVersion's pattern).
const [version, setVersion] = createSignal(0);
export const pairedPlayersVersion = version;

function bumpVersion(): void {
  setVersion((v) => v + 1);
}

export async function listPairedPlayers(): Promise<PairedPlayer[]> {
  const db = await initAppDB();
  const all = (await db.getAll(STORE_PAIRED_PLAYERS)) as PairedPlayer[];
  return all.sort((a, b) => b.paired_at - a.paired_at);
}

export async function getPairedPlayer(nodeId: string): Promise<PairedPlayer | null> {
  const db = await initAppDB();
  const record = (await db.get(STORE_PAIRED_PLAYERS, nodeId)) as PairedPlayer | undefined;
  return record ?? null;
}

export async function savePairedPlayer(nodeId: string, displayName: string): Promise<PairedPlayer> {
  const db = await initAppDB();
  const existing = (await db.get(STORE_PAIRED_PLAYERS, nodeId)) as PairedPlayer | undefined;
  const record: PairedPlayer = {
    node_id: nodeId,
    display_name: displayName,
    paired_at: existing?.paired_at ?? Date.now(),
    last_used_at: existing?.last_used_at ?? null,
  };
  await db.put(STORE_PAIRED_PLAYERS, record);
  bumpVersion();
  return record;
}

export async function renamePairedPlayer(nodeId: string, displayName: string): Promise<void> {
  const db = await initAppDB();
  const existing = (await db.get(STORE_PAIRED_PLAYERS, nodeId)) as PairedPlayer | undefined;
  if (!existing) return;
  await db.put(STORE_PAIRED_PLAYERS, { ...existing, display_name: displayName });
  bumpVersion();
}

export async function forgetPairedPlayer(nodeId: string): Promise<void> {
  const db = await initAppDB();
  await db.delete(STORE_PAIRED_PLAYERS, nodeId);
  bumpVersion();
}

export async function touchPairedPlayer(nodeId: string): Promise<void> {
  const db = await initAppDB();
  const existing = (await db.get(STORE_PAIRED_PLAYERS, nodeId)) as PairedPlayer | undefined;
  if (!existing) return;
  await db.put(STORE_PAIRED_PLAYERS, { ...existing, last_used_at: Date.now() });
}

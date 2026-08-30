// the cenotaph player's single, singleton "who can send queue/playback
// commands right now" session - deliberately ephemeral rather than a
// persistent per-peer allowlist (see docs/player-peer-trust-bridge-plan.md
// implementation plan). base peer trust (pairing/trustStore.ts) answers
// "is this node id known at all, and what role does it have" and persists
// indefinitely; this session answers the narrower, shorter-lived "is this
// known peer part of the current gathering" question.
//
// the session's own pin IS the pairing pin shown under the player's QR
// code - redeeming it (see pairingHandler.ts) both trusts the peer (if
// not already trusted) and joins it into the session in one step, so a
// host app never has to juggle two separate codes.

import { generatePin } from "./pin";
import { openDB, type IDBPDatabase } from "idb";

/** "everyone": any currently-trusted peer may send commands, no pin
 * needed. "selected": only peers in `allowed_node_ids` may - which starts
 * empty (the default, closed state) and grows either from the settings
 * modal picking specific known peers, or from a peer redeeming the
 * current session pin. */
export type SessionMode = "everyone" | "selected";

export interface PlayerSession {
  pin: string;
  mode: SessionMode;
  allowed_node_ids: string[];
  /** one-shot: the next successful pin redemption grants the `"admin"`
   * role regardless of the trust store already having members - set by
   * the settings modal's "regenerate admin pairing code" button. */
  admin_grant_pending: boolean;
  last_active_at: number;
}

export interface PlayerSessionStore {
  loadSession(): Promise<PlayerSession | null>;
  saveSession(session: PlayerSession): Promise<void>;
}

const SESSION_IDLE_MS = 60 * 60 * 1000;

function freshSession(overrides: Partial<PlayerSession> = {}): PlayerSession {
  return {
    pin: generatePin(),
    mode: "selected",
    allowed_node_ids: [],
    admin_grant_pending: false,
    last_active_at: Date.now(),
    ...overrides,
  };
}

/** loads the singleton session, creating one (or rotating its pin, and
 * dropping stale joins) if it's been idle for over an hour. no separate
 * heartbeat protocol - `touchSession`/`joinSession` below are what keep an
 * active session's clock from expiring. */
export async function ensureActiveSession(store: PlayerSessionStore): Promise<PlayerSession> {
  const existing = await store.loadSession();
  if (!existing) {
    const created = freshSession();
    await store.saveSession(created);
    return created;
  }
  if (Date.now() - existing.last_active_at > SESSION_IDLE_MS) {
    const rotated: PlayerSession = {
      ...existing,
      pin: generatePin(),
      allowed_node_ids: [],
      admin_grant_pending: false,
      last_active_at: Date.now(),
    };
    await store.saveSession(rotated);
    return rotated;
  }
  return existing;
}

export async function touchSession(
  store: PlayerSessionStore,
  session: PlayerSession,
): Promise<PlayerSession> {
  const touched = { ...session, last_active_at: Date.now() };
  await store.saveSession(touched);
  return touched;
}

export function isPeerAllowedInSession(session: PlayerSession, nodeId: string): boolean {
  return session.mode === "everyone" || session.allowed_node_ids.includes(nodeId);
}

/** records that `nodeId` redeemed the session pin (or was hand-picked in
 * the settings modal) - adds it to the allowlist and consumes any pending
 * one-time admin grant. */
export async function joinSession(
  store: PlayerSessionStore,
  session: PlayerSession,
  nodeId: string,
): Promise<PlayerSession> {
  const allowed = session.allowed_node_ids.includes(nodeId)
    ? session.allowed_node_ids
    : [...session.allowed_node_ids, nodeId];
  const joined: PlayerSession = {
    ...session,
    allowed_node_ids: allowed,
    admin_grant_pending: false,
    last_active_at: Date.now(),
  };
  await store.saveSession(joined);
  return joined;
}

export async function setSessionMode(
  store: PlayerSessionStore,
  session: PlayerSession,
  mode: SessionMode,
): Promise<PlayerSession> {
  const next = { ...session, mode, last_active_at: Date.now() };
  await store.saveSession(next);
  return next;
}

/** the settings-modal counterpart to `joinSession` - manually removes a
 * known peer from the current session's allowlist (e.g. unchecking it in
 * a "who's in this session" picker), without forgetting its base trust. */
export async function leaveSession(
  store: PlayerSessionStore,
  session: PlayerSession,
  nodeId: string,
): Promise<PlayerSession> {
  const next: PlayerSession = {
    ...session,
    allowed_node_ids: session.allowed_node_ids.filter((id) => id !== nodeId),
    last_active_at: Date.now(),
  };
  await store.saveSession(next);
  return next;
}

/** mint a fresh one-time pin that grants the `"admin"` role on its next
 * redemption - "regenerate admin pairing code" in the settings modal, for
 * bootstrapping a first (or additional) admin without an existing one. */
export async function regenerateAdminPin(
  store: PlayerSessionStore,
  session: PlayerSession,
): Promise<PlayerSession> {
  const next: PlayerSession = {
    ...session,
    pin: generatePin(),
    admin_grant_pending: true,
    last_active_at: Date.now(),
  };
  await store.saveSession(next);
  return next;
}

/** rotate the session pin without granting admin - a plain "new code"
 * button, distinct from the admin-bootstrap one above. */
export async function regenerateSessionPin(
  store: PlayerSessionStore,
  session: PlayerSession,
): Promise<PlayerSession> {
  const next: PlayerSession = {
    ...session,
    pin: generatePin(),
    last_active_at: Date.now(),
  };
  await store.saveSession(next);
  return next;
}

export interface IdbPlayerSessionStoreOptions {
  databaseName?: string;
  storeName?: string;
}

const SESSION_KEY = "singleton";

/** default session store implementation, own dedicated database - see
 * `createIdbTrustStore`'s equivalent note (a host app with its own
 * database, e.g. spume, should implement `PlayerSessionStore` directly
 * against that instead). */
export function createIdbPlayerSessionStore(
  options: IdbPlayerSessionStoreOptions = {},
): PlayerSessionStore {
  const databaseName = options.databaseName ?? "cenotaph_player_session";
  const storeName = options.storeName ?? "player_session";

  let dbPromise: Promise<IDBPDatabase> | null = null;

  function getDb(): Promise<IDBPDatabase> {
    if (!dbPromise) {
      dbPromise = openDB(databaseName, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        },
      });
    }
    return dbPromise;
  }

  return {
    async loadSession() {
      const db = await getDb();
      return ((await db.get(storeName, SESSION_KEY)) as PlayerSession | undefined) ?? null;
    },
    async saveSession(session) {
      const db = await getDb();
      await db.put(storeName, session, SESSION_KEY);
    },
  };
}

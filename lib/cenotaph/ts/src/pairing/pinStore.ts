// reactive wrapper around playerSession.ts's PlayerSession, for host apps
// with a solid UI (e.g. spume's PlayerSettingsPanel) that want to read/
// rotate the pairing pin without wiring their own signal. framework-
// optional: a host app with no solid UI can just call playerSession.ts's
// plain async functions directly instead of using this at all.
//
// the pin used to be its own independent, purely in-memory value (see
// git history) - it's now sourced from the session's persisted `pin`
// field (playerSession.ts), since redeeming it both trusts a peer and
// joins the current session in one step.

import { createSignal } from "solid-js";
import {
  ensureActiveSession,
  regenerateSessionPin,
  type PlayerSession,
  type PlayerSessionStore,
} from "./playerSession";

const [session, setSession] = createSignal<PlayerSession | null>(null);

/** reactive accessor for the active session, once loaded via
 * `initSessionSignal` (null before that). */
export const currentSession = session;

/** reactive pin accessor (safe to call from a solid component) - empty
 * string before the session has loaded. */
export const currentPin = () => session()?.pin ?? "";

/** load (or create) the active session and start tracking it reactively -
 * call once at host-app startup, e.g. alongside wiring up the accept loop. */
export async function initSessionSignal(store: PlayerSessionStore): Promise<PlayerSession> {
  const loaded = await ensureActiveSession(store);
  setSession(loaded);
  return loaded;
}

/** push an externally-updated session (e.g. one returned by
 * `joinSession`/`ensureActiveSession` from the accept loop's connection
 * handler) into the reactive signal, so any solid UI reading `currentPin`/
 * `currentSession` picks up the change immediately. */
export function setSessionSignal(next: PlayerSession): void {
  setSession(next);
}

/** rotate the pin (plain, non-admin-granting) and update the signal. */
export async function regeneratePin(store: PlayerSessionStore): Promise<string> {
  const base = session() ?? (await ensureActiveSession(store));
  const next = await regenerateSessionPin(store, base);
  setSession(next);
  return next.pin;
}

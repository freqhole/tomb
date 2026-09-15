// implements cenotaph's `PlayerSessionStore` interface against spume's own
// existing `freqhole_app` database (see storage/types.ts's
// `STORE_PLAYER_SESSION`) - deliberately not cenotaph's own
// `createIdbPlayerSessionStore()`, same rationale as trustStoreAdapter.ts.

import type { PlayerSession, PlayerSessionStore } from "@freqhole/cenotaph";
import { initAppDB } from "../storage/db";
import { STORE_PLAYER_SESSION } from "../storage/types";

const SESSION_KEY = "singleton";

export const spumeSessionStore: PlayerSessionStore = {
  async loadSession() {
    const db = await initAppDB();
    return ((await db.get(STORE_PLAYER_SESSION, SESSION_KEY)) as PlayerSession | undefined) ?? null;
  },

  async saveSession(session) {
    const db = await initAppDB();
    await db.put(STORE_PLAYER_SESSION, session, SESSION_KEY);
  },
};

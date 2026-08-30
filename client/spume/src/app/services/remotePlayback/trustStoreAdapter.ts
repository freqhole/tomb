// implements cenotaph's `TrustStore` interface directly against spume's
// own existing `freqhole_app` database (see storage/types.ts's
// `STORE_TRUSTED_CONTROLLERS`, the mirror-image of `paired_players.ts`'s
// store) - deliberately NOT cenotaph's own `createIdbTrustStore()`, which
// would stand up a second, separate indexeddb database for no reason when
// spume already has one to share.

import type { TrustedController, TrustStore } from "@freqhole/cenotaph";
import { initAppDB } from "../storage/db";
import { STORE_TRUSTED_CONTROLLERS } from "../storage/types";

export const spumeTrustStore: TrustStore = {
  async isTrustedController(nodeId) {
    const db = await initAppDB();
    return (await db.get(STORE_TRUSTED_CONTROLLERS, nodeId)) !== undefined;
  },

  async getTrustedController(nodeId) {
    const db = await initAppDB();
    return (await db.get(STORE_TRUSTED_CONTROLLERS, nodeId)) as TrustedController | undefined;
  },

  async trustController(nodeId, displayName) {
    const db = await initAppDB();
    const controller: TrustedController = {
      node_id: nodeId,
      display_name: displayName,
      paired_at: Date.now(),
    };
    await db.put(STORE_TRUSTED_CONTROLLERS, controller);
  },

  async forgetController(nodeId) {
    const db = await initAppDB();
    await db.delete(STORE_TRUSTED_CONTROLLERS, nodeId);
  },

  async listTrustedControllers() {
    const db = await initAppDB();
    return (await db.getAll(STORE_TRUSTED_CONTROLLERS)) as TrustedController[];
  },
};

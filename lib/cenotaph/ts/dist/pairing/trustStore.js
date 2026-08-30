// trust store: which controller node ids this player accepts commands
// from. injected by the host app (see `TrustStore` below) rather than
// owned outright by this package, because a host app that already runs on
// its own established origin/database (e.g. spume, sharing a single
// `freqhole_app` indexeddb database with everything else it stores)
// should keep this list in that same database instead of standing up a
// second, parallel one just for cenotaph. `createIdbTrustStore` below is
// only a ready-made default for a host with no pre-existing storage to
// fold this into (e.g. player.freqhole.net, a standalone site).
import { openDB } from "idb";
/** default trust store implementation: its own dedicated indexeddb
 * database. a host app that already has its own database to share should
 * implement `TrustStore` directly against that instead of using this. */
export function createIdbTrustStore(options = {}) {
    const databaseName = options.databaseName ?? "cenotaph_player_trust";
    const storeName = options.storeName ?? "trusted_controllers";
    let dbPromise = null;
    function getDb() {
        if (!dbPromise) {
            dbPromise = openDB(databaseName, 1, {
                upgrade(db) {
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName, { keyPath: "node_id" });
                    }
                },
            });
        }
        return dbPromise;
    }
    return {
        async isTrustedController(nodeId) {
            const db = await getDb();
            return (await db.get(storeName, nodeId)) !== undefined;
        },
        async getTrustedController(nodeId) {
            const db = await getDb();
            return db.get(storeName, nodeId);
        },
        async trustController(nodeId, displayName) {
            const db = await getDb();
            const controller = {
                node_id: nodeId,
                display_name: displayName,
                paired_at: Date.now(),
            };
            await db.put(storeName, controller);
        },
        async forgetController(nodeId) {
            const db = await getDb();
            await db.delete(storeName, nodeId);
        },
        async listTrustedControllers() {
            const db = await getDb();
            return db.getAll(storeName);
        },
    };
}

// persisted device display name, shown to controllers during pairing.
// same "own dedicated idb database" rationale as pairing/trustStore.ts's
// default - avoids version/upgrade races with a host app's own stores.
import { openDB } from "idb";
import { createSignal } from "solid-js";
const DB_NAME = "freqhole_player_settings";
const DB_VERSION = 1;
const STORE_NAME = "settings";
const NAME_KEY = "display_name";
export const DEFAULT_DISPLAY_NAME = "freqhole player";
let dbPromise = null;
function getDb() {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            },
        });
    }
    return dbPromise;
}
const [name, setName] = createSignal(DEFAULT_DISPLAY_NAME);
/** current device display name (reactive - safe to call from a solid component). */
export const deviceName = name;
/** load the persisted display name, if any, into the reactive signal. */
export async function loadDeviceName() {
    const db = await getDb();
    const stored = await db.get(STORE_NAME, NAME_KEY);
    if (typeof stored === "string" && stored.trim()) {
        setName(stored);
    }
}
/** persist a new display name - takes effect for the next pairing (existing
 * trusted controllers keep whatever display name they already recorded). */
export async function setDeviceName(next) {
    const trimmed = next.trim() || DEFAULT_DISPLAY_NAME;
    const db = await getDb();
    await db.put(STORE_NAME, trimmed, NAME_KEY);
    setName(trimmed);
}

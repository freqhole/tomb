// persisted "devel mode" toggle: while on, a host app suppresses fullscreen
// video playback and shows the console-log debug overlay (see
// debug/consoleCapture.ts) - meant for debugging on devices (tvs, embedded
// browsers) with no accessible devtools. own dedicated idb database, same
// rationale as deviceNameStore.ts (avoids version/upgrade races with a host
// app's own stores).
import { openDB } from "idb";
import { createSignal } from "solid-js";
const DB_NAME = "freqhole_player_devel_mode";
const DB_VERSION = 1;
const STORE_NAME = "settings";
const DEVEL_MODE_KEY = "devel_mode";
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
const [develMode, setDevelModeSignal] = createSignal(false);
/** whether devel mode is currently on (reactive - safe to call from a solid component). */
export { develMode };
/** load the persisted devel-mode toggle, if any, into the reactive signal. */
export async function loadDevelMode() {
    const db = await getDb();
    const stored = await db.get(STORE_NAME, DEVEL_MODE_KEY);
    if (typeof stored === "boolean")
        setDevelModeSignal(stored);
}
export async function setDevelMode(next) {
    const db = await getDb();
    await db.put(STORE_NAME, next, DEVEL_MODE_KEY);
    setDevelModeSignal(next);
}

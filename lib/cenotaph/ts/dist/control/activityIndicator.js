// tracks "the player recently received real client activity" for a
// qr-overlay loading spinner: any real command (anything but `get_status`,
// which every paired client polls with forever, even while genuinely idle)
// marks activity. the spinner spins at full speed for as long as a command
// that can actually start playback is still being processed (see
// dispatcher.ts's `commandInFlight`), then ramps down smoothly over
// IDLE_TIMEOUT_MS once nothing further arrives, rather than snapping
// straight from spinning to hidden - a paired-but-idle controller that
// never queues anything eventually goes fully quiet again.
import { createSignal } from "solid-js";
const IDLE_TIMEOUT_MS = 10_000;
const TICK_MS = 100;
const [lastActivityAt, setLastActivityAt] = createSignal(null);
const [now, setNow] = createSignal(Date.now());
let ticking = false;
/** call for any client command except `get_status`. */
export function markActivity() {
    setLastActivityAt(Date.now());
    ensureTicking();
}
function ensureTicking() {
    if (ticking)
        return;
    ticking = true;
    const id = setInterval(() => {
        setNow(Date.now());
        if (activityRamp() === null) {
            clearInterval(id);
            ticking = false;
        }
    }, TICK_MS);
}
/** 0 (activity just happened) .. 1 (about to time out), or null once idle
 * for IDLE_TIMEOUT_MS - a host app's qr overlay maps this to spin speed and
 * hides the spinner entirely at null. */
export function activityRamp() {
    const last = lastActivityAt();
    if (last === null)
        return null;
    const elapsed = now() - last;
    if (elapsed >= IDLE_TIMEOUT_MS)
        return null;
    return elapsed / IDLE_TIMEOUT_MS;
}

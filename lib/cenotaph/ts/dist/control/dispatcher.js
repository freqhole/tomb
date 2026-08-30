// control command dispatcher: validates commands from an already-trusted
// controller and routes them to a caller-supplied `PlaybackBackend`,
// instead of importing one hardcoded playback engine directly - see
// playbackBackend.ts.
import { createSignal } from "solid-js";
import { PlayerCommandSchema } from "./schema";
import { broadcastStatus } from "./statusSubscribers";
import { markActivity } from "./activityIndicator";
// only the handful of commands that can take the player from idle (no
// now-playing item, qr code showing) to actually playing something count
// as "loading" for `commandInFlight` below - e.g. `get_status` (sent
// constantly by every paired client's background poll, even while
// genuinely idle) must NOT flip this, or a qr-overlay loading spinner
// would flicker every few seconds regardless of whether anything's
// actually happening.
const QR_HIDING_COMMANDS = new Set(["play", "replace_queue", "append_queue"]);
const [commandInFlight, setCommandInFlight] = createSignal(false);
/** true while a command that would transition the player out of its idle/
 * qr-showing state is being processed - a host app's qr overlay can use
 * this for its loading state. */
export { commandInFlight };
export async function dispatchCommand(backend, node, rawLine) {
    const parsed = PlayerCommandSchema.safeParse(JSON.parse(rawLine));
    if (!parsed.success) {
        // TEMP DEBUG - remove once sync-to-local wiring bug is found
        console.log(`[debug/dispatcher] failed to parse command:`, rawLine, parsed.error);
        return { type: "command_ack", ok: false, reason: "invalid_command" };
    }
    const command = parsed.data;
    // TEMP DEBUG - remove once sync-to-local wiring bug is found
    if (command.command !== "get_status") {
        console.log(`[debug/dispatcher] dispatching command:`, command);
    }
    const tracksLoading = QR_HIDING_COMMANDS.has(command.command);
    if (command.command !== "get_status")
        markActivity();
    if (tracksLoading)
        setCommandInFlight(true);
    try {
        switch (command.command) {
            case "play":
                await backend.play(node, command.item);
                break;
            case "replace_queue":
                await backend.replaceQueue(node, command.items);
                break;
            case "append_queue":
                await backend.appendQueue(node, command.items);
                break;
            case "pause":
                backend.pause();
                break;
            case "resume":
                backend.resume();
                break;
            case "seek":
                backend.seek(command.position_ms);
                break;
            case "skip":
                await backend.skip(node);
                break;
            case "remove_from_queue":
                await backend.removeFromQueue(node, command.index);
                break;
            case "reorder_queue":
                backend.reorderQueue(command.from_index, command.to_index);
                break;
            case "set_volume":
                backend.setVolume(command.volume);
                break;
            case "stop":
                backend.stop();
                break;
            case "tune_radio":
                await backend.startRadio(node, command.peer_addr, command.station_id);
                break;
            case "stop_radio":
                backend.stopRadio();
                break;
            case "set_auto_download_enabled":
                backend.setAutoDownloadEnabled(command.enabled);
                break;
            case "get_status":
                break;
        }
        const status = backend.currentStatus();
        // push the same status to every other subscribed controller too - not
        // just the one that sent this command - so a shared/multi-user queue
        // stays in sync without everyone polling.
        broadcastStatus(status);
        return { type: "command_ack", ok: true, status };
    }
    finally {
        if (tracksLoading)
            setCommandInFlight(false);
    }
}

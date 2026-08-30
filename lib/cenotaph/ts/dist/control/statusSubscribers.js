// push channel: registry of open "status subscription" streams. a
// controller can dial one of these and leave it open indefinitely (distinct
// from the existing dial-per-command sessions the control protocol
// otherwise uses - see control/playerConnectionHandler.ts) to receive a
// `PlayerStatus` push the moment anything changes on the player, instead of
// polling `get_status` on an interval.
//
// wasm-only for now: the charnel/tauri native transport dials a single
// request/response invoke per command with no persistent-stream equivalent
// yet - a native controller still has to fall back to polling until that
// gets built.
const subscribers = new Map();
export function registerSubscriber(nodeId, stream) {
    let set = subscribers.get(nodeId);
    if (!set) {
        set = new Set();
        subscribers.set(nodeId, set);
    }
    set.add(stream);
}
export function unregisterSubscriber(nodeId, stream) {
    const set = subscribers.get(nodeId);
    if (!set)
        return;
    set.delete(stream);
    if (set.size === 0)
        subscribers.delete(nodeId);
}
/** pushes a status update to every currently-subscribed controller stream.
 * a write failure just drops that stream from the registry - the accept
 * loop's own read side independently notices the close and cleans up too. */
export function broadcastStatus(status) {
    if (subscribers.size === 0)
        return;
    const line = JSON.stringify(status);
    for (const [nodeId, streams] of subscribers) {
        for (const stream of streams) {
            stream.write_line(line).catch(() => {
                subscribers.get(nodeId)?.delete(stream);
            });
        }
    }
}

// generic inbound accept loop: accepts connections on any ALPN present in
// the supplied handler map and dispatches each to its registered handler.
//
// iroh-blobs connections never reach here - node.accept() handles those
// internally before returning anything to JS.
const runningNodes = new WeakSet();
/** start the inbound accept loop for `node`, dispatching by ALPN per
 * `handlers` (keyed by exact ALPN string, e.g. `PLAYER_ALPN`/`FREQHOLE_ALPN`
 * from `midden/node.ts`). safe to call once per node; no-ops on repeat
 * calls for the same node instance. */
export function startAcceptLoop(node, handlers) {
    if (runningNodes.has(node))
        return;
    runningNodes.add(node);
    void (async () => {
        for (;;) {
            const stream = await node.accept();
            if (stream === null)
                break; // endpoint closed
            const alpn = stream.alpn();
            // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
            console.log(`[debug/acceptLoop] accepted connection, alpn=${alpn}`);
            const handler = handlers[alpn];
            if (handler) {
                void handler(node, stream);
            }
            else {
                console.log("[cenotaph] ignoring connection on unhandled alpn", alpn);
                stream.close();
            }
        }
    })();
}

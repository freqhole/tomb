// builds the freqhole-player/1 connection handler: pairing handshake for
// untrusted peers, command dispatch + push-subscription sessions for
// trusted ones. parameterized by a `PlaybackBackend` so different host
// apps (player.freqhole.net's own media-element engine, spume's real
// player) can plug in their own playback implementation without forking
// this logic - see playbackBackend.ts.
import { handlePairRequest } from "../pairing/pairingHandler";
import { dispatchCommand } from "./dispatcher";
import { SubscribeRequestSchema } from "./schema";
import { registerSubscriber, unregisterSubscriber } from "./statusSubscribers";
import { markControllerConnected, markControllerDisconnected } from "./connectedControllers";
/** builds a per-connection handler for `midden/acceptLoop.ts`'s
 * `startAcceptLoop`, registered against `PLAYER_ALPN`. */
export function createPlayerConnectionHandler(options) {
    const { backend, trustStore, isEnabled } = options;
    return async function handleConnection(node, stream) {
        if (isEnabled && !isEnabled()) {
            // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
            console.log("[debug/playerConn] rejected: isEnabled() returned false");
            stream.close();
            return;
        }
        try {
            const peerNodeId = stream.peer_node_id();
            const trusted = await trustStore.isTrustedController(peerNodeId);
            // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
            console.log(`[debug/playerConn] connection from ${peerNodeId.slice(0, 12)}, trusted=${trusted}`);
            const firstLine = (await stream.read_line());
            if (firstLine === null)
                return;
            if (isPairRequestLine(firstLine)) {
                // a pair_request always goes through the pairing handshake, even
                // from an already-trusted peer: a controller that "forgot" this
                // player locally has no record of ever pairing, so it re-sends
                // pair_request on its next attempt. trustController() is an
                // upsert, so this just re-validates the pin and refreshes the
                // display_name/paired_at - it never fails just for being an
                // already-trusted node_id (previously this fell through to
                // command dispatch as an untrusted-shaped check, and dispatchCommand
                // rejected it as {ok:false, reason:"invalid_command"}).
                const response = await handlePairRequest(trustStore, peerNodeId, firstLine);
                // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
                console.log("[debug/playerConn] pair response:", response);
                await stream.write_line(JSON.stringify(response));
                // wait for the peer's clean close (EOF) before tearing down our own
                // side - closing immediately after write_line can race the QUIC
                // flush and surface as "connection lost" on the peer's read
                // (write_line has no built-in flush barrier, unlike
                // write_raw_and_finish's stopped() wait - see lib/midden/src/lib.rs).
                await stream.read_line();
                return;
            }
            if (trusted) {
                const controller = await trustStore.getTrustedController(peerNodeId);
                const connectedInfo = {
                    node_id: peerNodeId,
                    display_name: controller?.display_name ?? peerNodeId.slice(0, 8),
                };
                if (isSubscribeRequest(firstLine)) {
                    // push-subscription session: no commands are ever dispatched on
                    // this stream - just register it for statusSubscribers.
                    // broadcastStatus() pushes and wait for the controller to close
                    // it.
                    registerSubscriber(peerNodeId, stream);
                    markControllerConnected(connectedInfo);
                    try {
                        for (;;) {
                            const line = (await stream.read_line());
                            if (line === null)
                                break;
                        }
                    }
                    finally {
                        unregisterSubscriber(peerNodeId, stream);
                        markControllerDisconnected(peerNodeId);
                    }
                    return;
                }
                // control session: keep the stream open and dispatch every
                // command line sent on it, until the controller closes its side.
                markControllerConnected(connectedInfo);
                try {
                    let line = firstLine;
                    while (line !== null) {
                        const ack = await dispatchCommand(backend, node, line);
                        await stream.write_line(JSON.stringify(ack));
                        line = (await stream.read_line());
                    }
                }
                finally {
                    markControllerDisconnected(peerNodeId);
                }
                return;
            }
            // untrusted peer sent something other than a pair_request - reject
            // rather than dispatching it as a command.
            // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
            console.log("[debug/playerConn] untrusted peer sent non-pair-request:", firstLine);
            await stream.write_line(JSON.stringify({ type: "pair_response", ok: false, reason: "invalid_pin" }));
        }
        catch (err) {
            // console.error("[cenotaph] player connection handling failed:", err);
        }
        finally {
            stream.close();
        }
    };
}
function isSubscribeRequest(rawLine) {
    try {
        return SubscribeRequestSchema.safeParse(JSON.parse(rawLine)).success;
    }
    catch {
        return false;
    }
}
function isPairRequestLine(rawLine) {
    try {
        return JSON.parse(rawLine).type === "pair_request";
    }
    catch {
        return false;
    }
}

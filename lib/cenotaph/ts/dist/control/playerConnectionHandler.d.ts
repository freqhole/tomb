import type { CenotaphBiStream } from "../midden/node";
import type { TrustStore } from "../pairing/trustStore";
import type { PlaybackBackend } from "./playbackBackend";
export interface PlayerConnectionHandlerOptions<TNode = unknown> {
    backend: PlaybackBackend<TNode>;
    /** where pairing/trust state is persisted - see trustStore.ts for why
     * this is injected rather than owned by cenotaph itself. */
    trustStore: TrustStore;
    /** called once per connection attempt, before any pairing/trust handling
     * runs; return false to reject the connection outright (e.g. a host-side
     * "remote mode" toggle that's currently off) - the stream is closed
     * immediately with no pairing handshake at all. defaults to
     * always-enabled. */
    isEnabled?: () => boolean;
}
/** builds a per-connection handler for `midden/acceptLoop.ts`'s
 * `startAcceptLoop`, registered against `PLAYER_ALPN`. */
export declare function createPlayerConnectionHandler<TNode = unknown>(options: PlayerConnectionHandlerOptions<TNode>): (node: TNode, stream: CenotaphBiStream) => Promise<void>;
//# sourceMappingURL=playerConnectionHandler.d.ts.map
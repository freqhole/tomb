/** dedicated ALPN for player pairing (trust handshake) + control
 * (play/queue/etc) commands, separate from freqhole-admin/1 (which assumes
 * an already-trusted, full grimoire-admin relationship). */
export declare const PLAYER_ALPN = "freqhole-player/1";
/** midden registers this on every node by default (see
 * lib/midden/src/lib.rs) - it's the ALPN spume's regular "add remote" flow
 * probes for server info. */
export declare const FREQHOLE_ALPN = "freqhole/1";
/** the subset of midden's `BiStream` that cenotaph's own routing/pairing/
 * control logic calls directly. */
export interface CenotaphBiStream {
    alpn(): string;
    peer_node_id(): string;
    close(): void;
    read_line(): Promise<string | null>;
    write_line(line: string): Promise<void>;
    read_to_end(maxSize: number): Promise<Uint8Array | null>;
    write_raw_and_finish(data: Uint8Array): Promise<void>;
}
/** the subset of midden's `MiddenNode` that `startAcceptLoop` itself
 * calls directly - everything else (e.g. `api_request`, blob fetching) is
 * only ever used by a host app's own `PlaybackBackend` implementation,
 * which can cast to whatever concrete node type it actually has. */
export interface CenotaphAcceptableNode {
    accept(): Promise<CenotaphBiStream | null>;
}
//# sourceMappingURL=node.d.ts.map
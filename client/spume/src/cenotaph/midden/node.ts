// midden/iroh node bootstrap helpers shared by every host app that embeds
// cenotaph: the dedicated pairing/control ALPN constant, and the ALPN
// midden registers on every node by default (the one spume's regular "add
// remote" flow probes for server info).
//
// this module does NOT create a node singleton itself - each host app
// already owns its own node lifecycle (player.freqhole.net's anonymous
// per-device identity vs spume's own already-existing midden node/identity
// singleton) and should keep doing so; extra_alpns just needs `PLAYER_ALPN`
// added to whichever `MiddenNodeOptions` the host already builds.

/** dedicated ALPN for player pairing (trust handshake) + control
 * (play/queue/etc) commands, separate from freqhole-admin/1 (which assumes
 * an already-trusted, full grimoire-admin relationship). */
export const PLAYER_ALPN = "freqhole-player/1";

/** midden registers this on every node by default (see
 * lib/midden/src/lib.rs) - it's the ALPN spume's regular "add remote" flow
 * probes for server info. */
export const FREQHOLE_ALPN = "freqhole/1";

// structural (duck-typed) node/stream shapes, deliberately NOT imported
// from `@freqhole/midden`'s concrete wasm classes - cenotaph is meant to
// stay usable from a host app that doesn't have (or even need) that wasm
// package at all, e.g. a future charnel/tauri host driving a native iroh
// transport instead (see docs/cenotaph-migration-plan.md phase 4/10). any
// host's real node/stream type just needs to satisfy these shapes - midden's
// real `BiStream`/`MiddenNode` wasm classes already do, structurally, with
// no adapter needed.

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

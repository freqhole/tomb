// structural (duck-typed) node shape cenotaph's default media playback
// backend needs - deliberately NOT imported from `@freqhole/midden`'s
// concrete wasm classes, same reasoning as `midden/node.ts`'s
// `CenotaphAcceptableNode`/`CenotaphBiStream`: this package should stay
// usable from any host whose node handle satisfies this shape, not just
// one that literally imports the wasm package. midden's real `MiddenNode`
// wasm class already satisfies this structurally, with no adapter needed.

export interface MediaPlaybackNode {
  download_verified_with_ensure(peer_addr: string, blake3_hash: string): Promise<Uint8Array>;
  download_verified_with_ensure_progress?(
    peer_addr: string,
    blake3_hash: string,
    total_size: number,
    on_progress: (fraction: number) => void,
  ): Promise<Uint8Array>;
  tune_radio(
    peer_addr: string,
    station_id: string | null | undefined,
    on_hello: (json: string) => void,
    on_meta: (json: string) => void,
    on_chunk: (seq: number, is_init: boolean, bytes: Uint8Array) => void,
  ): Promise<{ leave(): void }>;
}

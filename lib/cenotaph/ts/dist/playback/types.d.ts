export interface MediaPlaybackNode {
    download_verified_with_ensure(peer_addr: string, blake3_hash: string): Promise<Uint8Array>;
    download_verified_with_ensure_progress?(peer_addr: string, blake3_hash: string, total_size: number, on_progress: (fraction: number) => void): Promise<Uint8Array>;
    tune_radio(peer_addr: string, station_id: string | null | undefined, on_hello: (json: string) => void, on_meta: (json: string) => void, on_chunk: (seq: number, is_init: boolean, bytes: Uint8Array) => void): Promise<{
        leave(): void;
    }>;
}
//# sourceMappingURL=types.d.ts.map
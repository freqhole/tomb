// types shared across the player package. mirrors `sibyl-core` rust
// structs so json from tauri events deserializes directly.

export interface CodecParams {
  sample_rate: number;
  channels: number;
  bitrate_kbps: number;
  frames_per_chunk: number;
}

export const MP3_DEFAULT: CodecParams = {
  sample_rate: 44_100,
  channels: 2,
  bitrate_kbps: 192,
  frames_per_chunk: 40,
};

export interface ChunkRecord {
  seq: number;
  bytes: Uint8Array;
  frame_count: number;
  /** present on the very first chunk of a peer download — carries
   * the total chunk count in the source collection so the manifest
   * can show real progress percentages. undefined for host-emitted
   * chunks (count not yet known). */
  chunks_total?: number;
}

export interface Manifest {
  song_id: string;
  params: CodecParams;
  chunks_have: number[];   // seqs already on disk
  chunks_total?: number;   // null until host signals completion
  title?: string;
  created_at: number;
  /** the original sibyl ticket string this song was downloaded from.
   * persisted so the cached-songs ui can offer a "copy ticket" /
   * re-share action without forcing the user to keep the original
   * around. populated on first `loadFromTicket`. */
  ticket?: string;
}

export interface CachedSong {
  song_id: string;
  title?: string;
  bytes: number;
  chunk_count: number;
  manifest: Manifest;
}

//! sibyl-specific additions to midden. **all sibyl-only changes go
//! in this file** so a `diff client/sibyl/midden-rs client/midden`
//! shows only new files. when ready to merge upstream, copy this
//! file into canonical midden untouched.
//!
//! exports a chunk-streaming wrapper that adapts midden's existing
//! `download_verified_streaming` shape to the `ChunkTransport`
//! contract from `@sibyl/player`.

// todo (phase 4): wasm_bindgen exports here. left empty intentionally
// — phase 4 fills in:
//
//   #[wasm_bindgen]
//   pub async fn sibyl_download_chunks(
//       peer_addr: String,
//       collection_hash: String,
//       on_chunk: js_sys::Function,
//   ) -> Result<JsValue, JsValue> { ... }
//
// kept as a separate file from canonical midden's lib.rs so the
// merge-back diff stays trivial.

//! web shell — wasm/browser entry point for rathole.
//!
//! m0 spike: renders the admin palette ui in a browser tab via
//! ratzilla's DOM backend, with a hardcoded fake command list and
//! a `NoopTransport` that returns a "not connected" response on
//! enter. proves: ratcore + ratatui compile to wasm and render.
//!
//! next steps (not in m0):
//! - wire `MiddenTransport` (calls into skein/midden via wasm-bindgen)
//!   for real iroh-p2p admin dispatch
//! - localStorage-backed persist
//! - audio via `<audio>` / WebAudio

mod identity;
mod run;
mod transport;

pub use run::boot;
pub use transport::{MiddenTransport, NoopTransport};

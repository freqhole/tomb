//! authentication module
//!
//! handles all authentication methods:
//! - webauthn (feature-gated; drives grimoire's `webauthn_ceremony` module)
//! - api keys
//! - invite codes

pub mod cookie;
pub mod handlers;
pub mod helpers;
pub mod middleware;
pub mod session;

// freq_webauthn submodule only exists if feature is enabled
#[cfg(feature = "webauthn")]
pub mod freq_webauthn;

// re-export public types
pub use handlers::*;
pub use helpers::*;
pub use middleware::*;
pub use session::*;

//! authentication module
//!
//! handles all authentication methods:
//! - webauthn (feature-gated, isolated to webauthn.rs)
//! - api keys
//! - invite codes
//!
//! **critical**: webauthn-rs types are isolated to the webauthn submodule only!
//! no webauthn-rs types should leak into other modules.

pub mod handlers;
pub mod middleware;
pub mod session;

// freq_webauthn submodule only exists if feature is enabled
// keeps webauthn-rs types completely isolated
#[cfg(feature = "webauthn")]
pub mod freq_webauthn;

// re-export public types
pub use handlers::*;
pub use middleware::*;
pub use session::*;

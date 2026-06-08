//! process shutdown registry
//!
//! lets a host binary (e.g. the cli `serve` server) register a graceful
//! shutdown trigger. `admin_dispatch::server_restart` calls into here.
//!
//! binaries that have their own restart story (the tauri app) simply do
//! not register a hook — `request_shutdown` then returns `false` and the
//! caller can surface a "not supported here" error.
//!
//! the registry is process-global and one-shot (first hook wins). the
//! callback receives a human-readable reason for logging.

use std::sync::OnceLock;

type ShutdownHook = Box<dyn Fn(String) + Send + Sync + 'static>;

static SHUTDOWN_HOOK: OnceLock<ShutdownHook> = OnceLock::new();

/// register a shutdown hook for the current process.
///
/// returns `Err(())` if a hook is already registered. the hook is invoked
/// from `request_shutdown` and should be cheap and non-blocking — it
/// typically just sends on a oneshot.
#[allow(clippy::result_unit_err)]
pub fn register_shutdown_hook<F>(hook: F) -> Result<(), ()>
where
    F: Fn(String) + Send + Sync + 'static,
{
    SHUTDOWN_HOOK.set(Box::new(hook)).map_err(|_| ())
}

/// trigger graceful shutdown via the registered hook.
///
/// returns `true` if a hook was registered (and therefore invoked) and
/// `false` otherwise. callers should treat `false` as an unsupported
/// operation on this binary.
pub fn request_shutdown(reason: impl Into<String>) -> bool {
    match SHUTDOWN_HOOK.get() {
        Some(hook) => {
            hook(reason.into());
            true
        }
        None => false,
    }
}

/// is a shutdown hook currently registered?
pub fn is_registered() -> bool {
    SHUTDOWN_HOOK.get().is_some()
}

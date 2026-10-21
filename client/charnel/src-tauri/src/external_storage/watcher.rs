//! forwards shared OS device/mount notifications to the removable sync UI.

use std::sync::Once;
use tauri::AppHandle;

static START: Once = Once::new();

/// starts forwarding once sync devices are configured; grimoire owns the shared
/// process-lifetime OS listener, also used by library-source reconciliation.
pub fn ensure_started(app_handle: AppHandle) {
    START.call_once(|| {
        let mut events = match grimoire::external_storage::events::subscribe() {
            Ok(events) => events,
            Err(error) if error.kind() == std::io::ErrorKind::Unsupported => {
                tracing::debug!(%error, "removable sync notifications unavailable");
                return;
            }
            Err(error) => {
                tracing::error!(%error, "could not subscribe to removable sync notifications");
                return;
            }
        };
        tauri::async_runtime::spawn(async move {
            loop {
                // refresh once after subscribing too: the shared listener may
                // already have observed a mount before this UI subscribed.
                if let Err(error) =
                    crate::spume_bridge::notify_external_storage_mounted_changed(&app_handle)
                {
                    tracing::warn!(%error, "could not forward removable storage change");
                }
                if events.changed().await.is_err() {
                    tracing::error!("removable sync notification channel closed");
                    return;
                }
            }
        });
    });
}

//! shared process-lifetime OS storage notifications. subscribers re-read state;
//! notifications are hints, never evidence that a volume is mounted or absent.

use std::{io, sync::OnceLock};
use tokio::sync::watch;

#[cfg(target_os = "linux")]
#[path = "events/linux.rs"]
mod platform;
#[cfg(target_os = "windows")]
#[path = "events/windows.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "events/macos.rs"]
mod platform;

static EVENTS: OnceLock<Result<watch::Sender<u64>, String>> = OnceLock::new();

/// subscribes before probing to avoid losing changes during the initial snapshot.
/// one blocking OS listener is shared by source reconciliation and sync UI.
pub fn subscribe() -> io::Result<watch::Receiver<u64>> {
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        let sender = EVENTS.get_or_init(|| {
            let (sender, _) = watch::channel(0);
            let notifications = sender.clone();
            std::thread::Builder::new()
                .name("storage-events".into())
                .spawn(move || {
                    let mut failures = 0u32;
                    loop {
                        let error = platform::listen(&notifications)
                            .err()
                            .unwrap_or_else(|| io::Error::other("storage OS listener stopped"));
                        failures = (failures + 1).min(5);
                        let seconds = (1u64 << failures).min(30);
                        tracing::warn!(%error, seconds, "storage OS listener failed; retrying");
                        std::thread::sleep(std::time::Duration::from_secs(seconds));
                    }
                })
                .map_err(|error| error.to_string())?;
            Ok(sender)
        });
        sender
            .as_ref()
            .map(watch::Sender::subscribe)
            .map_err(|error| io::Error::other(error.clone()))
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "storage notifications are not supported on this platform",
    ))
}

fn changed(sender: &watch::Sender<u64>) {
    sender.send_modify(|revision| *revision = revision.wrapping_add(1));
}

/// also wake subscribers after source/sync configuration changes in this process.
pub(crate) fn notify_changed() {
    if let Some(Ok(sender)) = EVENTS.get() {
        changed(sender);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    #[tokio::test]
    async fn subscribers_share_configuration_changes() {
        let mut first = subscribe().unwrap();
        let mut second = subscribe().unwrap();
        first.borrow_and_update();
        second.borrow_and_update();
        notify_changed();
        assert!(first.has_changed().unwrap());
        assert!(second.has_changed().unwrap());
        second.borrow_and_update();
        drop(first);
        notify_changed();
        assert!(second.has_changed().unwrap());
    }

    #[tokio::test]
    async fn broadcasts_and_coalesces_without_requiring_a_subscriber() {
        let (sender, _) = watch::channel(0);
        changed(&sender);
        let mut first = sender.subscribe();
        let mut second = sender.subscribe();
        assert!(!first.has_changed().unwrap());
        changed(&sender);
        changed(&sender);
        first.changed().await.unwrap();
        second.changed().await.unwrap();
        assert_eq!(*first.borrow_and_update(), 3);
        assert_eq!(*second.borrow_and_update(), 3);
        assert!(!first.has_changed().unwrap());
    }
}

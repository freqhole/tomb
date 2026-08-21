//! event-driven watcher for removable-storage mount/unmount changes.
//!
//! replaces js-side polling: a rust background thread (macos:
//! DiskArbitration, linux: udev) emits the `external_storage_mounted_changed`
//! tauri event whenever a disk appears/disappears, and the frontend just
//! listens instead of calling `list_mounted` on a timer.
//!
//! only ever started via `ensure_started`, and only once the user has
//! configured at least one removable storage device - no reason to run a
//! background watcher thread for users who never touch this feature.

use std::sync::Once;

use tauri::AppHandle;

static START: Once = Once::new();

/// starts the platform mount-watcher thread at most once per process.
/// safe to call from multiple sites (app startup, `add_device`) - only
/// the first call after a device becomes configured actually spawns it.
pub fn ensure_started(app_handle: AppHandle) {
    START.call_once(|| {
        platform::spawn(app_handle);
    });
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::c_void;
    use std::ptr::NonNull;

    use objc2_core_foundation::{kCFRunLoopDefaultMode, CFRunLoop};
    use objc2_disk_arbitration::{
        DADisk, DARegisterDiskAppearedCallback, DARegisterDiskDisappearedCallback, DASession,
    };
    use tauri::{AppHandle, Emitter};

    pub fn spawn(app_handle: AppHandle) {
        std::thread::spawn(move || {
            // leaked deliberately - this thread (and its callbacks) run for
            // the rest of the process's life, so the context outlives them.
            let context = Box::into_raw(Box::new(app_handle)) as *mut c_void;
            unsafe {
                let Some(session) = DASession::new(None) else {
                    tracing::warn!(
                        "removable-storage watcher: failed to create DiskArbitration session"
                    );
                    return;
                };
                DARegisterDiskAppearedCallback(&session, None, Some(disk_changed), context);
                DARegisterDiskDisappearedCallback(&session, None, Some(disk_changed), context);
                let Some(run_loop) = CFRunLoop::current() else {
                    tracing::warn!("removable-storage watcher: failed to get current CFRunLoop");
                    return;
                };
                let Some(mode) = kCFRunLoopDefaultMode else {
                    tracing::warn!("removable-storage watcher: kCFRunLoopDefaultMode unavailable");
                    return;
                };
                session.schedule_with_run_loop(&run_loop, mode);
            }
            // blocks this thread forever, dispatching DA callbacks as they fire.
            CFRunLoop::run();
        });
    }

    unsafe extern "C-unwind" fn disk_changed(_disk: NonNull<DADisk>, context: *mut c_void) {
        let app_handle = unsafe { &*(context as *const AppHandle) };
        let _ = app_handle.emit("external_storage_mounted_changed", ());
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use std::os::unix::io::AsRawFd;

    use tauri::{AppHandle, Emitter};

    pub fn spawn(app_handle: AppHandle) {
        std::thread::spawn(move || {
            let Ok(builder) = udev::MonitorBuilder::new() else {
                tracing::warn!("removable-storage watcher: failed to create udev monitor");
                return;
            };
            let Ok(builder) = builder.match_subsystem_devtype("block", "disk") else {
                tracing::warn!("removable-storage watcher: failed to filter udev monitor");
                return;
            };
            let Ok(socket) = builder.listen() else {
                tracing::warn!("removable-storage watcher: failed to listen on udev monitor");
                return;
            };

            let fd = socket.as_raw_fd();
            loop {
                let mut pollfd = libc::pollfd {
                    fd,
                    events: libc::POLLIN,
                    revents: 0,
                };
                // block until the udev socket has something to read.
                let ret = unsafe { libc::poll(&mut pollfd, 1, -1) };
                if ret < 0 {
                    tracing::warn!("removable-storage watcher: poll() failed, stopping");
                    return;
                }
                for _event in socket.iter() {
                    let _ = app_handle.emit("external_storage_mounted_changed", ());
                }
            }
        });
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use tauri::AppHandle;

    /// no watcher implementation yet for windows/mobile - `disk_usage`
    /// still works, only the auto-refresh event is unavailable there.
    pub fn spawn(_app_handle: AppHandle) {}
}

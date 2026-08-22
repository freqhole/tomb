//! removable/mounted storage device helpers (tauri desktop only).
//!
//! see docs/removable-storage-sync-plan.md. this module only covers
//! "does this path still look like a mounted device" - the actual music
//! copy engine (phase 2+ of the plan) lives elsewhere once it exists.
//! the tauri command surface lives in the `commands` submodule.

pub mod commands;
pub mod copy_engine;
pub mod path_naming;
pub mod playlist_sync;
pub mod watcher;

use crate::app_config::ExternalStorageDevice;

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
mod desktop {
    #[cfg(target_os = "windows")]
    use std::path::Path;
    use std::process::Command;

    /// best-effort volume name/uuid for a mount path. failures are
    /// non-fatal - the device is still usable by path alone, this is
    /// just extra info to help re-recognize it later.
    pub fn resolve_volume_info(path: &str) -> (Option<String>, Option<String>) {
        #[cfg(target_os = "macos")]
        {
            macos_volume_info(path)
        }
        #[cfg(target_os = "linux")]
        {
            linux_volume_info(path)
        }
        #[cfg(target_os = "windows")]
        {
            windows_volume_info(path)
        }
    }

    #[cfg(target_os = "macos")]
    fn macos_volume_info(path: &str) -> (Option<String>, Option<String>) {
        // `diskutil info <path>` prints lines like:
        //   Volume Name:               MY_USB
        //   Volume UUID:               1234-5678
        let Ok(output) = Command::new("diskutil").arg("info").arg(path).output() else {
            return (None, None);
        };
        if !output.status.success() {
            return (None, None);
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut name = None;
        let mut uuid = None;
        for line in text.lines() {
            if let Some(rest) = line.trim().strip_prefix("Volume Name:") {
                let value = rest.trim();
                if !value.is_empty() {
                    name = Some(value.to_string());
                }
            } else if let Some(rest) = line.trim().strip_prefix("Volume UUID:") {
                let value = rest.trim();
                if !value.is_empty() {
                    uuid = Some(value.to_string());
                }
            }
        }
        (name, uuid)
    }

    #[cfg(target_os = "linux")]
    fn linux_volume_info(path: &str) -> (Option<String>, Option<String>) {
        // `findmnt` reports the source device + fs uuid for whatever's
        // mounted at (or above) `path`.
        let Ok(output) = Command::new("findmnt")
            .args(["-T", path, "-no", "SOURCE,UUID", "-J"])
            .output()
        else {
            return (None, None);
        };
        if !output.status.success() {
            return (None, None);
        }
        let text = String::from_utf8_lossy(&output.stdout);
        // not JSON despite `-J` name conflict with our flag ordering in
        // some findmnt versions - fall back to plain whitespace split.
        let mut parts = text.split_whitespace();
        let source = parts.next().map(|s| s.to_string());
        let uuid = parts.next().map(|s| s.to_string());
        (source, uuid)
    }

    #[cfg(target_os = "windows")]
    fn windows_volume_info(path: &str) -> (Option<String>, Option<String>) {
        // resolve the drive letter (e.g. "E:") and query its volume
        // label + serial number via `vol`.
        let drive = Path::new(path)
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str())
            .map(|s| s.to_string());
        let Some(drive) = drive else {
            return (None, None);
        };
        let Ok(output) = Command::new("cmd").args(["/C", "vol", &drive]).output() else {
            return (None, None);
        };
        if !output.status.success() {
            return (None, None);
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut name = None;
        let mut uuid = None;
        for line in text.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("Volume in drive") {
                // "Volume in drive E is MY_USB"
                if let Some((_, label)) = rest.rsplit_once(" is ") {
                    let label = label.trim();
                    if !label.is_empty() {
                        name = Some(label.to_string());
                    }
                }
            } else if let Some(rest) = line.strip_prefix("Volume Serial Number is") {
                let value = rest.trim();
                if !value.is_empty() {
                    uuid = Some(value.to_string());
                }
            }
        }
        (name, uuid)
    }

    /// best-effort unmount/eject of the device mounted at `path`.
    pub fn eject_device(path: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            macos_eject(path)
        }
        #[cfg(target_os = "linux")]
        {
            linux_eject(path)
        }
        #[cfg(target_os = "windows")]
        {
            windows_eject(path)
        }
    }

    #[cfg(target_os = "macos")]
    fn macos_eject(path: &str) -> Result<(), String> {
        let output = Command::new("diskutil")
            .arg("eject")
            .arg(path)
            .output()
            .map_err(|e| format!("failed to run diskutil eject: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }

    #[cfg(target_os = "linux")]
    fn linux_eject(path: &str) -> Result<(), String> {
        // udisksctl needs the block device, not the mount path.
        let source = Command::new("findmnt")
            .args(["-T", path, "-no", "SOURCE"])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

        if let Some(device) = source.filter(|s| !s.is_empty()) {
            let output = Command::new("udisksctl")
                .args(["unmount", "-b", &device])
                .output()
                .map_err(|e| format!("failed to run udisksctl unmount: {e}"))?;
            if output.status.success() {
                return Ok(());
            }
            // fall through to a plain umount attempt below
        }

        let output = Command::new("umount")
            .arg(path)
            .output()
            .map_err(|e| format!("failed to run umount: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }

    #[cfg(target_os = "windows")]
    fn windows_eject(_path: &str) -> Result<(), String> {
        // no reliable single built-in cli command for a clean windows
        // eject; punting for now rather than shelling out to a
        // powershell one-liner that's easy to get subtly wrong.
        Err("eject is not yet supported on windows".to_string())
    }

    /// best-effort (total_bytes, free_bytes) for the filesystem containing
    /// `path`.
    pub fn disk_usage(path: &str) -> Option<(u64, u64)> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            unix_disk_usage(path)
        }
        #[cfg(target_os = "windows")]
        {
            windows_disk_usage(path)
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn unix_disk_usage(path: &str) -> Option<(u64, u64)> {
        // `df -k <path>` prints a header line then one data line:
        //   Filesystem    1024-blocks      Used Available Capacity Mounted on
        //   /dev/disk4s1      61067384  12345678  47654321      21%  /Volumes/MY_USB
        let output = Command::new("df").args(["-k", path]).output().ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let data_line = text.lines().nth(1)?;
        let mut fields = data_line.split_whitespace();
        let _filesystem = fields.next()?;
        let total_kb: u64 = fields.next()?.parse().ok()?;
        let _used_kb: u64 = fields.next()?.parse().ok()?;
        let avail_kb: u64 = fields.next()?.parse().ok()?;
        Some((total_kb * 1024, avail_kb * 1024))
    }

    #[cfg(target_os = "windows")]
    fn windows_disk_usage(path: &str) -> Option<(u64, u64)> {
        // `fsutil volume diskfree <drive>` prints lines like:
        //   Total # of free bytes        : 123456789
        //   Total # of bytes             : 987654321
        //   Total # of avail free bytes  : 123456789
        let drive = Path::new(path)
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str())
            .map(|s| s.to_string())?;
        let output = Command::new("cmd")
            .args(["/C", "fsutil", "volume", "diskfree", &drive])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let mut total = None;
        let mut free = None;
        for line in text.lines() {
            let Some((label, value)) = line.split_once(':') else {
                continue;
            };
            let label = label.trim();
            let Ok(value) = value.trim().parse::<u64>() else {
                continue;
            };
            if label.starts_with("Total # of bytes") {
                total = Some(value);
            } else if label.starts_with("Total # of avail free bytes") {
                free = Some(value);
            }
        }
        Some((total?, free?))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
mod desktop {
    /// mobile targets never resolve device info - the feature is desktop-
    /// only end to end (folder picker is also disabled there).
    pub fn resolve_volume_info(_path: &str) -> (Option<String>, Option<String>) {
        (None, None)
    }

    pub fn eject_device(_path: &str) -> Result<(), String> {
        Err("removable storage sync is desktop-only".to_string())
    }

    pub fn disk_usage(_path: &str) -> Option<(u64, u64)> {
        None
    }
}

pub use desktop::{disk_usage, eject_device, resolve_volume_info};

/// does the configured device still look mounted/present? checked by
/// path existence, refined by a re-check of the volume uuid when we
/// have one (catches "a different drive got remounted at the same path"
/// on platforms that reuse mount points, e.g. linux's /media/<label>).
pub fn is_still_mounted(device: &ExternalStorageDevice) -> bool {
    let path = std::path::Path::new(&device.path);
    if !path.exists() || !path.is_dir() {
        return false;
    }
    let Some(expected_uuid) = &device.volume_uuid else {
        return true;
    };
    let (_, current_uuid) = resolve_volume_info(&device.path);
    match current_uuid {
        Some(current) => &current == expected_uuid,
        // couldn't re-resolve (e.g. tool missing) - don't flip-flop the
        // ui to "unmounted" just because we can't confirm the uuid.
        None => true,
    }
}

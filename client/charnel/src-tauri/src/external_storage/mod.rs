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
    ///
    /// both values are sanitized before they escape this module: they end
    /// up in the ui and in filesystem paths, and a platform probe that
    /// misbehaves (or gets pointed at an unexpected tool version) can
    /// otherwise hand back raw command output.
    pub fn resolve_volume_info(path: &str) -> (Option<String>, Option<String>) {
        let (name, uuid) = raw_volume_info(path);
        (
            name.as_deref().and_then(sanitize_volume_name),
            uuid.as_deref().and_then(sanitize_volume_uuid),
        )
    }

    /// keep letters, digits, spaces and the few separators that show up in
    /// real volume labels; everything else becomes a space, runs collapse,
    /// and the result is length-capped. returns `None` if nothing usable is
    /// left, so callers fall back to the mount path instead of showing junk.
    fn sanitize_volume_name(raw: &str) -> Option<String> {
        let cleaned: String = raw
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_') {
                    c
                } else {
                    ' '
                }
            })
            .collect();
        let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
        if collapsed.is_empty() {
            return None;
        }
        Some(collapsed.chars().take(64).collect())
    }

    /// uuids are hex + dashes (fat/exfat use short `1234-ABCD` forms).
    /// anything else means the probe returned something that isn't a uuid.
    fn sanitize_volume_uuid(raw: &str) -> Option<String> {
        let trimmed = raw.trim();
        if trimmed.is_empty()
            || trimmed.len() > 64
            || !trimmed
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return None;
        }
        Some(trimmed.to_string())
    }

    fn raw_volume_info(path: &str) -> (Option<String>, Option<String>) {
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
        // deliberately no subprocess: `findmnt`/`lsblk` (util-linux) are not
        // present in the gnome flatpak runtime, and the previous
        // `findmnt -J` call combined json output with a whitespace split,
        // which is where the json blob in the volume name came from.
        let Some((source, mount_point)) = super::linux_mounts::mount_for_path(path) else {
            return (None, None);
        };
        let uuid = super::linux_mounts::lookup_by_link("/dev/disk/by-uuid", &source);
        let label = super::linux_mounts::lookup_by_link("/dev/disk/by-label", &source)
            // udisks/gvfs mount removable media at /run/media/<user>/<label>
            // (or /media/<label>), so the basename is the label when
            // /dev/disk/by-label isn't visible (e.g. inside a sandbox).
            .or_else(|| {
                mount_point
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string())
            });
        (label, uuid)
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
        // none of these are guaranteed to exist: udisksctl (udisks2) and gio
        // (glib) are absent from minimal installs, and inside a flatpak
        // sandbox essentially none of them are - so every candidate is tried
        // in turn and a missing binary is not treated as a failure. inside
        // flatpak the same commands are re-tried on the host via
        // flatpak-spawn, which is the only way to reach udisks/gio at all.
        let device = super::linux_mounts::mount_for_path(path).map(|(source, _)| source);

        let mut attempts: Vec<(&str, Vec<String>)> = Vec::new();
        if let Some(device) = device.as_deref() {
            attempts.push((
                "udisksctl",
                vec!["unmount".into(), "-b".into(), device.to_string()],
            ));
        }
        attempts.push(("gio", vec!["mount".into(), "-u".into(), path.to_string()]));
        attempts.push((
            "udisksctl",
            vec!["unmount".into(), "-p".into(), path.into()],
        ));
        attempts.push(("umount", vec![path.to_string()]));

        let in_flatpak = std::env::var_os("FLATPAK_ID").is_some();
        let mut errors: Vec<String> = Vec::new();
        let mut missing: Vec<&str> = Vec::new();

        for (program, args) in &attempts {
            match run_eject_candidate(program, args, false) {
                EjectAttempt::Ok => return Ok(()),
                EjectAttempt::Failed(err) => errors.push(format!("{program}: {err}")),
                EjectAttempt::Missing => {
                    if in_flatpak {
                        match run_eject_candidate(program, args, true) {
                            EjectAttempt::Ok => return Ok(()),
                            EjectAttempt::Failed(err) => {
                                errors.push(format!("host {program}: {err}"))
                            }
                            EjectAttempt::Missing => missing.push(program),
                        }
                    } else {
                        missing.push(program);
                    }
                }
            }
        }

        if errors.is_empty() {
            missing.sort_unstable();
            missing.dedup();
            return Err(format!(
                "no supported eject tool found (tried {}). install udisks2 or glib's gio, or unmount the drive from your file manager.",
                missing.join(", ")
            ));
        }
        Err(errors.join("; "))
    }

    #[cfg(target_os = "linux")]
    enum EjectAttempt {
        Ok,
        Failed(String),
        /// the program isn't installed (or isn't reachable from the sandbox)
        Missing,
    }

    #[cfg(target_os = "linux")]
    fn run_eject_candidate(program: &str, args: &[String], via_host: bool) -> EjectAttempt {
        let mut command = if via_host {
            let mut c = Command::new("flatpak-spawn");
            c.arg("--host").arg(program);
            c
        } else {
            Command::new(program)
        };
        command.args(args);

        match command.output() {
            Ok(output) if output.status.success() => EjectAttempt::Ok,
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                // flatpak-spawn exits 127 when the host command is missing
                if via_host && output.status.code() == Some(127) {
                    return EjectAttempt::Missing;
                }
                EjectAttempt::Failed(if stderr.is_empty() {
                    format!("exited with {}", output.status)
                } else {
                    stderr
                })
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => EjectAttempt::Missing,
            Err(e) => EjectAttempt::Failed(e.to_string()),
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
        // statvfs directly instead of parsing `df` output - `df` field order
        // differs between coreutils/busybox and isn't guaranteed present in
        // a flatpak runtime.
        let stat = nix::sys::statvfs::statvfs(path).ok()?;
        // widths differ per platform (u32 on macOS, u64 on linux)
        let block_size = if stat.fragment_size() > 0 {
            stat.fragment_size() as u64
        } else {
            stat.block_size() as u64
        };
        let total = (stat.blocks() as u64).checked_mul(block_size)?;
        let free = (stat.blocks_available() as u64).checked_mul(block_size)?;
        Some((total, free))
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

/// linux mount-table helpers, read straight from /proc - no external tools,
/// so these keep working inside a flatpak sandbox (where util-linux and
/// udisks are absent) and on minimal installs.
#[cfg(target_os = "linux")]
mod linux_mounts {
    use std::path::PathBuf;

    /// `(source_device, mount_point)` for the deepest mount point that
    /// contains `path`.
    pub fn mount_for_path(path: &str) -> Option<(String, PathBuf)> {
        let target = std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
        let table = std::fs::read_to_string("/proc/mounts").ok()?;
        let mut best: Option<(String, PathBuf)> = None;
        for line in table.lines() {
            let mut fields = line.split_whitespace();
            let (Some(source), Some(mount_point)) = (fields.next(), fields.next()) else {
                continue;
            };
            let mount_point = PathBuf::from(unescape_mount_field(mount_point));
            if !target.starts_with(&mount_point) {
                continue;
            }
            let deeper = best.as_ref().is_none_or(|(_, best_mp)| {
                mount_point.components().count() > best_mp.components().count()
            });
            if deeper {
                best = Some((unescape_mount_field(source), mount_point));
            }
        }
        best
    }

    /// is anything currently mounted exactly at `path`?
    pub fn is_mount_point(path: &str) -> bool {
        let target = std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
        let Ok(table) = std::fs::read_to_string("/proc/mounts") else {
            return false;
        };
        table.lines().any(|line| {
            line.split_whitespace()
                .nth(1)
                .map(|mp| PathBuf::from(unescape_mount_field(mp)) == target)
                .unwrap_or(false)
        })
    }

    /// a path under a removable-media root (`/media`, `/run/media`, `/mnt`)
    /// that still exists but is no longer backed by a mount - i.e. the empty
    /// directory left behind after the drive was unmounted.
    ///
    /// deliberately narrow: a sync target that's just a folder on the
    /// internal disk is not a mount point either, and must not be reported
    /// as unmounted.
    pub fn is_stale_media_mount_point(path: &str) -> bool {
        let under_media_root = ["/media/", "/run/media/", "/mnt/"]
            .iter()
            .any(|root| path.starts_with(root));
        if !under_media_root {
            return false;
        }
        // still mounted if the deepest mount containing the path is itself
        // one of those media directories rather than the root filesystem.
        match mount_for_path(path) {
            Some((_, mount_point)) => {
                let mp = mount_point.to_string_lossy();
                !(mp.starts_with("/media/")
                    || mp.starts_with("/run/media/")
                    || mp.starts_with("/mnt/"))
            }
            None => true,
        }
    }

    /// find the entry in a `/dev/disk/by-*` directory whose symlink resolves
    /// to `device`, returning the (decoded) entry name - i.e. the label or
    /// uuid for that block device.
    pub fn lookup_by_link(dir: &str, device: &str) -> Option<String> {
        let device = std::fs::canonicalize(device).ok()?;
        for entry in std::fs::read_dir(dir).ok()?.flatten() {
            if std::fs::canonicalize(entry.path()).ok()? == device {
                return entry
                    .file_name()
                    .to_str()
                    .map(|name| decode_hex_escapes(name));
            }
        }
        None
    }

    /// /proc/mounts octal-escapes spaces, tabs, newlines and backslashes.
    fn unescape_mount_field(raw: &str) -> String {
        let mut out = String::with_capacity(raw.len());
        let mut chars = raw.chars();
        while let Some(c) = chars.next() {
            if c != '\\' {
                out.push(c);
                continue;
            }
            let digits: String = chars.clone().take(3).collect();
            match u8::from_str_radix(&digits, 8) {
                Ok(byte) if digits.len() == 3 => {
                    out.push(byte as char);
                    for _ in 0..3 {
                        chars.next();
                    }
                }
                _ => out.push(c),
            }
        }
        out
    }

    /// udev escapes non-alphanumerics in /dev/disk/by-label names as `\x20`.
    fn decode_hex_escapes(raw: &str) -> String {
        let mut out = String::with_capacity(raw.len());
        let mut chars = raw.chars().peekable();
        while let Some(c) = chars.next() {
            if c != '\\' || chars.peek() != Some(&'x') {
                out.push(c);
                continue;
            }
            let mut lookahead = chars.clone();
            lookahead.next(); // 'x'
            let digits: String = lookahead.take(2).collect();
            match u8::from_str_radix(&digits, 16) {
                Ok(byte) if digits.len() == 2 => {
                    out.push(byte as char);
                    for _ in 0..3 {
                        chars.next();
                    }
                }
                _ => out.push(c),
            }
        }
        out
    }
}

/// does the configured device still look mounted/present? checked by
/// path existence, refined by a re-check of the volume uuid when we
/// have one (catches "a different drive got remounted at the same path"
/// on platforms that reuse mount points, e.g. linux's /media/<label>).
pub fn is_still_mounted(device: &ExternalStorageDevice) -> bool {
    let path = std::path::Path::new(&device.path);
    if !path.exists() || !path.is_dir() {
        return false;
    }
    // on linux the mount point directory usually survives the unmount (an
    // empty /run/media/<user>/<label> left behind), so path existence alone
    // reports a removed drive as still mounted - ask the kernel's mount
    // table instead.
    #[cfg(target_os = "linux")]
    if linux_mounts::is_stale_media_mount_point(&device.path) {
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

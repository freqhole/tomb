//! mount helpers shared by desktop sync and library source registration.

use std::{
    io,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct Mount {
    pub device: String,
    pub path: PathBuf,
}

pub fn read_mounts() -> io::Result<Vec<Mount>> {
    #[cfg(target_os = "linux")]
    return parse_mounts(&std::fs::read_to_string("/proc/self/mounts")?);
    #[cfg(target_os = "macos")]
    return read_macos_mounts();
    #[cfg(target_os = "windows")]
    return super::windows::read_mounts();
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "mount inventory requires Linux, macOS or Windows",
    ))
}

pub(super) fn matches_device(mount: &Mount, device: &str) -> io::Result<bool> {
    #[cfg(target_os = "windows")]
    return super::windows::mount_matches(mount, device);
    #[cfg(not(target_os = "windows"))]
    Ok(std::fs::canonicalize(&mount.device)? == std::fs::canonicalize(device)?)
}

#[cfg(target_os = "macos")]
fn read_macos_mounts() -> io::Result<Vec<Mount>> {
    use std::ffi::CStr;
    // getfsstat copies into caller-owned memory, unlike getmntinfo's shared
    // process buffer. a full buffer means mounts changed; never accept truncation.
    let count = unsafe { libc::getfsstat(std::ptr::null_mut(), 0, libc::MNT_NOWAIT) };
    if count < 0 {
        return Err(io::Error::last_os_error());
    }
    let capacity = count as usize + 8;
    let mut records: Vec<libc::statfs> = (0..capacity)
        .map(|_| unsafe { std::mem::zeroed() })
        .collect();
    let bytes = (records.len() * std::mem::size_of::<libc::statfs>())
        .try_into()
        .map_err(|_| io::Error::other("mount table is too large"))?;
    let count = unsafe { libc::getfsstat(records.as_mut_ptr(), bytes, libc::MNT_NOWAIT) };
    if count < 0 {
        return Err(io::Error::last_os_error());
    }
    if count as usize >= capacity {
        return Err(io::Error::other("mount table changed during probe"));
    }
    records
        .iter()
        .take(count as usize)
        .map(|record| {
            let field = |chars: &[libc::c_char]| {
                // both fields are fixed-width C strings supplied by getfsstat.
                if !chars.contains(&0) {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "unterminated mount field",
                    ));
                }
                unsafe { CStr::from_ptr(chars.as_ptr()) }
                    .to_str()
                    .map(str::to_owned)
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
            };
            Ok(Mount {
                device: field(&record.f_mntfromname)?,
                path: PathBuf::from(field(&record.f_mntonname)?),
            })
        })
        .collect()
}

#[cfg(any(target_os = "linux", test))]
fn parse_mounts(table: &str) -> io::Result<Vec<Mount>> {
    table
        .lines()
        .map(|line| {
            let mut fields = line.split_whitespace();
            let (Some(device), Some(path)) = (fields.next(), fields.next()) else {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "invalid mount table entry",
                ));
            };
            Ok(Mount {
                device: unescape_mount_field(device),
                path: PathBuf::from(unescape_mount_field(path)),
            })
        })
        .collect()
}

pub fn deepest_mount<'a>(mounts: &'a [Mount], path: &Path) -> Option<&'a Mount> {
    mounts
        .iter()
        .filter(|mount| path.starts_with(&mount.path))
        .max_by_key(|mount| mount.path.components().count())
}

/// best-effort compatibility surface for desktop sync's volume metadata.
pub fn mount_for_path(path: &str) -> Option<(String, PathBuf)> {
    let target = std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
    let mounts = read_mounts().ok()?;
    let mount = deepest_mount(&mounts, &target)?;
    Some((mount.device.clone(), mount.path.clone()))
}

pub fn is_stale_media_mount_point(path: &str) -> bool {
    let media_roots = ["/media/", "/run/media/", "/mnt/"];
    if !media_roots.iter().any(|root| path.starts_with(root)) {
        return false;
    }
    match mount_for_path(path) {
        Some((_, mount_point)) => {
            let mount_point = mount_point.to_string_lossy();
            !media_roots.iter().any(|root| mount_point.starts_with(root))
        }
        None => true,
    }
}

pub fn lookup_by_link(dir: &str, device: &str) -> Option<String> {
    let device = std::fs::canonicalize(device).ok()?;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        // one stale link must not hide the remaining labels/UUIDs.
        if std::fs::canonicalize(entry.path()).ok().as_ref() == Some(&device) {
            return entry.file_name().to_str().map(decode_hex_escapes);
        }
    }
    None
}

#[cfg(any(target_os = "linux", test))]
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

fn decode_hex_escapes(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' || chars.peek() != Some(&'x') {
            out.push(c);
            continue;
        }
        let mut lookahead = chars.clone();
        lookahead.next();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn kernel_snapshot_contains_the_system_mount() {
        let mounts = read_mounts().unwrap();
        let root = deepest_mount(&mounts, Path::new("/")).unwrap();
        assert_eq!(root.path, Path::new("/"));
        assert!(root.device.starts_with("/dev/"));
    }

    #[test]
    fn mount_lookup_is_component_aware_and_uses_deepest_mount() {
        let mounts = parse_mounts("/dev/root / ext4 rw 0 0\n/dev/sda1 /mnt/music ext4 rw 0 0\n/dev/sdb1 /mnt/music/videos ext4 rw 0 0").unwrap();
        assert_eq!(
            deepest_mount(&mounts, Path::new("/mnt/music/videos/film"))
                .unwrap()
                .device,
            "/dev/sdb1"
        );
        assert_eq!(
            deepest_mount(&mounts, Path::new("/mnt/music-other"))
                .unwrap()
                .device,
            "/dev/root"
        );
    }

    #[test]
    fn decodes_mount_paths_and_labels() {
        let mounts = parse_mounts(r"/dev/sda1 /media/my\040music\134files ext4 rw 0 0").unwrap();
        assert_eq!(mounts[0].path, Path::new("/media/my music\\files"));
        assert_eq!(decode_hex_escapes(r"my\x20music"), "my music");
        assert!(parse_mounts("broken").is_err());
    }
}

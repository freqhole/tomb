//! path uniquification for songs written to a removable-storage device.
//!
//! layout: `{artist}/{album}/{disc}-{track} - {title}.{ext}`, relative to
//! the device's configured music subpath. collisions (two different songs
//! whose sanitized names resolve to the same path) are resolved with a
//! numeric suffix; grimoire's `external_storage_claimed_pathz` table
//! tracks every path ever handed out so a re-sync of the *same* song
//! always reuses its existing path rather than re-uniquifying every run
//! (that lookup - "is this song's own path still claimed by it" - happens
//! in `copy_engine`, before `uniquify_path` is ever called).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// characters that are illegal in fat32/exfat filenames (also illegal or
/// awkward on macos/linux/windows generally) - replaced with a space,
/// then whitespace is collapsed and trimmed.
const ILLEGAL_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// windows/fat reserved device names - illegal as a bare path segment
/// (case-insensitively, with or without an extension) on fat32/exfat.
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// fat32/exfat cap on a single path component (255 utf-16 code units for
/// long file names) - trimmed well under that to leave room for
/// multi-byte utf-8 encoding.
const MAX_SEGMENT_LEN: usize = 200;

/// sanitize one path segment (artist name, album name, song title,
/// user-supplied sub-path component) for safe use as a single path
/// component on a fat32/exfat device - as well as macos/linux/windows.
pub fn sanitize_segment(raw: &str) -> String {
    let replaced: String = raw
        .chars()
        .map(|c| {
            if ILLEGAL_CHARS.contains(&c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut trimmed = collapsed.trim().trim_matches('.').to_string();
    if trimmed.len() > MAX_SEGMENT_LEN {
        // truncate on a char boundary rather than a byte offset.
        trimmed = trimmed.chars().take(MAX_SEGMENT_LEN).collect();
        trimmed = trimmed.trim_end().trim_end_matches('.').to_string();
    }
    if trimmed.is_empty() || RESERVED_NAMES.contains(&trimmed.to_uppercase().as_str()) {
        "unknown".to_string()
    } else {
        trimmed
    }
}

/// sanitize a user-supplied, possibly multi-segment sub-path (e.g. from
/// the settings ui's device/playlists path input, which may contain
/// leading/trailing slashes and nested directories like
/// `/freqhole/music/my cool playlists/`) for safe use as a relative
/// directory path on a fat32/exfat device: splits on `/` or `\`, drops
/// empty segments (leading/trailing/doubled slashes), and runs every
/// remaining segment through [`sanitize_segment`]. a segment that's just
/// `.`/`..` sanitizes to `"unknown"` (via the empty-after-trim-dots path
/// in `sanitize_segment`), so this can't escape the device's mount root.
pub fn sanitize_subpath(raw: &str) -> String {
    raw.split(['/', '\\'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(sanitize_segment)
        .collect::<Vec<_>>()
        .join("/")
}

/// build the base (pre-uniquification) relative path for a song.
pub fn compute_relative_path(
    artist: &str,
    album: &str,
    disc_number: i64,
    track_number: i64,
    title: &str,
    ext: &str,
) -> PathBuf {
    let artist = sanitize_segment(artist);
    let album = sanitize_segment(album);
    let title = sanitize_segment(title);
    let filename = format!(
        "{:02}-{:02} - {}.{}",
        disc_number.max(0),
        track_number.max(0),
        title,
        ext
    );
    PathBuf::from(artist).join(album).join(filename)
}

/// resolve `base` to a path not already present in `claimed_paths` - the
/// first attempt reuses `base` as-is; each retry appends `(2)`, `(3)`, ...
/// before the extension. `claimed_paths` holds `/`-joined relative path
/// strings (platform-independent, matching how they're persisted in
/// grimoire's `external_storage_claimed_pathz` table).
pub fn uniquify_path(base: &Path, claimed_paths: &HashSet<String>) -> PathBuf {
    let as_string = |p: &Path| p.to_string_lossy().replace('\\', "/");
    let base_str = as_string(base);
    if !claimed_paths.contains(&base_str) {
        return base.to_path_buf();
    }

    let stem = base
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = base.extension().map(|e| e.to_string_lossy().to_string());
    let parent = base.parent().map(|p| p.to_path_buf()).unwrap_or_default();

    let mut n: u32 = 2;
    loop {
        let candidate_name = match &ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = parent.join(candidate_name);
        let candidate_str = as_string(&candidate);
        if !claimed_paths.contains(&candidate_str) {
            return candidate;
        }
        n += 1;
    }
}

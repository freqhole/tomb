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

/// characters that are illegal (or awkward) in filenames across macos/
/// linux/windows - replaced with a space, then whitespace is collapsed
/// and trimmed.
const ILLEGAL_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// sanitize one path segment (artist name, album name, song title) for
/// safe use as a filesystem path component on any target os.
pub fn sanitize_segment(raw: &str) -> String {
    let replaced: String = raw
        .chars()
        .map(|c| if ILLEGAL_CHARS.contains(&c) { ' ' } else { c })
        .collect();
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed
    }
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

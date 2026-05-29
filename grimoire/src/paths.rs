//! filesystem path normalization helpers
//!
//! all on-disk paths recorded in grimoire (music files, scan dir roots, iroh-blobs
//! FsStore references, etc.) should pass through `canonical_path*` at the boundary
//! where they enter the system. this guarantees:
//!
//!   - tilde-prefixed paths get rejected/passed-through (we never expand `~` ourselves,
//!     but a canonical path will never contain one)
//!   - symlink chains are resolved once (e.g. `/home -> /var/home` on fedora silverblue)
//!   - flatpak portal "document" paths (`/run/user/1000/doc/<id>/...`) are resolved
//!     to their real backing paths so they survive across sessions
//!   - trailing slashes are trimmed
//!
//! on failure (path doesn't exist yet, permission denied, etc.) we fall back to a
//! trimmed copy of the input and emit a debug! breadcrumb. callers that *require*
//! a canonical path should use `canonical_path_strict`.

use std::path::{Path, PathBuf};

/// canonicalize a path string, falling back to the trimmed input on failure.
///
/// use this at every grimoire boundary that accepts a user-supplied filesystem
/// path (scan dirs, move targets, etc.). the returned string is suitable for
/// storage in sqlite and for hand-off to iroh-blobs FsStore.
pub fn canonical_path_string(input: &str) -> String {
    let trimmed = input.trim_end_matches('/');
    match std::fs::canonicalize(trimmed) {
        Ok(p) => p.to_string_lossy().into_owned(),
        Err(e) => {
            tracing::debug!(
                input = %input,
                error = %e,
                "canonical_path_string: canonicalize failed, falling back to trimmed input"
            );
            trimmed.to_string()
        }
    }
}

/// canonicalize a `Path`, falling back to the input on failure. see
/// `canonical_path_string` for semantics.
pub fn canonical_path(input: &Path) -> PathBuf {
    match std::fs::canonicalize(input) {
        Ok(p) => p,
        Err(e) => {
            tracing::debug!(
                input = %input.display(),
                error = %e,
                "canonical_path: canonicalize failed, falling back to input"
            );
            input.to_path_buf()
        }
    }
}

/// canonicalize strictly: returns None if the path can't be resolved (does not
/// exist, permission denied, etc.). use this when storing the path would be
/// useless without resolution (e.g. iroh-blobs FsStore references).
pub fn canonical_path_strict(input: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(input).ok()
}

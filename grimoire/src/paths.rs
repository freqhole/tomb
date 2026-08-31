//! filesystem path normalization helpers
//!
//! all on-disk paths recorded in grimoire (music files, scan dir roots, iroh-blobs
//! FsStore references, etc.) should pass through `canonical_path*` at the boundary
//! where they enter the system. this guarantees:
//!
//!   - tilde-prefixed paths get rejected/passed-through (we never expand `~` ourselves,
//!     but a canonical path will never contain one)
//!   - symlink chains are resolved once (e.g. `/home -> /var/home` on fedora silverblue)
//!   - trailing slashes are trimmed
//!
//! **flatpak portal "document" paths are the one deliberate exception**: a path
//! under `/run/user/<uid>/doc/<id>/...` is passed through unchanged, never
//! canonicalized. under flatpak the sandbox can only *write* through that FUSE
//! path - its real host-filesystem equivalent is typically read-only (per the
//! sandbox's finish-args), so resolving to it would silently turn a working,
//! writable path into a broken, read-only one. see
//! docs/flatpak-filesystem-access-plan.md for the full writeup.
//!
//! on failure (path doesn't exist yet, permission denied, etc.) we fall back to a
//! trimmed copy of the input and emit a debug! breadcrumb. callers that *require*
//! a canonical path should use `canonical_path_strict`.

use std::path::{Path, PathBuf};

/// true if `path` looks like a flatpak document-portal FUSE path
/// (`/run/user/<uid>/doc/<id>/...`) - these must never be canonicalized away,
/// see the module doc comment.
pub fn is_doc_portal_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("/run/user/") else {
        return false;
    };
    let Some((uid, rest)) = rest.split_once('/') else {
        return false;
    };
    !uid.is_empty() && uid.bytes().all(|b| b.is_ascii_digit()) && rest.starts_with("doc/")
}

/// canonicalize a path string, falling back to the trimmed input on failure.
///
/// use this at every grimoire boundary that accepts a user-supplied filesystem
/// path (scan dirs, move targets, etc.). the returned string is suitable for
/// storage in sqlite and for hand-off to iroh-blobs FsStore.
pub fn canonical_path_string(input: &str) -> String {
    let trimmed = input.trim_end_matches('/');
    if is_doc_portal_path(trimmed) {
        return trimmed.to_string();
    }
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
    if input
        .to_str()
        .is_some_and(|s| is_doc_portal_path(s.trim_end_matches('/')))
    {
        return input.to_path_buf();
    }
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
    if input.to_str().is_some_and(is_doc_portal_path) {
        return Some(input.to_path_buf());
    }
    std::fs::canonicalize(input).ok()
}

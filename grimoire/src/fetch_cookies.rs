//! cookies.txt management for yt-dlp's `--cookies <file>` flag.
//!
//! lives in the data dir next to `iroh-identity.key` (see
//! `federation::identity`'s identical "one file in data_dir, CRUD'd by the
//! wizard UI" shape) - lets an admin paste a browser-exported Netscape-
//! format cookies file so yt-dlp can authenticate for sources that 403 an
//! anonymous request (private/members-only/sign-in-gated content).
//!
//! deliberately NOT wired into every fetch invocation: `--cookies` is only
//! ever added as a one-shot retry after a plain `HTTP Error 403`, and only
//! when `has_cookies()` is true - see
//! `music::fetch::service::download_media`'s own doc comment for the full
//! policy. handing yt-dlp a (possibly stale) cookie jar on every single
//! call would be pointless overhead most of the time, and an unnecessary
//! way to leak session cookies into argv/logs when nothing actually needs
//! them.

use crate::config::get_config;
use crate::error::GrimoireResult;
use std::path::PathBuf;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const COOKIES_FILENAME: &str = "cookies.txt";

/// path to the cookies.txt file in the data dir - may not exist yet.
pub fn cookies_path() -> PathBuf {
    get_config().data_dir.join(COOKIES_FILENAME)
}

/// current cookies.txt contents, if the file exists. `None` when it's
/// never been created (not an error - that's the common/default state).
pub fn read_cookies() -> GrimoireResult<Option<String>> {
    let path = cookies_path();
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(std::fs::read_to_string(&path)?))
}

/// overwrite cookies.txt with `contents`. a blank (whitespace-only)
/// `contents` deletes the file instead of leaving an empty one on disk -
/// so "clear the textarea and save" in the wizard UI and an explicit
/// `clear_cookies()` call both leave the same end state, and `has_cookies()`
/// never has to special-case an empty-but-present file.
pub fn write_cookies(contents: &str) -> GrimoireResult<()> {
    if contents.trim().is_empty() {
        return clear_cookies();
    }

    let path = cookies_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, contents)?;

    // cookies are bearer credentials for whatever site they came from -
    // same owner-only permissions as the iroh keypair (see
    // `federation::identity::save_keypair`).
    #[cfg(unix)]
    {
        let mut perms = std::fs::metadata(&path)?.permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(&path, perms)?;
    }

    Ok(())
}

/// delete cookies.txt, if present. not an error if it was already gone.
pub fn clear_cookies() -> GrimoireResult<()> {
    let path = cookies_path();
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// true when cookies.txt exists and has non-whitespace content - the only
/// thing that gates `download_media`'s cookies-retry fallback (see this
/// module's own doc comment).
pub fn has_cookies() -> bool {
    read_cookies()
        .ok()
        .flatten()
        .is_some_and(|s| !s.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_read_clear_roundtrip() {
        crate::config::init_config_for_tests();
        // best-effort pre-clean in case a previous failed run left a file
        // behind (shared global test data_dir, see init_config_for_tests).
        let _ = clear_cookies();

        assert_eq!(read_cookies().unwrap(), None);
        assert!(!has_cookies());

        write_cookies("# Netscape HTTP Cookie File\nexample.com\tTRUE\t/\tFALSE\t0\tname\tvalue\n")
            .unwrap();
        assert!(has_cookies());
        assert!(read_cookies().unwrap().unwrap().contains("example.com"));

        // blank contents clears rather than leaving an empty file
        write_cookies("   \n\t").unwrap();
        assert!(!cookies_path().exists());
        assert_eq!(read_cookies().unwrap(), None);
        assert!(!has_cookies());

        write_cookies("stuff").unwrap();
        assert!(has_cookies());
        clear_cookies().unwrap();
        assert_eq!(read_cookies().unwrap(), None);
        // clearing an already-absent file is not an error
        clear_cookies().unwrap();
    }
}

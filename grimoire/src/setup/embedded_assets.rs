//! embedded spume client assets
//!
//! uses include_dir to embed the client/spume/dist/ folder at compile time.
//! provides extraction to write files to disk during setup.

use include_dir::{include_dir, Dir};
use std::fs;
use std::io;
use std::path::Path;

/// embedded spume client distribution files
///
/// this embeds the entire client/spume/dist/ directory at compile time.
/// rebuild required when dist/ contents change.
pub static SPUME_DIST: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../client/spume/dist");

/// result of extracting spume assets
#[derive(Debug, Clone)]
pub struct ExtractResult {
    pub files_extracted: usize,
    pub dirs_created: usize,
    pub destination: String,
}

/// extract embedded spume assets to a destination directory
///
/// creates the destination directory if it doesn't exist.
/// overwrites existing files (to allow updates).
/// returns the count of files extracted.
pub fn extract_spume_to(dest: &Path) -> io::Result<ExtractResult> {
    let mut result = ExtractResult {
        files_extracted: 0,
        dirs_created: 0,
        destination: dest.display().to_string(),
    };

    // create destination directory
    if !dest.exists() {
        fs::create_dir_all(dest)?;
        result.dirs_created += 1;
    }

    // extract recursively
    extract_dir_recursive(&SPUME_DIST, dest, &mut result)?;

    Ok(result)
}

/// recursively extract a directory and its contents
fn extract_dir_recursive(dir: &Dir<'_>, dest: &Path, result: &mut ExtractResult) -> io::Result<()> {
    // extract all files in this directory
    for file in dir.files() {
        let file_dest = dest.join(file.path());

        // ensure parent directory exists
        if let Some(parent) = file_dest.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)?;
                result.dirs_created += 1;
            }
        }

        // write file contents
        fs::write(&file_dest, file.contents())?;
        result.files_extracted += 1;
    }

    // recurse into subdirectories
    for subdir in dir.dirs() {
        let subdir_dest = dest.join(subdir.path());
        if !subdir_dest.exists() {
            fs::create_dir_all(&subdir_dest)?;
            result.dirs_created += 1;
        }
        extract_dir_recursive(subdir, dest, result)?;
    }

    Ok(())
}

/// check if spume assets are available (embedded)
///
/// returns true if there are files to extract
pub fn has_embedded_spume() -> bool {
    // check if we have at least index.html
    SPUME_DIST.get_file("index.html").is_some()
}

/// result of updating spume (clean + extract)
#[derive(Debug, Clone)]
pub struct UpdateSpumeResult {
    pub files_cleaned: usize,
    pub files_extracted: usize,
    pub destination: String,
}

/// error type for spume update operations
#[derive(Debug)]
pub enum UpdateSpumeError {
    /// target directory is unsafe to clean (system path, home dir, etc.)
    UnsafePath(String),
    /// target directory exists but doesn't look like a spume install
    NotSpumeDirectory(String),
    /// no embedded spume assets available
    NoEmbeddedAssets,
    /// IO error during clean or extract
    IoError(io::Error),
}

impl std::fmt::Display for UpdateSpumeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsafePath(msg) => write!(f, "unsafe path: {}", msg),
            Self::NotSpumeDirectory(msg) => write!(f, "not a spume directory: {}", msg),
            Self::NoEmbeddedAssets => write!(f, "no embedded spume assets available"),
            Self::IoError(e) => write!(f, "io error: {}", e),
        }
    }
}

impl std::error::Error for UpdateSpumeError {}

impl From<io::Error> for UpdateSpumeError {
    fn from(e: io::Error) -> Self {
        Self::IoError(e)
    }
}

/// check if a path is safe to clean (not a system or home directory)
fn is_safe_to_clean(path: &Path) -> Result<(), UpdateSpumeError> {
    // must be absolute
    if !path.is_absolute() {
        return Err(UpdateSpumeError::UnsafePath(
            "path must be absolute".to_string(),
        ));
    }

    // check for root
    if path.as_os_str() == "/" {
        return Err(UpdateSpumeError::UnsafePath(
            "cannot clean root directory".to_string(),
        ));
    }

    // check for home directory itself (not subdirectories)
    if let Some(home) = dirs::home_dir() {
        if path == home {
            return Err(UpdateSpumeError::UnsafePath(
                "cannot clean home directory".to_string(),
            ));
        }
    }

    // path should end with "spume" or contain "spume" in the name
    // this is a sanity check to prevent cleaning arbitrary directories
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if !name.contains("spume") {
        return Err(UpdateSpumeError::UnsafePath(format!(
            "directory name must contain 'spume', got: {}",
            name
        )));
    }

    Ok(())
}

/// check if existing directory looks like a spume installation
fn looks_like_spume_dir(path: &Path) -> bool {
    if !path.exists() {
        return true; // empty/new directory is fine
    }
    if !path.is_dir() {
        return false;
    }

    // check for typical spume files/dirs
    let has_index = path.join("index.html").exists();
    let has_assets = path.join("assets").is_dir();

    // also accept empty directories
    let is_empty = path
        .read_dir()
        .map(|mut d| d.next().is_none())
        .unwrap_or(false);

    has_index || has_assets || is_empty
}

/// clean all contents of a spume directory (but keep the directory itself)
fn clean_spume_dir(path: &Path) -> io::Result<usize> {
    if !path.exists() {
        return Ok(0);
    }

    let mut cleaned = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let entry_path = entry.path();

        if entry_path.is_dir() {
            fs::remove_dir_all(&entry_path)?;
        } else {
            fs::remove_file(&entry_path)?;
        }
        cleaned += 1;
    }

    Ok(cleaned)
}

/// safely update spume by cleaning old files and extracting new ones
///
/// performs safety checks before cleaning:
/// - path must be absolute and not a system directory
/// - path must end in "spume" (sanity check)
/// - if directory exists, it must look like a spume install (has index.html or assets/)
///
/// use this instead of extract_spume_to when updating an existing installation
pub fn update_spume_to(dest: &Path) -> Result<UpdateSpumeResult, UpdateSpumeError> {
    // check if we have embedded assets
    if !has_embedded_spume() {
        return Err(UpdateSpumeError::NoEmbeddedAssets);
    }

    // safety check: is this path safe to clean?
    is_safe_to_clean(dest)?;

    // if directory exists, verify it looks like spume
    if dest.exists() && !looks_like_spume_dir(dest) {
        return Err(UpdateSpumeError::NotSpumeDirectory(format!(
            "directory exists but doesn't look like spume (no index.html or assets/): {}",
            dest.display()
        )));
    }

    // clean existing files
    let files_cleaned = if dest.exists() {
        clean_spume_dir(dest)?
    } else {
        0
    };

    // extract new files
    let extract_result = extract_spume_to(dest)?;

    Ok(UpdateSpumeResult {
        files_cleaned,
        files_extracted: extract_result.files_extracted,
        destination: dest.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_has_embedded_spume() {
        // this will be true if dist/ exists at compile time
        let has_assets = has_embedded_spume();
        // we can't assert true/false since it depends on build state
        // but we can verify the function runs without panic
        println!("has_embedded_spume: {}", has_assets);
    }

    #[test]
    fn test_is_safe_to_clean() {
        // unsafe paths should fail
        assert!(is_safe_to_clean(Path::new("/")).is_err());

        // relative paths should fail
        assert!(is_safe_to_clean(Path::new("spume")).is_err());
        assert!(is_safe_to_clean(Path::new("./spume")).is_err());

        // paths not containing "spume" should fail
        assert!(is_safe_to_clean(Path::new("/tmp/myapp")).is_err());

        // valid spume paths should pass
        assert!(is_safe_to_clean(Path::new("/tmp/spume")).is_ok());
        assert!(is_safe_to_clean(Path::new("/home/user/data/spume")).is_ok());
        assert!(is_safe_to_clean(Path::new(
            "/Users/test/Library/Application Support/freqhole/spume"
        ))
        .is_ok());
    }
}

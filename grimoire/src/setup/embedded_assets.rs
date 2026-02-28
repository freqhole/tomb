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
}

//! identity management for reliquary's iroh keypair.
//!
//! reliquary has its own iroh keypair, separate from any consuming app's own
//! server/CLI identity. the keypair is stored as a 32-byte file in the data
//! directory and persisted across restarts. the public key (node id)
//! identifies this peer in the P2P network — other peers add it as a friend.
//!
//! the keypair file name is a parameter, not hardcoded: a consuming app that
//! wants its own naming convention (or runs more than one reliquary-backed
//! identity side by side) can pass whatever name it likes; `DEFAULT_KEYPAIR_FILENAME`
//! is provided for callers that don't care.

use std::path::{Path, PathBuf};

use iroh::SecretKey;
use thiserror::Error;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

/// default keypair file name, for callers that don't need a custom one.
pub const DEFAULT_KEYPAIR_FILENAME: &str = "reliquary-identity.key";

#[derive(Debug, Error)]
pub enum IdentityError {
    #[error("keypair already exists at {path}")]
    AlreadyExists { path: String },

    #[error("keypair not found at {path}")]
    NotFound { path: String },

    #[error("invalid keypair file: expected 32 bytes, got {len}")]
    InvalidKeyLength { len: usize },

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("random generation failed: {0}")]
    Random(String),
}

/// info about a peer's identity, for status display.
#[derive(Debug, Clone)]
pub struct ReliquaryIdentity {
    pub keypair_exists: bool,
    pub keypair_path: PathBuf,
    pub node_id: Option<String>,
}

/// the path to the keypair file named `filename` within `data_dir`.
pub fn keypair_path(data_dir: &Path, filename: &str) -> PathBuf {
    data_dir.join(filename)
}

/// generate a new keypair and save it to disk.
///
/// returns an error if the keypair file already exists — use
/// `load_or_generate_keypair` for safe creation.
pub fn generate_keypair(data_dir: &Path, filename: &str) -> Result<SecretKey, IdentityError> {
    let path = keypair_path(data_dir, filename);

    if path.exists() {
        return Err(IdentityError::AlreadyExists {
            path: path.display().to_string(),
        });
    }

    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| IdentityError::Random(e.to_string()))?;
    let secret = SecretKey::from(bytes);
    save_keypair(&path, &secret)?;
    Ok(secret)
}

/// load an existing keypair from disk.
pub fn load_keypair(data_dir: &Path, filename: &str) -> Result<SecretKey, IdentityError> {
    let path = keypair_path(data_dir, filename);

    if !path.exists() {
        return Err(IdentityError::NotFound {
            path: path.display().to_string(),
        });
    }

    let bytes = std::fs::read(&path)?;

    if bytes.len() != 32 {
        return Err(IdentityError::InvalidKeyLength { len: bytes.len() });
    }

    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&bytes);
    Ok(SecretKey::from(key_bytes))
}

/// load an existing keypair, or generate a new one if none exists yet.
pub fn load_or_generate_keypair(
    data_dir: &Path,
    filename: &str,
) -> Result<SecretKey, IdentityError> {
    let path = keypair_path(data_dir, filename);
    if path.exists() {
        load_keypair(data_dir, filename)
    } else {
        generate_keypair(data_dir, filename)
    }
}

/// get identity status for display.
pub fn get_identity_info(data_dir: &Path, filename: &str) -> ReliquaryIdentity {
    let path = keypair_path(data_dir, filename);
    let exists = path.exists();
    let node_id = if exists {
        load_keypair(data_dir, filename)
            .ok()
            .map(|s| s.public().to_string())
    } else {
        None
    };

    ReliquaryIdentity {
        keypair_exists: exists,
        keypair_path: path,
        node_id,
    }
}

/// save keypair to disk with secure permissions (chmod 600 on unix).
fn save_keypair(path: &Path, secret: &SecretKey) -> Result<(), IdentityError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::write(path, secret.to_bytes())?;

    // restrict to owner read/write only on unix; no windows equivalent here.
    #[cfg(unix)]
    {
        let mut perms = std::fs::metadata(path)?.permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(path, perms)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_and_load_keypair_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path();

        // no keypair initially
        assert!(!keypair_path(data_dir, DEFAULT_KEYPAIR_FILENAME).exists());
        let info = get_identity_info(data_dir, DEFAULT_KEYPAIR_FILENAME);
        assert!(!info.keypair_exists);
        assert!(info.node_id.is_none());

        // generate
        let secret = generate_keypair(data_dir, DEFAULT_KEYPAIR_FILENAME).unwrap();
        assert!(keypair_path(data_dir, DEFAULT_KEYPAIR_FILENAME).exists());

        // load
        let loaded = load_keypair(data_dir, DEFAULT_KEYPAIR_FILENAME).unwrap();
        assert_eq!(secret.to_bytes(), loaded.to_bytes());

        // identity info
        let info = get_identity_info(data_dir, DEFAULT_KEYPAIR_FILENAME);
        assert!(info.keypair_exists);
        assert!(info.node_id.is_some());
        assert_eq!(info.node_id.unwrap(), secret.public().to_string());

        // generating again over an existing keypair must fail
        assert!(generate_keypair(data_dir, DEFAULT_KEYPAIR_FILENAME).is_err());
    }

    #[test]
    fn load_or_generate_is_stable_across_calls() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path();

        let first = load_or_generate_keypair(data_dir, DEFAULT_KEYPAIR_FILENAME).unwrap();
        let second = load_or_generate_keypair(data_dir, DEFAULT_KEYPAIR_FILENAME).unwrap();
        assert_eq!(first.to_bytes(), second.to_bytes());
    }

    #[test]
    fn load_missing_keypair_errors_not_found() {
        let dir = tempfile::tempdir().unwrap();
        let err = load_keypair(dir.path(), DEFAULT_KEYPAIR_FILENAME).unwrap_err();
        assert!(matches!(err, IdentityError::NotFound { .. }));
    }

    #[test]
    fn invalid_keypair_length_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = keypair_path(dir.path(), DEFAULT_KEYPAIR_FILENAME);
        std::fs::write(&path, b"too short").unwrap();

        let err = load_keypair(dir.path(), DEFAULT_KEYPAIR_FILENAME).unwrap_err();
        assert!(matches!(err, IdentityError::InvalidKeyLength { len: 9 }));
    }

    #[cfg(unix)]
    #[test]
    fn keypair_file_has_owner_only_permissions() {
        let dir = tempfile::tempdir().unwrap();
        generate_keypair(dir.path(), DEFAULT_KEYPAIR_FILENAME).unwrap();

        let path = keypair_path(dir.path(), DEFAULT_KEYPAIR_FILENAME);
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    // the keypair filename is configurable rather than hardcoded - cover it
    // explicitly so a regression back to a hardcoded name is caught.
    #[test]
    fn custom_filename_is_respected_and_independent_of_default() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path();
        const CUSTOM: &str = "custom-identity.key";

        let custom_secret = generate_keypair(data_dir, CUSTOM).unwrap();
        assert!(keypair_path(data_dir, CUSTOM).exists());
        assert!(!keypair_path(data_dir, DEFAULT_KEYPAIR_FILENAME).exists());

        // a default-named keypair can coexist independently in the same dir.
        let default_secret = generate_keypair(data_dir, DEFAULT_KEYPAIR_FILENAME).unwrap();
        assert_ne!(custom_secret.to_bytes(), default_secret.to_bytes());

        let loaded_custom = load_keypair(data_dir, CUSTOM).unwrap();
        assert_eq!(custom_secret.to_bytes(), loaded_custom.to_bytes());
    }
}

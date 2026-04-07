//! identity management for the reliquary hub peer.
//!
//! reliquary has its own iroh keypair, separate from the server/CLI identity.
//! the keypair is stored as a 32-byte file in the data directory and persisted
//! across restarts. the public key (node ID) identifies this hub peer in the
//! P2P network — other users add it as a friend.

use std::path::{Path, PathBuf};

use iroh::SecretKey;
use thiserror::Error;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const KEYPAIR_FILENAME: &str = "reliquary-identity.key";

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

/// info about the hub peer's identity, for status display.
#[derive(Debug, Clone)]
pub struct ReliquaryIdentity {
    pub keypair_exists: bool,
    pub keypair_path: PathBuf,
    pub node_id: Option<String>,
}

/// get the path to the reliquary keypair file within the given data directory.
pub fn keypair_path(data_dir: &Path) -> PathBuf {
    data_dir.join(KEYPAIR_FILENAME)
}

/// generate a new keypair and save it to disk.
///
/// returns error if the keypair file already exists — use `load_or_generate`
/// for safe creation.
pub fn generate_keypair(data_dir: &Path) -> Result<SecretKey, IdentityError> {
    let path = keypair_path(data_dir);

    if path.exists() {
        return Err(IdentityError::AlreadyExists {
            path: path.display().to_string(),
        });
    }

    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| IdentityError::Random(e.to_string()))?;
    let secret = SecretKey::from(bytes);
    save_keypair(data_dir, &secret)?;
    Ok(secret)
}

/// load an existing keypair from disk.
pub fn load_keypair(data_dir: &Path) -> Result<SecretKey, IdentityError> {
    let path = keypair_path(data_dir);

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

/// load existing keypair or generate a new one if none exists.
pub fn load_or_generate_keypair(data_dir: &Path) -> Result<SecretKey, IdentityError> {
    let path = keypair_path(data_dir);
    if path.exists() {
        load_keypair(data_dir)
    } else {
        generate_keypair(data_dir)
    }
}

/// get identity status for display.
pub fn get_identity_info(data_dir: &Path) -> ReliquaryIdentity {
    let path = keypair_path(data_dir);
    let exists = path.exists();
    let node_id = if exists {
        load_keypair(data_dir).ok().map(|s| s.public().to_string())
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
fn save_keypair(data_dir: &Path, secret: &SecretKey) -> Result<(), IdentityError> {
    let path = keypair_path(data_dir);

    // ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // write the 32-byte secret key
    std::fs::write(&path, secret.to_bytes())?;

    // set file permissions to 600 (owner read/write only) on unix
    #[cfg(unix)]
    {
        let mut perms = std::fs::metadata(&path)?.permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(&path, perms)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_and_load_keypair() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path();

        // no keypair initially
        assert!(!keypair_path(data_dir).exists());
        let info = get_identity_info(data_dir);
        assert!(!info.keypair_exists);
        assert!(info.node_id.is_none());

        // generate
        let secret = generate_keypair(data_dir).unwrap();
        assert!(keypair_path(data_dir).exists());

        // load
        let loaded = load_keypair(data_dir).unwrap();
        assert_eq!(secret.to_bytes(), loaded.to_bytes());

        // identity info
        let info = get_identity_info(data_dir);
        assert!(info.keypair_exists);
        assert!(info.node_id.is_some());
        assert_eq!(info.node_id.unwrap(), secret.public().to_string());

        // generate again should fail
        assert!(generate_keypair(data_dir).is_err());
    }

    #[test]
    fn test_load_or_generate() {
        let dir = tempfile::tempdir().unwrap();
        let data_dir = dir.path();

        // first call generates
        let first = load_or_generate_keypair(data_dir).unwrap();

        // second call loads the same key
        let second = load_or_generate_keypair(data_dir).unwrap();
        assert_eq!(first.to_bytes(), second.to_bytes());
    }
}

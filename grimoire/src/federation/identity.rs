//! identity management for iroh P2P networking
//!
//! manages the iroh secret key (keypair) for this freqhole instance.
//! the keypair is stored in the data directory and persisted across restarts.
//! the public key (node_id) is used to identify this instance in the P2P network.

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};
use iroh::SecretKey;
use std::path::PathBuf;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const KEYPAIR_FILENAME: &str = "iroh-identity.key";

/// get the path to the keypair file
pub fn keypair_path() -> PathBuf {
    get_config().data_dir.join(KEYPAIR_FILENAME)
}

/// check if a keypair exists
pub fn keypair_exists() -> bool {
    keypair_path().exists()
}

/// generate a new keypair and save it to disk
///
/// returns error if keypair already exists (use load_or_generate for safe creation)
pub fn generate_keypair() -> GrimoireResult<SecretKey> {
    let path = keypair_path();

    if path.exists() {
        return Err(GrimoireError::FederationApiError {
            message: format!("keypair already exists at {}", path.display()),
        });
    }

    // generate 32 random bytes using getrandom
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|e| GrimoireError::FederationApiError {
        message: format!("failed to generate random bytes: {}", e),
    })?;
    let secret = SecretKey::from(bytes);
    save_keypair(&secret)?;
    Ok(secret)
}

/// load existing keypair from disk
pub fn load_keypair() -> GrimoireResult<SecretKey> {
    let path = keypair_path();

    if !path.exists() {
        return Err(GrimoireError::FederationCredentialsNotFound);
    }

    let bytes = std::fs::read(&path).map_err(|e| GrimoireError::FederationApiError {
        message: format!("failed to read keypair: {}", e),
    })?;

    if bytes.len() != 32 {
        return Err(GrimoireError::FederationCredentialsInvalid {
            message: format!(
                "invalid keypair file: expected 32 bytes, got {}",
                bytes.len()
            ),
        });
    }

    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&bytes);

    Ok(SecretKey::from(key_bytes))
}

/// load existing keypair or generate a new one if none exists
pub fn load_or_generate_keypair() -> GrimoireResult<SecretKey> {
    if keypair_exists() {
        load_keypair()
    } else {
        generate_keypair()
    }
}

/// save keypair to disk with secure permissions (chmod 600)
fn save_keypair(secret: &SecretKey) -> GrimoireResult<()> {
    let path = keypair_path();

    // ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to create directory: {}", e),
        })?;
    }

    // write the 32-byte secret key
    std::fs::write(&path, secret.to_bytes()).map_err(|e| GrimoireError::FederationApiError {
        message: format!("failed to write keypair: {}", e),
    })?;

    // set file permissions to 600 (owner read/write only) on unix
    #[cfg(unix)]
    {
        let mut perms = std::fs::metadata(&path)
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to get file metadata: {}", e),
            })?
            .permissions();
        perms.set_mode(0o600);
        std::fs::set_permissions(&path, perms).map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to set permissions: {}", e),
        })?;
    }

    Ok(())
}

/// get the node_id (public key) for this instance
///
/// returns None if no keypair exists yet
pub fn get_node_id() -> Option<String> {
    load_keypair().ok().map(|s| s.public().to_string())
}

/// identity info for status display
#[derive(Debug, Clone)]
pub struct IdentityInfo {
    pub keypair_exists: bool,
    pub keypair_path: PathBuf,
    pub node_id: Option<String>,
}

/// get identity status info
pub fn get_identity_info() -> IdentityInfo {
    let path = keypair_path();
    let exists = path.exists();
    let node_id = if exists {
        load_keypair().ok().map(|s| s.public().to_string())
    } else {
        None
    };

    IdentityInfo {
        keypair_exists: exists,
        keypair_path: path,
        node_id,
    }
}

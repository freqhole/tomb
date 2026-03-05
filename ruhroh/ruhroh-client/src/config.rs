//! client configuration and identity management

use anyhow::Result;
use iroh::SecretKey;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::info;

/// Client configuration persisted to disk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientConfig {
    pub server_id: String,
    pub api_key: String,
    pub display_name: String,
}

/// Load or generate iroh secret key
pub async fn load_or_generate_key(data_dir: &PathBuf) -> Result<SecretKey> {
    let key_path = data_dir.join("secret_key");

    if key_path.exists() {
        let bytes = tokio::fs::read(&key_path).await?;
        let bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("invalid key file"))?;
        Ok(SecretKey::from_bytes(&bytes))
    } else {
        // generate 32 random bytes using getrandom
        let mut bytes = [0u8; 32];
        getrandom::getrandom(&mut bytes).expect("failed to get random bytes");
        let key = SecretKey::from_bytes(&bytes);
        tokio::fs::write(&key_path, key.to_bytes()).await?;
        info!("generated new identity");
        Ok(key)
    }
}

/// Load saved config (server_id, api_key)
pub fn load_config(data_dir: &PathBuf) -> Result<Option<ClientConfig>> {
    let config_path = data_dir.join("config.json");
    if !config_path.exists() {
        return Ok(None);
    }
    let data = std::fs::read_to_string(&config_path)?;
    Ok(Some(serde_json::from_str(&data)?))
}

/// Save config
pub fn save_config(data_dir: &PathBuf, config: &ClientConfig) -> Result<()> {
    let config_path = data_dir.join("config.json");
    let data = serde_json::to_string_pretty(config)?;
    std::fs::write(&config_path, data)?;
    Ok(())
}

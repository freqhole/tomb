//! statefile load/save. format: toml under
//! `<grimoire data_dir>/rathole/state.toml`.

use std::path::PathBuf;

use crate::ratcore::app::PersistedState;

fn statefile_path() -> PathBuf {
    let data_dir = grimoire::config::get_config().data_dir;
    data_dir.join("rathole").join("state.toml")
}

pub fn load() -> color_eyre::Result<PersistedState> {
    let path = statefile_path();
    if !path.exists() {
        return Ok(PersistedState::default());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| color_eyre::eyre::eyre!("read {}: {e}", path.display()))?;
    let parsed: PersistedState = toml::from_str(&raw)
        .map_err(|e| color_eyre::eyre::eyre!("parse {}: {e}", path.display()))?;
    Ok(parsed)
}

pub fn save(state: &PersistedState) -> color_eyre::Result<()> {
    let path = statefile_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| color_eyre::eyre::eyre!("mkdir {}: {e}", parent.display()))?;
    }
    let serialized = toml::to_string_pretty(state)
        .map_err(|e| color_eyre::eyre::eyre!("serialize statefile: {e}"))?;
    std::fs::write(&path, serialized)
        .map_err(|e| color_eyre::eyre::eyre!("write {}: {e}", path.display()))?;
    Ok(())
}

//! config + server-info handlers (config_get/set, server_restart, server image
//! upload/thumbnail, server info update).

use crate::admin_dispatch::helpers::{
    bad_request, internal, opt_str, require_str, resolve_config_path,
};
use crate::config::{get_config, read_config_from_file};
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;
use serde_json::{json, Value as JsonValue};
use std::path::PathBuf;

pub(in crate::admin_dispatch) async fn config_get() -> GrimoireResponse<JsonValue> {
    let path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return internal(format!("could not locate config file: {}", e)),
    };
    let toml_str = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => return internal(format!("failed to read config file: {}", e)),
    };
    let parsed = get_config();
    let parsed_json = match serde_json::to_value(&parsed) {
        Ok(v) => v,
        Err(e) => return internal(format!("failed to serialize config: {}", e)),
    };
    GrimoireResponse::success(
        "ok",
        json!({
            "path": path.display().to_string(),
            "toml": toml_str,
            "parsed": parsed_json,
        }),
    )
}

pub(in crate::admin_dispatch) async fn config_set(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let toml_str = match require_str(&args, "toml") {
        Ok(v) => v,
        Err(r) => return r,
    };
    // validate by parsing into GrimoireConfig before writing
    if let Err(e) = toml::from_str::<crate::config::GrimoireConfig>(&toml_str) {
        return bad_request(format!("invalid toml: {}", e));
    }
    let path: PathBuf = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return internal(format!("could not locate config file: {}", e)),
    };
    if let Err(e) = std::fs::write(&path, toml_str.as_bytes()) {
        return internal(format!("failed to write config: {}", e));
    }
    // reload cached CONFIG so subsequent reads reflect the new values.
    if let Err(e) = crate::config::init_config(Some(path.clone())) {
        return internal(format!("config written but reload failed: {}", e));
    }
    let parsed = match read_config_from_file(&path) {
        Ok(p) => p,
        Err(e) => return internal(format!("config written but re-read failed: {}", e)),
    };
    let parsed_json = match serde_json::to_value(&parsed) {
        Ok(v) => v,
        Err(e) => return internal(format!("failed to serialize config: {}", e)),
    };
    GrimoireResponse::success(
        "config updated",
        json!({
            "path": path.display().to_string(),
            "parsed": parsed_json,
        }),
    )
}

pub(in crate::admin_dispatch) async fn server_restart(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let reason = opt_str(&args, "reason").unwrap_or_else(|| "admin requested".to_string());

    // delegate to the registered shutdown hook. the cli `serve` server
    // registers one that drives a graceful drain (axum + iroh + jobs).
    // tauri does not register a hook; restart there is a UI/window-level
    // concern (`AppHandle::restart`) and should not go through this path.
    if !crate::shutdown::request_shutdown(reason.clone()) {
        return GrimoireResponse::failure(
            "server_restart not supported on this binary",
            vec![ErrorDetail::new(
                "no_shutdown_hook",
                "no shutdown hook registered",
                "this process does not support remote restart; \
                 use the local app's restart facility instead",
            )],
        );
    }

    GrimoireResponse::success(
        "graceful shutdown initiated; supervisor must respawn the process",
        json!({
            "reason": reason,
        }),
    )
}

/// upload a new server image. accepts base64-encoded raw image data + the
/// original filename (used only for logging / mime hint). resizes to a
/// 200x200 webp, persists it under `data_dir/freqhole-icon.webp`, updates
/// `[server].image_path`, and refreshes `image_blob_id`.
///
/// this is the remote-target counterpart to the local
/// `update_server_image` tauri command — that one reads from a local file
/// path the user picked; this one accepts the bytes directly so the
/// wizard can talk to a remote freqhole instance.
pub(in crate::admin_dispatch) async fn server_update_image(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let data_b64 = match require_str(&args, "data") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let filename = opt_str(&args, "filename").unwrap_or_else(|| "image".to_string());

    // strip optional data url prefix
    let raw_b64 = data_b64
        .split_once(",")
        .map(|(prefix, rest)| {
            if prefix.starts_with("data:") {
                rest
            } else {
                data_b64.as_str()
            }
        })
        .unwrap_or(data_b64.as_str());

    let bytes = match B64.decode(raw_b64) {
        Ok(b) => b,
        Err(e) => return bad_request(format!("invalid base64 image data: {}", e)),
    };

    // resize to 200x200 webp using grimoire helper
    let webp = match crate::blob_data::resize_to_square_webp(&bytes, 200) {
        Ok(b) => b,
        Err(e) => return internal(format!("failed to resize image: {}", e)),
    };

    let cfg = get_config();
    let dest = cfg.data_dir.join("freqhole-icon.webp");
    if let Err(e) = std::fs::write(&dest, &webp) {
        return internal(format!("failed to write image: {}", e));
    }
    let dest_str = dest.display().to_string();

    // persist absolute path into the config file
    let config_path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return internal(format!("could not locate config file: {}", e)),
    };
    if let Err(e) = crate::config::set_config_values(
        &config_path,
        &[("server.image_path", dest_str.clone().into())],
    ) {
        return internal(format!("failed to update config: {}", e));
    }

    // (re)create the blob and capture its id
    let blob_id = match crate::config::ensure_server_image_blob(&config_path).await {
        Ok(id) => id,
        Err(e) => return internal(format!("failed to create image blob: {}", e)),
    };

    GrimoireResponse::success(
        "server image updated",
        json!({
            "filename": filename,
            "image_path": dest_str,
            "image_blob_id": blob_id,
        }),
    )
}

/// read the server-display fields out of the running config.
/// shape mirrors the local `get_server_config` tauri command so the wizard
/// can use one shape for both targets.
pub(in crate::admin_dispatch) async fn server_get_config() -> GrimoireResponse<JsonValue> {
    // read from disk to avoid stale in-memory CONFIG. cheap (small toml)
    // and immune to any write path that forgets to reload after mutating.
    let cfg = match resolve_config_path() {
        Ok(p) => crate::config::read_config_from_file(&p).unwrap_or_else(|_| get_config()),
        Err(_) => get_config(),
    };
    let server = cfg.server.as_ref();
    let name = server
        .map(|s| s.name.clone())
        .unwrap_or_else(|| "freqhole".to_string());
    let description = server.and_then(|s| s.description.clone());
    let image_path = server
        .and_then(|s| s.image_path.as_ref())
        .map(|p| p.display().to_string());
    let image_blob_id = server.and_then(|s| s.image_blob_id.clone());
    GrimoireResponse::success(
        "ok",
        json!({
            "name": name,
            "description": description,
            "image_path": image_path,
            "image_blob_id": image_blob_id,
        }),
    )
}

/// return the server image as base64. tries a 128px thumbnail first, then
/// falls back to the original blob, then to `[server].image_path` on disk.
/// args: optional `{ size: u32 }` (default 128).
pub(in crate::admin_dispatch) async fn server_get_image_thumbnail(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let size = args
        .get("size")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .unwrap_or(128);

    let cfg = get_config();
    let server = match cfg.server.as_ref() {
        Some(s) => s,
        None => return bad_request("no server config"),
    };

    // prefer blob_id (has thumbnails)
    if let Some(blob_id) = &server.image_blob_id {
        let path = match crate::blob_data::find_existing_thumbnail(blob_id, size).await {
            Some(t) => t.local_path,
            None => {
                let parent = crate::media_blobz::get_media_blob(blob_id).await.ok();
                parent.and_then(|b| b.local_path)
            }
        };
        if let Some(p) = path {
            match std::fs::read(&p) {
                Ok(bytes) => {
                    return GrimoireResponse::success("ok", json!({ "data": B64.encode(&bytes) }));
                }
                Err(e) => return internal(format!("failed to read image: {}", e)),
            }
        }
    }

    // fall back to image_path
    if let Some(image_path) = &server.image_path {
        let full = if image_path.is_absolute() {
            image_path.clone()
        } else {
            cfg.data_dir.join(image_path)
        };
        if full.exists() {
            match std::fs::read(&full) {
                Ok(bytes) => {
                    return GrimoireResponse::success("ok", json!({ "data": B64.encode(&bytes) }));
                }
                Err(e) => return internal(format!("failed to read image: {}", e)),
            }
        } else {
            tracing::warn!(
                "[server_get_image_thumbnail] image_path does not exist: {}",
                full.display()
            );
        }
    }

    tracing::warn!("[server_get_image_thumbnail] no image found, returning failure");
    GrimoireResponse::failure(
        "no server image configured",
        vec![ErrorDetail::new(
            "no_server_image",
            "no server image configured",
            "neither image_blob_id nor image_path resolved to a readable file",
        )],
    )
}

/// update `[server].name` and/or `[server].description`. either field
/// may be omitted to leave it unchanged.
pub(in crate::admin_dispatch) async fn server_update_info(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let name = opt_str(&args, "name");
    let description = opt_str(&args, "description");
    if name.is_none() && description.is_none() {
        return bad_request("must provide at least one of: name, description");
    }

    let config_path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return internal(format!("could not locate config file: {}", e)),
    };

    let mut updates: Vec<(&str, toml_edit::Value)> = Vec::new();
    if let Some(n) = &name {
        updates.push(("server.name", n.clone().into()));
    }
    if let Some(d) = &description {
        updates.push(("server.description", d.clone().into()));
    }
    if let Err(e) = crate::config::set_config_values(&config_path, &updates) {
        return internal(format!("failed to update config: {}", e));
    }

    // reload cached CONFIG so subsequent reads see the new values
    if let Err(e) = crate::config::init_config(Some(config_path.clone())) {
        return internal(format!("config written but reload failed: {}", e));
    }

    GrimoireResponse::success(
        "server info updated",
        json!({
            "name": name,
            "description": description,
        }),
    )
}

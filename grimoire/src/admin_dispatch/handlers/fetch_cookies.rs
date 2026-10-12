//! yt-dlp cookies.txt management (settings view's "fetch cookies" flyout) -
//! same three operations as the local-only tauri commands in charnel's
//! `commands.rs`, but routed through here too so they also work against a
//! remote target (see `super::handle`'s module doc comment: every command
//! here is reachable both locally and over the `freqhole-admin/1` ALPN).
//!
//! `target_os` rides along in `status()`'s response rather than being a
//! separate command, since the only thing that needs it (the wizard's
//! export-command snippet: PowerShell vs a POSIX shell) is rendered right
//! next to the rest of this status - and critically, it has to be the
//! TARGET machine's os, not the wizard's own (`std::env::consts::OS` here
//! runs on whichever grimoire process actually handles this request -
//! local in-process, or the remote peer's, over ALPN).

use crate::admin_dispatch::helpers::require_str;
use crate::response::GrimoireResponse;
use serde_json::{json, Value as JsonValue};

pub(in crate::admin_dispatch) async fn status() -> GrimoireResponse<JsonValue> {
    let path = crate::fetch_cookies::cookies_path();
    let contents = match crate::fetch_cookies::read_cookies() {
        Ok(c) => c,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to read cookies.txt",
                vec![crate::error::ErrorDetail::from(e)],
            )
        }
    };
    let ytdlp_path = crate::config::get_ytdlp_path(&crate::config::get_config());
    GrimoireResponse::success(
        "ok",
        json!({
            "exists": contents.is_some(),
            "path": path.display().to_string(),
            "data_dir": crate::config::get_config().data_dir.display().to_string(),
            "contents": contents.unwrap_or_default(),
            "ytdlp_path": ytdlp_path,
            "target_os": std::env::consts::OS,
        }),
    )
}

pub(in crate::admin_dispatch) async fn save(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let contents = match require_str(&args, "contents") {
        Ok(v) => v,
        Err(r) => return r,
    };
    match crate::fetch_cookies::write_cookies(&contents) {
        Ok(()) => GrimoireResponse::success("saved", JsonValue::Null),
        Err(e) => GrimoireResponse::failure(
            "failed to save cookies.txt",
            vec![crate::error::ErrorDetail::from(e)],
        ),
    }
}

pub(in crate::admin_dispatch) async fn clear() -> GrimoireResponse<JsonValue> {
    match crate::fetch_cookies::clear_cookies() {
        Ok(()) => GrimoireResponse::success("cleared", JsonValue::Null),
        Err(e) => GrimoireResponse::failure(
            "failed to clear cookies.txt",
            vec![crate::error::ErrorDetail::from(e)],
        ),
    }
}

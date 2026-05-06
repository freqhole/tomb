//! browser-side persistence for the most-recently-connected peer.
//!
//! shares the same IndexedDB (`freqhole_app` / `app_state`) used by
//! `web::identity` and spume. record shape:
//!
//! ```json
//! { "id": "rathole_recent_peer",
//!   "peer_addr": "<iroh node id>",
//!   "connected_at": <epoch ms> }
//! ```
//!
//! deliberately a single-row "last peer" — keeps the spume schema
//! untouched while letting rathole skip the paste step on revisit.

use idb::{Factory, Query, TransactionMode};
use wasm_bindgen::JsValue;

const DB_NAME: &str = "freqhole_app";
const STORE: &str = "app_state";
const KEY: &str = "rathole_recent_peer";

/// load the last peer addr, if any.
pub async fn load_last_peer() -> Option<String> {
    match read().await {
        Ok(v) => v,
        Err(e) => {
            web_sys::console::warn_1(&format!("rathole: peer store read failed: {e:?}").into());
            None
        }
    }
}

/// persist `peer_addr` as the most-recent peer. failures are
/// logged but otherwise ignored — connection still proceeds.
pub async fn save_last_peer(peer_addr: &str) {
    if let Err(e) = write(peer_addr).await {
        web_sys::console::warn_1(&format!("rathole: peer store write failed: {e:?}").into());
    }
}

async fn open_db() -> Result<idb::Database, idb::Error> {
    let factory = Factory::new()?;
    // open with no version: spume manages the `freqhole_app` schema.
    // see web::identity for the full rationale.
    let mut req = factory.open(DB_NAME, None)?;
    req.on_upgrade_needed(|_ev| {});
    req.await
}

async fn read() -> Result<Option<String>, idb::Error> {
    let db = open_db().await?;
    if !db.store_names().iter().any(|n| n == STORE) {
        return Ok(None);
    }
    let tx = db.transaction(&[STORE], TransactionMode::ReadOnly)?;
    let store = tx.object_store(STORE)?;
    let value: Option<JsValue> = store.get(Query::from(JsValue::from_str(KEY)))?.await?;
    Ok(value.and_then(|v| {
        if v.is_undefined() || v.is_null() {
            return None;
        }
        js_sys::Reflect::get(&v, &"peer_addr".into())
            .ok()
            .and_then(|p| p.as_string())
            .filter(|s| !s.is_empty())
    }))
}

async fn write(peer_addr: &str) -> Result<(), idb::Error> {
    let db = open_db().await?;
    if !db.store_names().iter().any(|n| n == STORE) {
        return Ok(());
    }
    let tx = db.transaction(&[STORE], TransactionMode::ReadWrite)?;
    let store = tx.object_store(STORE)?;
    let obj = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&obj, &"id".into(), &JsValue::from_str(KEY));
    let _ = js_sys::Reflect::set(&obj, &"peer_addr".into(), &JsValue::from_str(peer_addr));
    let _ = js_sys::Reflect::set(
        &obj,
        &"connected_at".into(),
        &JsValue::from_f64(js_sys::Date::now()),
    );
    let _ = store.put(&obj, None)?.await?;
    let _ = tx.commit()?.await;
    Ok(())
}

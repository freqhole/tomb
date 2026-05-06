//! browser-side persistence for known remotes (federation peers).
//!
//! mirrors spume's `freqhole_app` → `remotes` object store
//! ([client/spume/src/app/services/storage/db.ts]), so when rathole
//! is served from the same origin both shells see the same remote
//! list. record shape (subset we use):
//!
//! ```json
//! {
//!   "remote_id": "<uuid>",
//!   "transport": "wasm",
//!   "peer_addr": "<iroh node id>",
//!   "name": "my server",
//!   "description": null,
//!   "version": null,
//!   "is_active": true,
//!   "last_connected_at": 1730000000000,
//!   "last_info_check": 1730000000000,
//!   "created_at": 1730000000000,
//!   "updated_at": 1730000000000
//! }
//! ```
//!
//! we deliberately use `transport: "wasm"` to match spume's p2p
//! convention; spume picks the same transport when running in the
//! browser. http remotes (with `transport: "http"`) are visible too
//! but rathole can only connect to p2p ones today, so we filter them
//! out of the list view.

use idb::{Factory, Query, TransactionMode};
use wasm_bindgen::JsValue;

const DB_NAME: &str = "freqhole_app";
const STORE: &str = "remotes";

#[derive(Debug, Clone)]
pub struct Remote {
    pub remote_id: String,
    pub peer_addr: String,
    pub name: Option<String>,
    pub transport: String,
    pub is_active: bool,
    pub last_connected_at: Option<f64>,
}

/// list every saved remote, p2p (`wasm`/`app`) entries first.
pub async fn list_remotes() -> Vec<Remote> {
    match read_all().await {
        Ok(v) => v,
        Err(e) => {
            web_sys::console::warn_1(&format!("rathole: list_remotes failed: {e:?}").into());
            vec![]
        }
    }
}

/// upsert a remote: matches by `peer_addr` (p2p) — if found, update
/// `last_connected_at` + `name`; if not, insert a new uuid-keyed
/// record. when `set_active` is true, also clears `is_active` on all
/// other records so only one remote is active at a time (matches
/// spume's behavior).
pub async fn upsert_remote(
    peer_addr: &str,
    name: Option<&str>,
    set_active: bool,
) -> Result<Remote, String> {
    upsert_inner(peer_addr, name, set_active)
        .await
        .map_err(|e| format!("upsert remote: {e:?}"))
}

/// mark a remote as active by `peer_addr` (clears is_active on others).
pub async fn set_active(peer_addr: &str) -> Result<(), String> {
    upsert_inner(peer_addr, None, true)
        .await
        .map(|_| ())
        .map_err(|e| format!("set_active remote: {e:?}"))
}

/// delete a remote by peer_addr.
pub async fn delete_remote(peer_addr: &str) -> Result<(), String> {
    delete_inner(peer_addr)
        .await
        .map_err(|e| format!("delete remote: {e:?}"))
}

async fn open_db() -> Result<idb::Database, idb::Error> {
    let factory = Factory::new()?;
    // open with no version: spume manages the `freqhole_app` schema
    // (currently v8, with `app_state` + `remotes` stores). hardcoding
    // a version here would either trigger a downgrade error (when
    // spume is ahead) or stomp on spume's stores via an unintended
    // upgrade. callers must tolerate the `remotes` store being
    // missing entirely (e.g. fresh install before spume has run).
    let mut req = factory.open(DB_NAME, None)?;
    req.on_upgrade_needed(|_ev| {});
    req.await
}

async fn read_all() -> Result<Vec<Remote>, idb::Error> {
    let db = open_db().await?;
    if !db.store_names().iter().any(|n| n == STORE) {
        return Ok(vec![]);
    }
    let tx = db.transaction(&[STORE], TransactionMode::ReadOnly)?;
    let store = tx.object_store(STORE)?;
    let all: Vec<JsValue> = store.get_all(None, None)?.await?;
    let mut out: Vec<Remote> = all.iter().filter_map(decode_remote).collect();
    // p2p first, then alphabetical-ish by name.
    out.sort_by(|a, b| {
        let a_p2p = a.transport == "wasm" || a.transport == "app";
        let b_p2p = b.transport == "wasm" || b.transport == "app";
        b_p2p.cmp(&a_p2p).then_with(|| {
            a.name
                .as_deref()
                .unwrap_or("")
                .cmp(b.name.as_deref().unwrap_or(""))
        })
    });
    Ok(out)
}

async fn upsert_inner(
    peer_addr: &str,
    name: Option<&str>,
    set_active: bool,
) -> Result<Remote, idb::Error> {
    let db = open_db().await?;
    if !db.store_names().iter().any(|n| n == STORE) {
        // spume hasn't initialized the remotes store yet. return a
        // synthetic record so the in-memory view is still useful;
        // we'll persist properly once spume runs at least once.
        let now = js_sys::Date::now();
        return Ok(Remote {
            remote_id: uuid_v4(),
            peer_addr: peer_addr.to_string(),
            name: name.map(|s| s.to_string()),
            transport: "wasm".to_string(),
            is_active: set_active,
            last_connected_at: Some(now),
        });
    }
    let tx = db.transaction(&[STORE], TransactionMode::ReadWrite)?;
    let store = tx.object_store(STORE)?;

    let all: Vec<JsValue> = store.get_all(None, None)?.await?;
    let now = js_sys::Date::now();
    let mut existing_key: Option<JsValue> = None;
    let mut existing_record: Option<JsValue> = None;

    // first pass: clear is_active on everything else (when toggling),
    // and find a matching record by peer_addr.
    for v in &all {
        let p = js_string(v, "peer_addr").unwrap_or_default();
        let id = js_string(v, "remote_id").unwrap_or_default();
        if p == peer_addr {
            existing_key = Some(JsValue::from_str(&id));
            existing_record = Some(v.clone());
            continue;
        }
        if set_active {
            let was_active = js_sys::Reflect::get(v, &"is_active".into())
                .ok()
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
            if was_active {
                let _ = js_sys::Reflect::set(v, &"is_active".into(), &JsValue::FALSE);
                let _ = js_sys::Reflect::set(v, &"updated_at".into(), &JsValue::from_f64(now));
                let _ = store.put(v, None)?.await?;
            }
        }
    }

    let record = existing_record.unwrap_or_else(|| {
        let obj = js_sys::Object::new();
        let new_id = uuid_v4();
        let _ = js_sys::Reflect::set(&obj, &"remote_id".into(), &JsValue::from_str(&new_id));
        let _ = js_sys::Reflect::set(&obj, &"transport".into(), &JsValue::from_str("wasm"));
        let _ = js_sys::Reflect::set(&obj, &"peer_addr".into(), &JsValue::from_str(peer_addr));
        let _ = js_sys::Reflect::set(&obj, &"created_at".into(), &JsValue::from_f64(now));
        obj.into()
    });

    if let Some(n) = name {
        let _ = js_sys::Reflect::set(&record, &"name".into(), &JsValue::from_str(n));
    } else if existing_key.is_none() {
        // give a placeholder so the list view has *something* to show.
        let placeholder = format!("{}\u{2026}", &peer_addr[..peer_addr.len().min(8)]);
        let _ = js_sys::Reflect::set(&record, &"name".into(), &JsValue::from_str(&placeholder));
    }
    let _ = js_sys::Reflect::set(
        &record,
        &"is_active".into(),
        &JsValue::from_bool(set_active),
    );
    let _ = js_sys::Reflect::set(
        &record,
        &"last_connected_at".into(),
        &JsValue::from_f64(now),
    );
    let _ = js_sys::Reflect::set(&record, &"updated_at".into(), &JsValue::from_f64(now));

    let _ = store.put(&record, None)?.await?;
    let _ = tx.commit()?.await;

    Ok(decode_remote(&record).unwrap_or_else(|| Remote {
        remote_id: String::new(),
        peer_addr: peer_addr.to_string(),
        name: name.map(|s| s.to_string()),
        transport: "wasm".to_string(),
        is_active: set_active,
        last_connected_at: Some(now),
    }))
}

async fn delete_inner(peer_addr: &str) -> Result<(), idb::Error> {
    let db = open_db().await?;
    if !db.store_names().iter().any(|n| n == STORE) {
        return Ok(());
    }
    let tx = db.transaction(&[STORE], TransactionMode::ReadWrite)?;
    let store = tx.object_store(STORE)?;
    let all: Vec<JsValue> = store.get_all(None, None)?.await?;
    for v in &all {
        let p = js_string(v, "peer_addr").unwrap_or_default();
        if p == peer_addr {
            let id = js_string(v, "remote_id").unwrap_or_default();
            if !id.is_empty() {
                let _ = store.delete(Query::from(JsValue::from_str(&id)))?.await?;
            }
        }
    }
    let _ = tx.commit()?.await;
    Ok(())
}

fn decode_remote(v: &JsValue) -> Option<Remote> {
    if v.is_undefined() || v.is_null() {
        return None;
    }
    let remote_id = js_string(v, "remote_id")?;
    let peer_addr = js_string(v, "peer_addr").unwrap_or_default();
    if peer_addr.is_empty() {
        return None;
    }
    let name = js_string(v, "name").filter(|s| !s.is_empty());
    let transport = js_string(v, "transport").unwrap_or_else(|| "wasm".to_string());
    let is_active = js_sys::Reflect::get(v, &"is_active".into())
        .ok()
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    let last_connected_at = js_sys::Reflect::get(v, &"last_connected_at".into())
        .ok()
        .and_then(|x| x.as_f64());
    Some(Remote {
        remote_id,
        peer_addr,
        name,
        transport,
        is_active,
        last_connected_at,
    })
}

fn js_string(v: &JsValue, key: &str) -> Option<String> {
    js_sys::Reflect::get(v, &key.into())
        .ok()
        .and_then(|x| x.as_string())
}

/// minimal uuidv4 using `crypto.getRandomValues`. matches the
/// canonical `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` form.
fn uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    let arr = js_sys::Uint8Array::new_with_length(16);
    if let Some(crypto) = web_sys::window().and_then(|w| w.crypto().ok()) {
        let _ = crypto.get_random_values_with_js_u8_array(&arr);
        arr.copy_to(&mut bytes);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3],
        bytes[4], bytes[5],
        bytes[6], bytes[7],
        bytes[8], bytes[9],
        bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

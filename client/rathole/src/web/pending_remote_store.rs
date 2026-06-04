//! browser-side persistence for pending remote connection attempts.
//!
//! mirrors spume's `freqhole_app` → `pending_remotes` object store
//! ([client/spume/src/app/services/storage/db.ts]), so both shells see
//! the same pending list when running on the same origin.
//!
//! record shape:
//! ```json
//! {
//!   "id": "<uuid>",
//!   "peer_addr": "<url or iroh node id>",
//!   "transport": "http",
//!   "stage": "knock_pending",
//!   "created_at": 1730000000000,
//!   "updated_at": 1730000000000,
//!   "server_name": null,
//!   "knock_id": null,
//!   "knock_username": null,
//!   "knock_message": null,
//!   "invite_code": null,
//!   "error_message": null
//! }
//! ```
//!
//! we open the db with no target version (same policy as remote_store.rs)
//! so spume remains the schema owner and we never trigger a spurious
//! upgrade. if the store is missing (before spume has initialised the
//! db) every operation is a graceful no-op.

use idb::{Factory, TransactionMode};
use wasm_bindgen::JsValue;

const DB_NAME: &str = "freqhole_app";
const STORE: &str = "pending_remotes";

#[derive(Debug, Clone)]
pub struct PendingRemote {
    pub id: String,
    pub peer_addr: String,
    pub transport: String,
    pub stage: String,
    pub created_at: f64,
    pub updated_at: f64,
    pub server_name: Option<String>,
    pub knock_id: Option<String>,
    pub knock_username: Option<String>,
    pub knock_message: Option<String>,
    pub invite_code: Option<String>,
    pub error_message: Option<String>,
}

/// list all pending remotes, sorted by `created_at` ascending.
pub async fn list_pending_remotes() -> Vec<PendingRemote> {
    match read_all().await {
        Ok(mut v) => {
            v.sort_by(|a, b| {
                a.created_at
                    .partial_cmp(&b.created_at)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            v
        }
        Err(e) => {
            web_sys::console::warn_1(
                &format!("rathole: list_pending_remotes failed: {e:?}").into(),
            );
            vec![]
        }
    }
}

/// get a single pending remote by id.
pub async fn get_pending_remote(id: &str) -> Option<PendingRemote> {
    list_pending_remotes()
        .await
        .into_iter()
        .find(|e| e.id == id)
}

/// get a pending remote by peer_addr.
pub async fn get_pending_remote_by_peer_addr(peer_addr: &str) -> Option<PendingRemote> {
    list_pending_remotes()
        .await
        .into_iter()
        .find(|e| e.peer_addr == peer_addr)
}

/// create a new pending remote. if a record with the same `peer_addr`
/// already exists it is returned without creating a duplicate.
pub async fn create_pending_remote(
    peer_addr: &str,
    transport: &str,
    stage: &str,
    invite_code: Option<&str>,
    knock_username: Option<&str>,
    knock_message: Option<&str>,
) -> Result<PendingRemote, String> {
    // check for existing record to avoid duplicates
    if let Some(existing) = get_pending_remote_by_peer_addr(peer_addr).await {
        return Ok(existing);
    }

    create_inner(
        peer_addr,
        transport,
        stage,
        invite_code,
        knock_username,
        knock_message,
    )
    .await
    .map_err(|e| format!("create pending remote: {e:?}"))
}

/// update stage (and optional fields) for an existing pending remote.
pub async fn update_pending_remote(
    id: &str,
    stage: &str,
    error_message: Option<&str>,
    knock_id: Option<&str>,
    server_name: Option<&str>,
) -> Result<Option<PendingRemote>, String> {
    update_inner(id, stage, error_message, knock_id, server_name)
        .await
        .map_err(|e| format!("update pending remote: {e:?}"))
}

/// delete a pending remote by id.
pub async fn delete_pending_remote(id: &str) -> Result<(), String> {
    delete_inner(id)
        .await
        .map_err(|e| format!("delete pending remote: {e:?}"))
}

async fn open_db() -> Result<idb::Database, idb::Error> {
    let factory = Factory::new()?;
    let mut req = factory.open(DB_NAME, None)?;
    req.on_upgrade_needed(|_ev| {});
    req.await
}

fn now_ms() -> f64 {
    js_sys::Date::now()
}

async fn read_all() -> Result<Vec<PendingRemote>, idb::Error> {
    let db = open_db().await?;
    if !db.store_names().iter().any(|n| n == STORE) {
        return Ok(vec![]);
    }
    let tx = db.transaction(&[STORE], TransactionMode::ReadOnly)?;
    let store = tx.object_store(STORE)?;
    let all: Vec<JsValue> = store.get_all(None, None)?.await?;
    Ok(all.iter().filter_map(decode_pending).collect())
}

async fn create_inner(
    peer_addr: &str,
    transport: &str,
    stage: &str,
    invite_code: Option<&str>,
    knock_username: Option<&str>,
    knock_message: Option<&str>,
) -> Result<PendingRemote, idb::Error> {
    let db = open_db().await?;
    if !db.store_names().iter().any(|n| n == STORE) {
        return Err(idb::Error::StoreNotFound(STORE.into()));
    }

    let id = uuid_v4();
    let now = now_ms();

    let obj = js_sys::Object::new();
    set_str(&obj, "id", &id);
    set_str(&obj, "peer_addr", peer_addr);
    set_str(&obj, "transport", transport);
    set_str(&obj, "stage", stage);
    set_num(&obj, "created_at", now);
    set_num(&obj, "updated_at", now);
    set_opt_str(&obj, "server_name", None);
    set_opt_str(&obj, "knock_id", None);
    set_opt_str(&obj, "knock_username", knock_username);
    set_opt_str(&obj, "knock_message", knock_message);
    set_opt_str(&obj, "invite_code", invite_code);
    set_opt_str(&obj, "error_message", None);

    let tx = db.transaction(&[STORE], TransactionMode::ReadWrite)?;
    let store = tx.object_store(STORE)?;
    store.put(&JsValue::from(&obj), None)?.await?;
    tx.commit()?.await?;

    Ok(PendingRemote {
        id,
        peer_addr: peer_addr.to_string(),
        transport: transport.to_string(),
        stage: stage.to_string(),
        created_at: now,
        updated_at: now,
        server_name: None,
        knock_id: None,
        knock_username: knock_username.map(|s| s.to_string()),
        knock_message: knock_message.map(|s| s.to_string()),
        invite_code: invite_code.map(|s| s.to_string()),
        error_message: None,
    })
}

async fn update_inner(
    id: &str,
    stage: &str,
    error_message: Option<&str>,
    knock_id: Option<&str>,
    server_name: Option<&str>,
) -> Result<Option<PendingRemote>, idb::Error> {
    let db = open_db().await?;
    if !db.store_names().iter().any(|n| n == STORE) {
        return Ok(None);
    }

    let tx = db.transaction(&[STORE], TransactionMode::ReadWrite)?;
    let store = tx.object_store(STORE)?;

    let key = JsValue::from_str(id);
    let existing: Option<JsValue> = store.get(idb::Query::Key(key.clone()))?.await?;
    let Some(val) = existing else { return Ok(None) };

    let obj: js_sys::Object = val.unchecked_into();
    let now = now_ms();

    set_str(&obj, "stage", stage);
    set_num(&obj, "updated_at", now);
    if let Some(msg) = error_message {
        set_opt_str(&obj, "error_message", Some(msg));
    }
    if let Some(kid) = knock_id {
        set_opt_str(&obj, "knock_id", Some(kid));
    }
    if let Some(name) = server_name {
        set_opt_str(&obj, "server_name", Some(name));
    }

    store.put(&JsValue::from(&obj), None)?.await?;
    tx.commit()?.await?;

    let updated = decode_pending(&JsValue::from(&obj));
    Ok(updated)
}

async fn delete_inner(id: &str) -> Result<(), idb::Error> {
    let db = open_db().await?;
    if !db.store_names().iter().any(|n| n == STORE) {
        return Ok(());
    }
    let tx = db.transaction(&[STORE], TransactionMode::ReadWrite)?;
    let store = tx.object_store(STORE)?;
    let key = JsValue::from_str(id);
    store.delete(idb::Query::Key(key))?.await?;
    tx.commit()?.await?;
    Ok(())
}

fn decode_pending(val: &JsValue) -> Option<PendingRemote> {
    Some(PendingRemote {
        id: js_str(val, "id")?,
        peer_addr: js_str(val, "peer_addr")?,
        transport: js_str(val, "transport").unwrap_or_else(|| "http".into()),
        stage: js_str(val, "stage").unwrap_or_else(|| "unknown".into()),
        created_at: js_num(val, "created_at").unwrap_or(0.0),
        updated_at: js_num(val, "updated_at").unwrap_or(0.0),
        server_name: js_str(val, "server_name"),
        knock_id: js_str(val, "knock_id"),
        knock_username: js_str(val, "knock_username"),
        knock_message: js_str(val, "knock_message"),
        invite_code: js_str(val, "invite_code"),
        error_message: js_str(val, "error_message"),
    })
}

fn js_str(val: &JsValue, field: &str) -> Option<String> {
    js_sys::Reflect::get(val, &JsValue::from_str(field))
        .ok()
        .and_then(|v| {
            if v.is_null() || v.is_undefined() {
                None
            } else {
                v.as_string()
            }
        })
}

fn js_num(val: &JsValue, field: &str) -> Option<f64> {
    js_sys::Reflect::get(val, &JsValue::from_str(field))
        .ok()
        .and_then(|v| v.as_f64())
}

fn set_str(obj: &js_sys::Object, field: &str, value: &str) {
    let _ = js_sys::Reflect::set(obj, &JsValue::from_str(field), &JsValue::from_str(value));
}

fn set_num(obj: &js_sys::Object, field: &str, value: f64) {
    let _ = js_sys::Reflect::set(obj, &JsValue::from_str(field), &JsValue::from_f64(value));
}

fn set_opt_str(obj: &js_sys::Object, field: &str, value: Option<&str>) {
    let js_val = match value {
        Some(s) => JsValue::from_str(s),
        None => JsValue::null(),
    };
    let _ = js_sys::Reflect::set(obj, &JsValue::from_str(field), &js_val);
}

/// minimal uuidv4 using `crypto.getRandomValues`.
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

//! browser-side iroh keypair persistence in IndexedDB.
//!
//! schema deliberately mirrors spume's
//! `client/spume/src/app/services/storage/db.ts`:
//!
//! - database: `freqhole_app`
//! - object store: `app_state` (keyPath: `id`)
//! - record key: `"p2p_identity"`
//! - value shape: `{ id, secret_key: Uint8Array, node_id, created_at }`
//!
//! when rathole is served from the same origin as spume (e.g. behind
//! the freqhole server itself), the two shells transparently share
//! the same iroh node identity. otherwise rathole keeps its own
//! identity in its own origin-scoped database — same code, different
//! storage bucket.

use idb::{Factory, Query, TransactionMode};
use js_sys::Uint8Array;
use midden::MiddenNode;
use wasm_bindgen::{JsCast, JsValue};

const DB_NAME: &str = "freqhole_app";
const STORE: &str = "app_state";
const KEY: &str = "p2p_identity";

struct StoredIdentity {
    secret_key: Vec<u8>,
    node_id: String,
}

/// load a persisted iroh keypair from IDB and rebuild the node from
/// it; if none exists, generate a fresh one and persist it. returns
/// `(node, node_id)`.
pub async fn load_or_create_node() -> Result<(MiddenNode, String), JsValue> {
    let stored = read_identity().await.map_err(idb_err)?;

    if let Some(existing) = stored {
        web_sys::console::log_1(
            &format!(
                "rathole: restoring iroh identity from IndexedDB ({}…)",
                short(&existing.node_id)
            )
            .into(),
        );
        web_sys::console::log_1(&format!("rathole: full node_id: {}", existing.node_id).into());
        let node = MiddenNode::create_from_key(&existing.secret_key)
            .await
            .map_err(|e| JsValue::from_str(&format!("create_from_key: {e:?}")))?;
        let node_id = node.node_id();
        return Ok((node, node_id));
    }

    let node = MiddenNode::create()
        .await
        .map_err(|e| JsValue::from_str(&format!("MiddenNode::create: {e:?}")))?;
    let node_id = node.node_id();
    let secret = node.secret_key().to_vec();
    if let Err(e) = write_identity(&secret, &node_id).await {
        web_sys::console::warn_1(
            &format!("rathole: failed to persist iroh identity: {e:?}").into(),
        );
    } else {
        web_sys::console::log_1(
            &format!(
                "rathole: persisted new iroh identity to IndexedDB ({}…)",
                short(&node_id)
            )
            .into(),
        );
        web_sys::console::log_1(&format!("rathole: full node_id: {}", node_id).into());
    }
    Ok((node, node_id))
}

async fn open_db() -> Result<idb::Database, idb::Error> {
    let factory = Factory::new()?;
    // open with no version: spume manages the `freqhole_app` schema
    // (currently v8). hardcoding a version here would either trigger
    // a downgrade error (when spume is ahead) or stomp on spume's
    // stores via an unintended upgrade. callers must tolerate the
    // `app_state` store being missing on first run.
    let mut req = factory.open(DB_NAME, None)?;
    req.on_upgrade_needed(|_ev| {});
    req.await
}

async fn read_identity() -> Result<Option<StoredIdentity>, idb::Error> {
    let db = open_db().await?;
    if !db.store_names().iter().any(|n| n == STORE) {
        return Ok(None);
    }
    let tx = db.transaction(&[STORE], TransactionMode::ReadOnly)?;
    let store = tx.object_store(STORE)?;
    let value: Option<JsValue> = store.get(Query::from(JsValue::from_str(KEY)))?.await?;
    Ok(value.and_then(decode))
}

async fn write_identity(secret: &[u8], node_id: &str) -> Result<(), idb::Error> {
    let db = open_db().await?;
    if !db.store_names().iter().any(|n| n == STORE) {
        // spume hasn't initialized yet; skip persistence rather than
        // racing it with our own schema.
        return Ok(());
    }
    let tx = db.transaction(&[STORE], TransactionMode::ReadWrite)?;
    let store = tx.object_store(STORE)?;

    // mirror spume's value shape: real `Uint8Array` for `secret_key`
    // so spume's typed code reads it without coercion.
    let obj = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&obj, &"id".into(), &JsValue::from_str(KEY));
    let bytes = Uint8Array::from(secret);
    let _ = js_sys::Reflect::set(&obj, &"secret_key".into(), &bytes.into());
    let _ = js_sys::Reflect::set(&obj, &"node_id".into(), &JsValue::from_str(node_id));
    let _ = js_sys::Reflect::set(
        &obj,
        &"created_at".into(),
        &JsValue::from_f64(js_sys::Date::now()),
    );

    let _ = store.put(&obj, None)?.await?;
    let _ = tx.commit()?.await;
    Ok(())
}

fn decode(v: JsValue) -> Option<StoredIdentity> {
    if v.is_undefined() || v.is_null() {
        return None;
    }
    let node_id = js_sys::Reflect::get(&v, &"node_id".into())
        .ok()?
        .as_string()?;
    let key_js = js_sys::Reflect::get(&v, &"secret_key".into()).ok()?;
    let bytes = if let Ok(arr) = key_js.clone().dyn_into::<Uint8Array>() {
        arr.to_vec()
    } else if let Ok(arr) = key_js.dyn_into::<js_sys::Array>() {
        arr.iter()
            .filter_map(|v| v.as_f64().map(|n| n as u8))
            .collect()
    } else {
        return None;
    };
    if bytes.len() != 32 {
        return None;
    }
    Some(StoredIdentity {
        secret_key: bytes,
        node_id,
    })
}

fn idb_err(e: idb::Error) -> JsValue {
    JsValue::from_str(&format!("indexeddb: {e:?}"))
}

fn short(s: &str) -> &str {
    if s.len() <= 16 {
        s
    } else {
        &s[..16]
    }
}

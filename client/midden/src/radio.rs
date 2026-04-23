//! browser-side radio listener.
//!
//! `tune_radio(node_id, on_chunk)` connects to a freqhole node on the
//! `freqhole-radio/1` ALPN, accepts the server's audio uni stream, parses
//! chunks using the same `[u32 BE seq][u32 BE len][bytes]` framing as
//! [`grimoire::radio::protocol`], and invokes the JS callback per chunk.
//!
//! intentionally tiny — phase 1 will add a control stream and `on_meta`
//! callbacks. for phase 0 the high bit of `seq` doubles as `is_init`, which
//! is enough for the demo page to drive MSE soft-resets on track changes.

use crate::{parse_peer_addr, to_js_err, MiddenNode};
use iroh::endpoint::{Connection, RecvStream};
use js_sys::{Function as JsFunction, Uint8Array};
use std::cell::RefCell;
use std::rc::Rc;
use tracing::{debug, info, warn};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};

/// must match `grimoire::radio::protocol::RADIO_ALPN`.
const RADIO_ALPN: &[u8] = b"freqhole-radio/1";

/// high bit of the wire `seq` field flags init segments. matches
/// `grimoire::radio::protocol::INIT_FLAG`.
const INIT_FLAG: u32 = 0x8000_0000;

/// hard cap on a single chunk to avoid runaway allocations on a malformed peer.
const MAX_CHUNK_BYTES: u32 = 16 * 1024 * 1024;

/// handle returned to JS for a tuned-in radio session. dropping the handle
/// (or calling `leave()`) cancels the read loop and closes the connection.
#[wasm_bindgen]
pub struct RadioHandle {
    inner: Rc<RefCell<Option<Connection>>>,
}

#[wasm_bindgen]
impl RadioHandle {
    /// stop receiving audio and close the connection.
    pub fn leave(&self) {
        if let Some(conn) = self.inner.borrow_mut().take() {
            info!("[radio] leaving station");
            conn.close(0u32.into(), b"client leaving");
        }
    }
}

#[wasm_bindgen]
impl MiddenNode {
    /// connect to a freqhole radio broadcaster and start receiving audio chunks.
    ///
    /// `on_chunk(seq: number, is_init: boolean, bytes: Uint8Array)` is
    /// invoked once per chunk. `seq` is the broadcaster's sequence counter
    /// (resets per connection in phase 0). `is_init = true` marks the start
    /// of a new track — the JS side should soft-reset MSE before appending.
    ///
    /// returns a [`RadioHandle`] — keep a reference to it; dropping it stops
    /// playback and closes the iroh connection.
    pub async fn tune_radio(
        &self,
        peer_addr: &str,
        on_chunk: &JsFunction,
    ) -> Result<RadioHandle, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        info!("[radio] connecting to broadcaster...");
        let conn = self
            .endpoint
            .connect(addr, RADIO_ALPN)
            .await
            .map_err(to_js_err)?;

        info!("[radio] accepting audio stream...");
        let mut recv = conn.accept_uni().await.map_err(to_js_err)?;

        let inner = Rc::new(RefCell::new(Some(conn)));
        let inner_for_loop = inner.clone();
        let cb = on_chunk.clone();

        wasm_bindgen_futures::spawn_local(async move {
            if let Err(e) = read_loop(&mut recv, &cb).await {
                warn!("[radio] read loop ended: {e}");
            }
            // make sure the handle reflects that the session is over so a
            // later leave() is a no-op.
            inner_for_loop.borrow_mut().take();
        });

        Ok(RadioHandle { inner })
    }
}

async fn read_loop(recv: &mut RecvStream, cb: &JsFunction) -> Result<(), String> {
    loop {
        let mut header = [0u8; 8];
        match recv.read_exact(&mut header).await {
            Ok(_) => {}
            Err(e) => {
                let s = e.to_string();
                if s.contains("finished") || s.contains("closed") || s.contains("eof") {
                    debug!("[radio] stream closed cleanly");
                    return Ok(());
                }
                return Err(format!("read header: {e}"));
            }
        }

        let wire_seq = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
        let len = u32::from_be_bytes([header[4], header[5], header[6], header[7]]);

        if len > MAX_CHUNK_BYTES {
            return Err(format!("chunk too large: {len} bytes"));
        }

        let mut body = vec![0u8; len as usize];
        recv.read_exact(&mut body)
            .await
            .map_err(|e| format!("read body ({len}): {e}"))?;

        let is_init = wire_seq & INIT_FLAG != 0;
        let seq = wire_seq & !INIT_FLAG;

        let bytes = Uint8Array::from(&body[..]);
        let this = JsValue::NULL;
        if let Err(e) = cb.call3(
            &this,
            &JsValue::from_f64(seq as f64),
            &JsValue::from_bool(is_init),
            &bytes,
        ) {
            warn!("[radio] on_chunk callback threw: {e:?}");
            // keep going; one bad call shouldn't tear down the whole session.
        }
    }
}

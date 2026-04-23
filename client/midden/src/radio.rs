//! browser-side radio listener.
//!
//! `tune_radio(peer_addr, on_hello, on_meta, on_chunk)` connects to a
//! freqhole node on the `freqhole-radio/1` ALPN, opens a control bidi
//! stream + an audio uni stream, and pumps:
//!
//! - the `Hello` control message → `on_hello(json_string)`
//! - subsequent `Meta` control messages → `on_meta(json_string)`
//! - audio chunks → `on_chunk(seq, is_init, bytes)`
//!
//! the JS side parses the control JSON itself (avoids serde-wasm-bindgen
//! roundtrips and keeps midden agnostic about message shape).

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

/// hard cap on a single audio chunk to avoid runaway allocations on a
/// malformed peer.
const MAX_CHUNK_BYTES: u32 = 16 * 1024 * 1024;

/// hard cap on a single control message (must match server side).
const MAX_CONTROL_BYTES: u32 = 1024 * 1024;

/// handle returned to JS for a tuned-in radio session. dropping the handle
/// (or calling `leave()`) closes the iroh connection, which tears down both
/// read loops.
#[wasm_bindgen]
pub struct RadioHandle {
    inner: Rc<RefCell<Option<Connection>>>,
}

#[wasm_bindgen]
impl RadioHandle {
    /// stop receiving audio + meta and close the connection.
    pub fn leave(&self) {
        if let Some(conn) = self.inner.borrow_mut().take() {
            info!("[radio] leaving station");
            conn.close(0u32.into(), b"client leaving");
        }
    }
}

#[wasm_bindgen]
impl MiddenNode {
    /// connect to a freqhole radio broadcaster.
    ///
    /// callbacks (all called from JS land):
    /// - `on_hello(json: string)` — fires once when the server's Hello
    ///   message arrives. payload is the JSON-encoded `HelloMessage`.
    /// - `on_meta(json: string)` — fires on each track change with the
    ///   JSON-encoded `MetaMessage`.
    /// - `on_chunk(seq: number, is_init: boolean, bytes: Uint8Array)` —
    ///   fires per audio chunk. `is_init = true` marks the start of a new
    ///   track; the JS side should append it to the same SourceBuffer.
    ///
    /// returns a [`RadioHandle`] — keep a reference to it; dropping it stops
    /// playback and closes the iroh connection.
    pub async fn tune_radio(
        &self,
        peer_addr: &str,
        on_hello: &JsFunction,
        on_meta: &JsFunction,
        on_chunk: &JsFunction,
    ) -> Result<RadioHandle, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        info!("[radio] connecting to broadcaster...");
        let conn = self
            .endpoint
            .connect(addr, RADIO_ALPN)
            .await
            .map_err(to_js_err)?;

        // open control bidi stream FIRST, send Tune, then expect Hello.
        info!("[radio] opening control stream...");
        let (mut ctrl_send, mut ctrl_recv) = conn.open_bi().await.map_err(to_js_err)?;

        // Tune message: shape `{ "type": "tune" }`. server ignores body in
        // phase 1 but we keep the wire format aligned.
        let tune_body = b"{\"type\":\"tune\"}";
        let tune_len = (tune_body.len() as u32).to_be_bytes();
        ctrl_send
            .write_all(&tune_len)
            .await
            .map_err(|e| JsError::new(&format!("tune len: {e}")))?;
        ctrl_send
            .write_all(tune_body)
            .await
            .map_err(|e| JsError::new(&format!("tune body: {e}")))?;

        // read Hello.
        let hello_json = read_control_json(&mut ctrl_recv)
            .await
            .map_err(|e| JsError::new(&format!("read hello: {e}")))?
            .ok_or_else(|| JsError::new("control stream closed before Hello"))?;
        let hello_str = String::from_utf8(hello_json)
            .map_err(|e| JsError::new(&format!("hello not utf8: {e}")))?;
        if let Err(e) = on_hello.call1(&JsValue::NULL, &JsValue::from_str(&hello_str)) {
            warn!("[radio] on_hello callback threw: {e:?}");
        }

        // accept the audio uni stream the server opens after Hello.
        info!("[radio] accepting audio stream...");
        let mut audio_recv = conn.accept_uni().await.map_err(to_js_err)?;

        let inner = Rc::new(RefCell::new(Some(conn)));

        // audio task
        {
            let inner = inner.clone();
            let cb = on_chunk.clone();
            wasm_bindgen_futures::spawn_local(async move {
                if let Err(e) = audio_loop(&mut audio_recv, &cb).await {
                    warn!("[radio] audio loop ended: {e}");
                }
                inner.borrow_mut().take();
            });
        }

        // meta task — keeps reading control messages after Hello.
        {
            let inner = inner.clone();
            let cb = on_meta.clone();
            // we move the SendStream in but never write to it again; phase 2
            // can use it for client → server commands (skip, request, etc).
            let _ = ctrl_send;
            wasm_bindgen_futures::spawn_local(async move {
                if let Err(e) = meta_loop(&mut ctrl_recv, &cb).await {
                    warn!("[radio] meta loop ended: {e}");
                }
                inner.borrow_mut().take();
            });
        }

        Ok(RadioHandle { inner })
    }
}

async fn audio_loop(recv: &mut RecvStream, cb: &JsFunction) -> Result<(), String> {
    loop {
        let mut header = [0u8; 8];
        match recv.read_exact(&mut header).await {
            Ok(_) => {}
            Err(e) => {
                let s = e.to_string();
                if s.contains("finished") || s.contains("closed") || s.contains("eof") {
                    debug!("[radio] audio stream closed cleanly");
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
        if let Err(e) = cb.call3(
            &JsValue::NULL,
            &JsValue::from_f64(seq as f64),
            &JsValue::from_bool(is_init),
            &bytes,
        ) {
            warn!("[radio] on_chunk callback threw: {e:?}");
            // keep going; one bad call shouldn't tear down the whole session.
        }
    }
}

async fn meta_loop(recv: &mut RecvStream, cb: &JsFunction) -> Result<(), String> {
    loop {
        let body = match read_control_json(recv).await? {
            Some(b) => b,
            None => return Ok(()),
        };
        let s = String::from_utf8(body).map_err(|e| format!("meta not utf8: {e}"))?;
        if let Err(e) = cb.call1(&JsValue::NULL, &JsValue::from_str(&s)) {
            warn!("[radio] on_meta callback threw: {e:?}");
        }
    }
}

/// read one length-prefixed JSON message off `recv`. returns `Ok(None)` on
/// a clean EOF between messages.
async fn read_control_json(recv: &mut RecvStream) -> Result<Option<Vec<u8>>, String> {
    let mut header = [0u8; 4];
    match recv.read_exact(&mut header).await {
        Ok(_) => {}
        Err(e) => {
            let s = e.to_string();
            if s.contains("finished") || s.contains("closed") || s.contains("eof") {
                return Ok(None);
            }
            return Err(format!("read control len: {e}"));
        }
    }
    let len = u32::from_be_bytes(header);
    if len > MAX_CONTROL_BYTES {
        return Err(format!("control message too large: {len} bytes"));
    }
    let mut body = vec![0u8; len as usize];
    recv.read_exact(&mut body)
        .await
        .map_err(|e| format!("read control body ({len}): {e}"))?;
    Ok(Some(body))
}

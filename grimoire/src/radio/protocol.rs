//! `freqhole-radio/1` ALPN constant + chunk framing helpers.
//!
//! framing on the chunk stream is deliberately tiny so phase 1 can graft a
//! control stream alongside without changing this layout:
//!
//! ```text
//! [u32 BE seq] [u32 BE len] [len bytes of fMP4]
//! [u32 BE seq] [u32 BE len] [len bytes of fMP4]
//! ...
//! ```
//!
//! the high bit of `seq` doubles as the `is_init` flag so phase 0 doesn't
//! need a separate control message to announce track changes. clients that
//! see the high bit set should soft-reset MSE before appending.

use crate::error::{GrimoireError, GrimoireResult};
use crate::radio::chunk::Chunk;
use crate::radio::messages::ControlMessage;
use iroh::endpoint::{RecvStream, SendStream};

/// ALPN identifier for the radio protocol.
pub const RADIO_ALPN: &[u8] = b"freqhole-radio/1";

/// bit set in the wire `seq` field when a chunk is an init segment.
const INIT_FLAG: u32 = 0x8000_0000;

/// hard cap on a single chunk's payload size. fMP4 fragments at 192 kbps with
/// 3s `frag_duration` are ~50 kB; allow plenty of headroom but reject obvious
/// garbage so a malformed peer can't make us allocate gigabytes.
const MAX_CHUNK_BYTES: u32 = 16 * 1024 * 1024;

/// hard cap on a single control message.
///
/// now-playing art is encoded inline as base64 JSON. with large covers and
/// thumbnail fallbacks this can exceed 1 MiB, so keep a larger frame cap while
/// still bounding allocations against malformed peers.
const MAX_CONTROL_BYTES: u32 = 10 * 1024 * 1024;

/// write a single chunk to a uni stream using the framing above.
pub async fn write_chunk(stream: &mut SendStream, chunk: &Chunk) -> GrimoireResult<()> {
    let mut wire_seq = chunk.seq & !INIT_FLAG;
    if chunk.is_init {
        wire_seq |= INIT_FLAG;
    }
    let len = chunk.bytes.len() as u32;

    stream
        .write_all(&wire_seq.to_be_bytes())
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("radio: failed to write chunk seq: {e}"),
        })?;
    stream
        .write_all(&len.to_be_bytes())
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("radio: failed to write chunk len: {e}"),
        })?;
    stream
        .write_all(&chunk.bytes)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("radio: failed to write chunk body: {e}"),
        })?;

    Ok(())
}

/// read a single chunk off a uni stream. returns `Ok(None)` on clean EOF
/// (server closed the stream between chunks).
pub async fn read_chunk(stream: &mut RecvStream) -> GrimoireResult<Option<Chunk>> {
    let mut header = [0u8; 8];
    match stream.read_exact(&mut header).await {
        Ok(_) => {}
        Err(e) => {
            // ReadExactError doesn't expose a structured EOF variant we can
            // match on cleanly across iroh versions; the existing midden
            // codebase uses string sniffing for the same case, so do the
            // same here.
            let s = e.to_string();
            if s.contains("finished") || s.contains("closed") || s.contains("eof") {
                return Ok(None);
            }
            return Err(GrimoireError::FederationApiError {
                message: format!("radio: failed to read chunk header: {e}"),
            });
        }
    }
    let wire_seq = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
    let len = u32::from_be_bytes([header[4], header[5], header[6], header[7]]);

    if len > MAX_CHUNK_BYTES {
        return Err(GrimoireError::FederationApiError {
            message: format!("radio: chunk too large: {len} bytes (max {MAX_CHUNK_BYTES})"),
        });
    }

    let mut body = vec![0u8; len as usize];
    stream
        .read_exact(&mut body)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("radio: failed to read chunk body ({len} bytes): {e}"),
        })?;

    let is_init = wire_seq & INIT_FLAG != 0;
    let seq = wire_seq & !INIT_FLAG;
    Ok(Some(Chunk {
        seq,
        is_init,
        bytes: body.into(),
    }))
}

/// write one length-prefixed JSON control message to a stream.
///
/// framing: `[u32 BE len][len bytes utf-8 JSON]`. callers MUST flush /
/// finish via the underlying `SendStream` if they want immediate delivery
/// — iroh streams buffer until close.
pub async fn write_control_message(
    stream: &mut SendStream,
    msg: &ControlMessage,
) -> GrimoireResult<()> {
    let body = serde_json::to_vec(msg).map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("radio: failed to serialize control message: {e}"),
    })?;
    let len = body.len() as u32;
    if len > MAX_CONTROL_BYTES {
        return Err(GrimoireError::ProcessingFailed {
            message: format!(
                "radio: control message too large: {len} bytes (max {MAX_CONTROL_BYTES})"
            ),
        });
    }
    stream
        .write_all(&len.to_be_bytes())
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("radio: failed to write control len: {e}"),
        })?;
    stream
        .write_all(&body)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("radio: failed to write control body: {e}"),
        })?;
    Ok(())
}

/// read one length-prefixed JSON control message off a stream. returns
/// `Ok(None)` on a clean EOF between messages.
pub async fn read_control_message(
    stream: &mut RecvStream,
) -> GrimoireResult<Option<ControlMessage>> {
    let mut header = [0u8; 4];
    match stream.read_exact(&mut header).await {
        Ok(_) => {}
        Err(e) => {
            let s = e.to_string();
            if s.contains("finished") || s.contains("closed") || s.contains("eof") {
                return Ok(None);
            }
            return Err(GrimoireError::FederationApiError {
                message: format!("radio: failed to read control len: {e}"),
            });
        }
    }
    let len = u32::from_be_bytes(header);
    if len > MAX_CONTROL_BYTES {
        return Err(GrimoireError::FederationApiError {
            message: format!(
                "radio: control message too large: {len} bytes (max {MAX_CONTROL_BYTES})"
            ),
        });
    }
    let mut body = vec![0u8; len as usize];
    stream
        .read_exact(&mut body)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("radio: failed to read control body ({len} bytes): {e}"),
        })?;
    let msg = serde_json::from_slice(&body).map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("radio: failed to parse control message: {e}"),
    })?;
    Ok(Some(msg))
}

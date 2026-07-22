//! length-delimited json codec for friendz protocol messages.
//!
//! messages are framed with a 4-byte big-endian u32 length prefix followed
//! by a json-encoded utf-8 payload. generic over
//! `tokio::io::{AsyncRead, AsyncWrite}`, so it carries zero iroh types and
//! needs no feature gate: any transport (iroh streams, a tokio TCP socket,
//! an in-memory duplex pair used in tests) works unchanged.

use super::messages::FriendzMessage;

/// maximum message size: 16 MB (generous for json text).
const MAX_MESSAGE_SIZE: usize = 16 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum CodecError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("message too large: {size} bytes (max {max})")]
    MessageTooLarge { size: usize, max: usize },

    #[error("stream closed")]
    StreamClosed,
}

/// serialize a `FriendzMessage` to bytes with a 4-byte big-endian length
/// prefix.
pub fn encode_message(msg: &FriendzMessage) -> Result<Vec<u8>, CodecError> {
    let json = serde_json::to_vec(msg)?;
    if json.len() > MAX_MESSAGE_SIZE {
        return Err(CodecError::MessageTooLarge {
            size: json.len(),
            max: MAX_MESSAGE_SIZE,
        });
    }
    let len = json.len() as u32;
    let mut buf = Vec::with_capacity(4 + json.len());
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(&json);
    Ok(buf)
}

/// write a length-prefixed message to an `AsyncWrite`.
pub async fn write_message<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    msg: &FriendzMessage,
) -> Result<(), CodecError> {
    use tokio::io::AsyncWriteExt;

    let json = serde_json::to_vec(msg)?;
    if json.len() > MAX_MESSAGE_SIZE {
        return Err(CodecError::MessageTooLarge {
            size: json.len(),
            max: MAX_MESSAGE_SIZE,
        });
    }
    let len = json.len() as u32;
    writer.write_all(&len.to_be_bytes()).await?;
    writer.write_all(&json).await?;
    Ok(())
}

/// read a length-prefixed raw payload from an `AsyncRead`.
///
/// returns the raw bytes without deserializing - useful for logging or
/// inspecting a payload before attempting deserialization (e.g. the
/// dispatch loop's failed-parse warning).
pub async fn read_raw_payload<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<Vec<u8>, CodecError> {
    use tokio::io::AsyncReadExt;

    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
            return Err(CodecError::StreamClosed);
        }
        Err(e) => return Err(CodecError::Io(e)),
    }

    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_MESSAGE_SIZE {
        return Err(CodecError::MessageTooLarge {
            size: len,
            max: MAX_MESSAGE_SIZE,
        });
    }

    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).await?;
    Ok(buf)
}

/// read a length-prefixed message from an `AsyncRead`.
pub async fn read_message<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<FriendzMessage, CodecError> {
    let buf = read_raw_payload(reader).await?;
    let msg = serde_json::from_slice(&buf)?;
    Ok(msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::messages::CoreMessage;

    fn make_heartbeat() -> FriendzMessage {
        FriendzMessage::Core(CoreMessage::Heartbeat {
            v: 1,
            node_id: "node-abc-123".to_string(),
            username: "testuser".to_string(),
            app_payload: None,
        })
    }

    #[test]
    fn encode_decode_round_trip() {
        let msg = make_heartbeat();
        let encoded = encode_message(&msg).expect("encode should succeed");

        let len = u32::from_be_bytes([encoded[0], encoded[1], encoded[2], encoded[3]]) as usize;
        assert_eq!(
            len,
            encoded.len() - 4,
            "length prefix should match payload size"
        );

        let payload = &encoded[4..];
        let decoded: FriendzMessage =
            serde_json::from_slice(payload).expect("json decode should succeed");
        assert_eq!(decoded, msg);
    }

    #[tokio::test]
    async fn write_read_round_trip() {
        let msg = make_heartbeat();
        let (mut client, mut server) = tokio::io::duplex(8192);

        write_message(&mut client, &msg)
            .await
            .expect("write should succeed");
        drop(client);

        let decoded = read_message(&mut server)
            .await
            .expect("read should succeed");
        assert_eq!(decoded, msg);
    }

    #[tokio::test]
    async fn read_stream_closed() {
        let mut reader = tokio::io::empty();
        let result = read_message(&mut reader).await;

        assert!(result.is_err(), "reading from a closed stream should fail");
        assert!(matches!(result.unwrap_err(), CodecError::StreamClosed));
    }

    #[tokio::test]
    async fn multiple_messages_in_order() {
        let messages = vec![
            FriendzMessage::Core(CoreMessage::ProfileRequest { v: 1 }),
            FriendzMessage::Core(CoreMessage::ProfileResponse {
                v: 1,
                username: "alice".to_string(),
                bio: "hello world".to_string(),
                avatar_data_url: "data:image/png;base64,abc".to_string(),
                accent_color: None,
                profile_doc_id: None,
                profile_updated_at: None,
                is_hub: None,
            }),
            FriendzMessage::Core(CoreMessage::FriendRequest {
                v: 1,
                from_node_id: "node-xyz".to_string(),
                from_username: "bob".to_string(),
                is_hub: None,
            }),
        ];

        let (mut writer, mut reader) = tokio::io::duplex(8192);
        for msg in &messages {
            write_message(&mut writer, msg)
                .await
                .expect("write should succeed");
        }
        drop(writer);

        for expected in &messages {
            let decoded = read_message(&mut reader).await.expect("read message");
            assert_eq!(&decoded, expected);
        }

        let result = read_message(&mut reader).await;
        assert!(matches!(result, Err(CodecError::StreamClosed)));
    }

    #[test]
    fn message_too_large_is_rejected() {
        let huge_string = "x".repeat(MAX_MESSAGE_SIZE + 1);
        let msg = FriendzMessage::Core(CoreMessage::ProfileResponse {
            v: 1,
            username: huge_string,
            bio: String::new(),
            avatar_data_url: String::new(),
            accent_color: None,
            profile_doc_id: None,
            profile_updated_at: None,
            is_hub: None,
        });

        let result = encode_message(&msg);
        assert!(result.is_err(), "encoding an oversized message should fail");
        match result.unwrap_err() {
            CodecError::MessageTooLarge { size, max } => {
                assert!(size > MAX_MESSAGE_SIZE);
                assert_eq!(max, MAX_MESSAGE_SIZE);
            }
            other => panic!("expected MessageTooLarge, got: {other}"),
        }
    }

    #[tokio::test]
    async fn deserialize_matches_js_wire_format() {
        let js_json = r#"{"type":"heartbeat","v":1,"nodeId":"abc123def456","username":"bob"}"#;
        let msg: FriendzMessage = serde_json::from_str(js_json).unwrap();
        match msg {
            FriendzMessage::Core(CoreMessage::Heartbeat {
                node_id, username, ..
            }) => {
                assert_eq!(node_id, "abc123def456");
                assert_eq!(username, "bob");
            }
            _ => panic!("expected Heartbeat"),
        }
    }
}

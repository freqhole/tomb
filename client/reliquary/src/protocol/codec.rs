//! length-delimited JSON codec for friendz protocol messages.
//!
//! messages are framed with a 4-byte big-endian u32 length prefix followed
//! by a JSON-encoded UTF-8 payload. this matches the midden BiStream framing
//! used by the JS client.

use super::messages::FriendzMessage;

/// maximum message size: 16 MB (generous for JSON text)
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

/// serialize a `FriendzMessage` to bytes with a 4-byte big-endian length prefix.
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

/// read a length-prefixed message from an `AsyncRead`.
pub async fn read_message<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<FriendzMessage, CodecError> {
    use tokio::io::AsyncReadExt;

    // read 4-byte length prefix
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

    // read payload
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).await?;
    let msg = serde_json::from_slice(&buf)?;
    Ok(msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::messages::{CanvasActivityEntry, FriendzMessage};

    /// helper to build a simple heartbeat message for tests.
    fn make_heartbeat() -> FriendzMessage {
        FriendzMessage::Heartbeat {
            node_id: "node-abc-123".to_string(),
            username: "testuser".to_string(),
            canvas_activity: Some(vec![CanvasActivityEntry {
                canvas_doc_id: "doc-1".to_string(),
                last_modified_at: "2025-01-01T00:00:00Z".to_string(),
                widget_count: 5,
            }]),
        }
    }

    #[test]
    fn test_encode_decode_round_trip() {
        let msg = make_heartbeat();
        let encoded = encode_message(&msg).expect("encode should succeed");

        // first 4 bytes are the big-endian length prefix
        let len = u32::from_be_bytes([encoded[0], encoded[1], encoded[2], encoded[3]]) as usize;
        assert_eq!(
            len,
            encoded.len() - 4,
            "length prefix should match payload size"
        );

        // decode the JSON payload portion
        let payload = &encoded[4..];
        let decoded: FriendzMessage =
            serde_json::from_slice(payload).expect("json decode should succeed");

        match (&msg, &decoded) {
            (
                FriendzMessage::Heartbeat {
                    node_id: a_nid,
                    username: a_user,
                    canvas_activity: a_activity,
                },
                FriendzMessage::Heartbeat {
                    node_id: b_nid,
                    username: b_user,
                    canvas_activity: b_activity,
                },
            ) => {
                assert_eq!(a_nid, b_nid);
                assert_eq!(a_user, b_user);
                let a_act = a_activity.as_ref().unwrap();
                let b_act = b_activity.as_ref().unwrap();
                assert_eq!(a_act.len(), b_act.len());
                assert_eq!(a_act[0].canvas_doc_id, b_act[0].canvas_doc_id);
                assert_eq!(a_act[0].widget_count, b_act[0].widget_count);
            }
            _ => panic!("decoded message should be a heartbeat"),
        }
    }

    #[tokio::test]
    async fn test_write_read_round_trip() {
        let msg = make_heartbeat();
        let (mut client, mut server) = tokio::io::duplex(8192);

        write_message(&mut client, &msg)
            .await
            .expect("write should succeed");
        drop(client); // close writer so reader sees EOF after the message

        let decoded = read_message(&mut server)
            .await
            .expect("read should succeed");

        match (&msg, &decoded) {
            (
                FriendzMessage::Heartbeat {
                    node_id: a_nid,
                    username: a_user,
                    ..
                },
                FriendzMessage::Heartbeat {
                    node_id: b_nid,
                    username: b_user,
                    ..
                },
            ) => {
                assert_eq!(a_nid, b_nid);
                assert_eq!(a_user, b_user);
            }
            _ => panic!("decoded message should be a heartbeat"),
        }
    }

    #[tokio::test]
    async fn test_read_stream_closed() {
        // an empty reader should produce a StreamClosed error
        let mut reader = tokio::io::empty();
        let result = read_message(&mut reader).await;

        assert!(result.is_err(), "reading from closed stream should fail");
        let err = result.unwrap_err();
        assert!(
            matches!(err, CodecError::StreamClosed),
            "error should be StreamClosed, got: {err}"
        );
    }

    #[tokio::test]
    async fn test_multiple_messages() {
        let messages = vec![
            FriendzMessage::ProfileRequest,
            FriendzMessage::ProfileResponse {
                username: "alice".to_string(),
                bio: "hello world".to_string(),
                avatar_data_url: "data:image/png;base64,abc".to_string(),
            },
            FriendzMessage::FriendRequest {
                from_node_id: "node-xyz".to_string(),
                from_username: "bob".to_string(),
            },
        ];

        let (mut writer, mut reader) = tokio::io::duplex(8192);

        // write all messages
        for msg in &messages {
            write_message(&mut writer, msg)
                .await
                .expect("write should succeed");
        }
        drop(writer);

        // read them back in order
        let decoded_0 = read_message(&mut reader).await.expect("read msg 0");
        assert!(
            matches!(decoded_0, FriendzMessage::ProfileRequest),
            "first message should be ProfileRequest"
        );

        let decoded_1 = read_message(&mut reader).await.expect("read msg 1");
        match decoded_1 {
            FriendzMessage::ProfileResponse {
                username,
                bio,
                avatar_data_url,
            } => {
                assert_eq!(username, "alice");
                assert_eq!(bio, "hello world");
                assert_eq!(avatar_data_url, "data:image/png;base64,abc");
            }
            _ => panic!("second message should be ProfileResponse"),
        }

        let decoded_2 = read_message(&mut reader).await.expect("read msg 2");
        match decoded_2 {
            FriendzMessage::FriendRequest {
                from_node_id,
                from_username,
            } => {
                assert_eq!(from_node_id, "node-xyz");
                assert_eq!(from_username, "bob");
            }
            _ => panic!("third message should be FriendRequest"),
        }

        // next read should indicate stream closed
        let result = read_message(&mut reader).await;
        assert!(matches!(result, Err(CodecError::StreamClosed)));
    }

    #[test]
    fn test_message_too_large() {
        // craft a message that exceeds the max size by using a very large string field.
        // we need a string bigger than 16 MB to trigger the guard.
        let huge_string = "x".repeat(MAX_MESSAGE_SIZE + 1);
        let msg = FriendzMessage::ProfileResponse {
            username: huge_string,
            bio: String::new(),
            avatar_data_url: String::new(),
        };

        let result = encode_message(&msg);
        assert!(result.is_err(), "encoding oversized message should fail");
        let err = result.unwrap_err();
        match err {
            CodecError::MessageTooLarge { size, max } => {
                assert!(size > MAX_MESSAGE_SIZE, "reported size should exceed max");
                assert_eq!(max, MAX_MESSAGE_SIZE);
            }
            _ => panic!("error should be MessageTooLarge, got: {err}"),
        }
    }
}

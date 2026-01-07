//! Analytics event recording - insert operations for media events

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use sqlx::SqliteConnection;

use super::models::{MediaEvent, MediaEventType};

/// Record a single media event
///
/// Returns the ID of the created event record
pub async fn record_event(event: &MediaEvent) -> GrimoireResult<String> {
    let pool = database::connect().await?;
    let mut conn = pool.acquire().await?;
    record_event_with_conn(&mut conn, event).await
}

/// Record a media event using an existing connection/transaction
///
/// This is useful when you need to record an event as part of a larger transaction
pub async fn record_event_with_conn(
    conn: &mut SqliteConnection,
    event: &MediaEvent,
) -> GrimoireResult<String> {
    // Serialize event_data to JSON string if present
    let event_data_json = event
        .event_data
        .as_ref()
        .map(|data| serde_json::to_string(data))
        .transpose()
        .map_err(|e| GrimoireError::Serialization(e))?;

    let event_type_str = event.event_type.as_str();

    let result = sqlx::query!(
        r#"
        INSERT INTO media_eventz (
            media_blob_id,
            user_id,
            event_type,
            event_data,
            session_id,
            user_agent,
            client_id,
            client_timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
        event.media_blob_id,
        event.user_id,
        event_type_str,
        event_data_json,
        event.session_id,
        event.user_agent,
        event.client_id,
        event.client_timestamp
    )
    .fetch_one(conn)
    .await?;

    Ok(result.id)
}

/// Record multiple media events in a batch
///
/// Uses a transaction to ensure all events are recorded atomically.
/// Returns the IDs of the created event records.
pub async fn record_events_batch(events: &[MediaEvent]) -> GrimoireResult<Vec<String>> {
    if events.is_empty() {
        return Ok(Vec::new());
    }

    let pool = database::connect().await?;
    let mut tx = pool.begin().await?;

    let mut event_ids = Vec::with_capacity(events.len());

    for event in events {
        let event_id = record_event_with_conn(&mut tx, event).await?;
        event_ids.push(event_id);
    }

    tx.commit().await?;

    Ok(event_ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    #[ignore] // Requires database setup
    async fn test_record_event() {
        let event = MediaEvent::new("test_blob_123".to_string(), MediaEventType::Play)
            .with_user_id("test_user_456")
            .with_session_id("test_session_789")
            .with_event_data(json!({
                "position": 125,
                "progress": 0.5
            }));

        let result = record_event(&event).await;
        assert!(result.is_ok());

        let event_id = result.unwrap();
        assert!(!event_id.is_empty());
    }

    #[tokio::test]
    #[ignore] // Requires database setup
    async fn test_record_events_batch() {
        let events = vec![
            MediaEvent::new("blob1".to_string(), MediaEventType::Play).with_user_id("user1"),
            MediaEvent::new("blob2".to_string(), MediaEventType::Pause).with_user_id("user1"),
            MediaEvent::new("blob3".to_string(), MediaEventType::Complete).with_user_id("user1"),
        ];

        let result = record_events_batch(&events).await;
        assert!(result.is_ok());

        let event_ids = result.unwrap();
        assert_eq!(event_ids.len(), 3);
    }
}

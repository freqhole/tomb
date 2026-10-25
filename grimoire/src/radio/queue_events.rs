//! typed radio-queue events, pushed over the same `freqhole-events/1`
//! P2P protocol job-progress events already use (see
//! `federation::transport::events_protocol`) - a sibling domain on the
//! shared channel, not a second near-identical protocol. mirrors
//! `jobs::job_events`'s shape (broadcast channel + typed filter +
//! subscribe_filtered), minus the per-caller visibility predicate: the
//! request queue's existing permission model already lets any
//! authenticated member list/remove/clear/reorder any station's queue
//! (see `offal::music::radio`'s route doc comments), so there's no
//! per-event ACL to apply here - filtering is purely by `station_id`.
//!
//! emit points live in `offal::music::radio`'s route handlers (not
//! `radio::requests` itself), since building a `Submitted` event's full
//! `RadioQueuedRequestInfo` payload needs the same title/artist/art
//! metadata resolution `list_requests` already does for its HTTP
//! response - `radio::requests` only knows the bare `QueuedRequest`, with
//! no metadata-resolution capability of its own, and duplicating that
//! resolution logic down into the queue primitive would be the wrong
//! layer for it.

use crate::jobs::job_events::CloseReason;
use crate::offal::music::radio::RadioQueuedRequestInfo;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use zod_gen_derive::ZodSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
// NOTE: PascalCase variant names - the zod codegen doesn't honor
// `rename_all` (precedent:
// offal::music::albums::ImageIngestTarget's identical doc comment), so
// we must not set it here or serde + the generated zod schema will
// disagree on the wire tag. `{ kind: "Submitted", ... }` etc. on both
// sides, not translated to snake_case anywhere.
#[serde(tag = "kind")]
pub enum RadioQueueEvent {
    /// a new request was appended - full display metadata included (same
    /// shape `radio_list_requests` already resolves for every row), so a
    /// subscriber can append a fully-rendered row without a follow-up
    /// fetch.
    Submitted {
        station_id: String,
        request: RadioQueuedRequestInfo,
    },
    /// one request left the queue (explicit removal, or the broadcaster
    /// popped it off the front to actually play it - see
    /// `radio::requests::pop_next`'s callers).
    Removed {
        station_id: String,
        request_id: String,
    },
    /// one request moved to a new position (`radio::requests::reorder`'s
    /// clamped, server-authoritative index - matches whatever index the
    /// mutating client's own request actually landed at).
    Reordered {
        station_id: String,
        request_id: String,
        new_index: u64,
    },
    /// every pending request for the station was removed at once.
    Cleared { station_id: String },
}

impl RadioQueueEvent {
    pub fn station_id(&self) -> &str {
        match self {
            RadioQueueEvent::Submitted { station_id, .. }
            | RadioQueueEvent::Removed { station_id, .. }
            | RadioQueueEvent::Reordered { station_id, .. }
            | RadioQueueEvent::Cleared { station_id } => station_id,
        }
    }
}

/// a subscriber only ever cares about one station's queue at a time (the
/// one they're actually tuned into) - unlike `job_events::EventFilter`'s
/// several independent axes, this is deliberately just the one field.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioQueueEventFilter {
    pub station_id: String,
}

impl RadioQueueEventFilter {
    pub fn matches(&self, evt: &RadioQueueEvent) -> bool {
        self.station_id == evt.station_id()
    }
}

/// global broadcast channel for radio queue events - same 256-slot ring
/// buffer size as `job_events::JOB_EVENTS`; a lagged subscriber gets a
/// single `CloseReason::Lagged` and should re-snapshot (same contract).
static RADIO_QUEUE_EVENTS: Lazy<broadcast::Sender<RadioQueueEvent>> = Lazy::new(|| {
    let (tx, _) = broadcast::channel(256);
    tx
});

/// publish a `RadioQueueEvent` to all current subscribers. silent no-op
/// when there are no subscribers.
pub fn emit(event: RadioQueueEvent) {
    let _ = RADIO_QUEUE_EVENTS.send(event);
}

/// subscribe to the raw radio-queue event stream, unfiltered. mirrors
/// `job_events::subscribe` - exposed mainly for tests; real subscribers
/// should use `subscribe_filtered` below.
pub fn subscribe() -> broadcast::Receiver<RadioQueueEvent> {
    RADIO_QUEUE_EVENTS.subscribe()
}

/// subscribe with a filter applied. yields each event matching
/// `filter.station_id`. on broadcast lag, yields a single
/// `Err(CloseReason::Lagged)` and ends - the client should re-snapshot
/// and reconnect, same contract as `job_events::subscribe_filtered`.
pub fn subscribe_filtered(
    filter: RadioQueueEventFilter,
) -> impl futures_util::Stream<Item = Result<RadioQueueEvent, CloseReason>> {
    use futures_util::stream;
    let mut rx = RADIO_QUEUE_EVENTS.subscribe();
    stream::unfold(
        (rx_take(&mut rx), filter),
        |(mut rx, filter): (broadcast::Receiver<RadioQueueEvent>, RadioQueueEventFilter)| async move {
            loop {
                match rx.recv().await {
                    Ok(evt) => {
                        if !filter.matches(&evt) {
                            continue;
                        }
                        return Some((Ok(evt), (rx, filter)));
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        return Some((Err(CloseReason::Lagged), (rx, filter)));
                    }
                    Err(broadcast::error::RecvError::Closed) => return None,
                }
            }
        },
    )
}

/// helper: own the receiver inside the unfold closure - identical
/// pattern to `job_events::rx_take`.
fn rx_take(rx: &mut broadcast::Receiver<RadioQueueEvent>) -> broadcast::Receiver<RadioQueueEvent> {
    std::mem::replace(rx, RADIO_QUEUE_EVENTS.subscribe())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request_info(id: &str) -> RadioQueuedRequestInfo {
        RadioQueuedRequestInfo {
            id: id.to_string(),
            kind: "song".to_string(),
            item_id: "item-1".to_string(),
            requested_by: "user-1".to_string(),
            requested_by_username: Some("alice".to_string()),
            title: "a song".to_string(),
            artist: None,
            album: None,
            duration_ms: None,
            art_blob_id: None,
        }
    }

    /// locks in the real wire tag casing - PascalCase, since this enum
    /// deliberately has no `rename_all` (see the enum's doc comment).
    /// if this ever flips to lowercase, the generated zod schema and
    /// every TS consumer constructing these tags by hand (see
    /// `pollingRadioQueueEvents` in `transport.ts`) would silently
    /// desync from the real wire format.
    #[test]
    fn wire_tag_is_pascal_case_not_snake_case() {
        let evt = RadioQueueEvent::Cleared {
            station_id: "station-a".to_string(),
        };
        let json = serde_json::to_value(&evt).unwrap();
        assert_eq!(json["kind"], "Cleared");
    }

    #[test]
    fn filter_matches_only_its_own_station() {
        let filter = RadioQueueEventFilter {
            station_id: "station-a".to_string(),
        };
        let matching = RadioQueueEvent::Cleared {
            station_id: "station-a".to_string(),
        };
        let other = RadioQueueEvent::Cleared {
            station_id: "station-b".to_string(),
        };
        assert!(filter.matches(&matching));
        assert!(!filter.matches(&other));
    }

    #[tokio::test]
    async fn subscribe_filtered_only_yields_matching_station_events() {
        let filter = RadioQueueEventFilter {
            station_id: "station-filter-test".to_string(),
        };
        let stream = subscribe_filtered(filter);
        let mut stream = Box::pin(stream);

        emit(RadioQueueEvent::Submitted {
            station_id: "station-other".to_string(),
            request: request_info("req-other"),
        });
        emit(RadioQueueEvent::Submitted {
            station_id: "station-filter-test".to_string(),
            request: request_info("req-mine"),
        });

        use futures_util::StreamExt;
        let evt = stream.next().await.expect("an event").expect("not an error");
        match evt {
            RadioQueueEvent::Submitted { station_id, request } => {
                assert_eq!(station_id, "station-filter-test");
                assert_eq!(request.id, "req-mine");
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn station_id_extracts_from_every_variant() {
        assert_eq!(
            RadioQueueEvent::Submitted {
                station_id: "s1".to_string(),
                request: request_info("r1"),
            }
            .station_id(),
            "s1"
        );
        assert_eq!(
            RadioQueueEvent::Removed {
                station_id: "s2".to_string(),
                request_id: "r2".to_string(),
            }
            .station_id(),
            "s2"
        );
        assert_eq!(
            RadioQueueEvent::Reordered {
                station_id: "s3".to_string(),
                request_id: "r3".to_string(),
                new_index: 0,
            }
            .station_id(),
            "s3"
        );
        assert_eq!(
            RadioQueueEvent::Cleared {
                station_id: "s4".to_string(),
            }
            .station_id(),
            "s4"
        );
    }
}

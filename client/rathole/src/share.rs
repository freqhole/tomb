//! minimal share-link token decoder for radio station shares.
//!
//! a rust port of the entity-share subset of
//! `lib/haruspex/ts/src/share/codec.ts` (this monorepo's shared wire
//! format for spume/skein's "share a thing with someone" links) - just
//! enough to support `/radio listen <link>` in rathole. NOT a general
//! purpose share consumer: rathole has no song/album/playlist/video
//! views to navigate to for any other entity kind, so every other field
//! on the wire payload (title/artist/album hints, the `sh` http-origin
//! fallback, doc/node share kinds) is deliberately left unparsed here.
//!
//! wire shapes handled (both base64url-decode to a json object):
//!   - current (v2) unified envelope: `{v:2, k:"entity", sn, sh, ek, i, ...}`
//!     - `sn` is the sharing node's p2p node id (what rathole calls
//!       `peer_addr` throughout its own radio code), `ek` is the entity
//!       kind (must be `"radio_station"`), `i` is the station id.
//!   - legacy (v1) entity shape: `{v:1, s:{n,h}, k, i, ...}` - predates
//!     the node/doc/entity envelope split, so `k` directly holds the
//!     entity kind and `s.n` holds the node id.
//!
//! if this monorepo's wire format changes, keep this in sync with
//! `lib/haruspex/ts/src/share/codec.ts` by hand (no shared codegen for
//! this one - see that file's own doc comment for the full schema).

use base64::Engine as _;
use serde::Deserialize;

/// the minimal info needed to `tty::radio::start` a listen session.
pub struct RadioShare {
    pub peer_addr: String,
    pub station_id: String,
}

#[derive(Debug, Deserialize)]
struct EntityWireV2 {
    v: u32,
    k: String,
    sn: Option<String>,
    ek: Option<String>,
    i: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EntityWireV1 {
    v: u32,
    #[serde(default)]
    s: Option<EntityWireV1Source>,
    k: Option<String>,
    i: Option<String>,
}

#[derive(Debug, Deserialize)]
struct EntityWireV1Source {
    n: Option<String>,
}

/// extracts the share token from a full share link/URL or a bare token.
///
/// spume's actual "copy share link" button (see `permalink.ts`'s
/// `buildShareUrls`) produces `<host>/#?share=<token>` - a hash QUERY
/// PARAM, checked first since it's the format real, freshly-generated
/// links use. the haruspex codec's own `#share/<token>` / `share/<token>`
/// PATH style is also accepted as a fallback (used elsewhere in this
/// monorepo's share plumbing) - see `lib/haruspex/ts/src/share/codec.ts`'s
/// `extractShareToken`. the trailing `&...`-truncation for the path style
/// is gated on that prefix actually matching (an earlier ts-side bug
/// truncated unconditionally, misreading unrelated `&`-containing
/// strings as share tokens - see that function's history).
fn extract_token(input: &str) -> &str {
    let raw = input.trim();

    if let Some(idx) = raw.find("share=") {
        let after = &raw[idx + "share=".len()..];
        let end = after.find('&').unwrap_or(after.len());
        return &after[..end];
    }

    let (rest, matched_prefix) = if let Some(idx) = raw.find("#share/") {
        (&raw[idx + "#share/".len()..], true)
    } else if let Some(stripped) = raw.strip_prefix("share/") {
        (stripped, true)
    } else {
        (raw, false)
    };
    if matched_prefix {
        if let Some(amp) = rest.find('&') {
            return &rest[..amp];
        }
    }
    rest
}

/// decodes a radio-station share link/token into a peer_addr + station
/// id. returns `None` for anything that isn't a well-formed
/// `radio_station` entity share (wrong entity kind, missing node id, not
/// valid base64url/json, etc.) - callers should treat that identically
/// to "not a share link at all" (e.g. fall back to treating the input as
/// a raw peer_addr).
pub fn decode_radio_share(input: &str) -> Option<RadioShare> {
    let token = extract_token(input);
    if token.is_empty() {
        return None;
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(token)
        .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;

    if let Ok(wire) = serde_json::from_value::<EntityWireV2>(value.clone()) {
        if wire.v == 2 && wire.k == "entity" && wire.ek.as_deref() == Some("radio_station") {
            if let (Some(peer_addr), Some(station_id)) = (wire.sn, wire.i) {
                return Some(RadioShare {
                    peer_addr,
                    station_id,
                });
            }
        }
    }

    if let Ok(wire) = serde_json::from_value::<EntityWireV1>(value) {
        if wire.v == 1 && wire.k.as_deref() == Some("radio_station") {
            if let (Some(peer_addr), Some(station_id)) = (wire.s.and_then(|s| s.n), wire.i) {
                return Some(RadioShare {
                    peer_addr,
                    station_id,
                });
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(json: &serde_json::Value) -> String {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json.to_string())
    }

    #[test]
    fn decodes_v2_entity_radio_share() {
        let token = encode(&serde_json::json!({
            "v": 2,
            "k": "entity",
            "sn": "deadbeefcafe",
            "sh": "https://example.freqhole.net",
            "ek": "radio_station",
            "i": "abc123",
            "t": "chill station",
        }));
        let share = decode_radio_share(&token).expect("should decode");
        assert_eq!(share.peer_addr, "deadbeefcafe");
        assert_eq!(share.station_id, "abc123");
    }

    #[test]
    fn decodes_with_hash_share_prefix_and_ignores_trailing_amp() {
        let token = encode(&serde_json::json!({
            "v": 2,
            "k": "entity",
            "sn": "deadbeefcafe",
            "ek": "radio_station",
            "i": "abc123",
        }));
        let link = format!("https://spume.example/#share/{token}&foo=bar");
        let share = decode_radio_share(&link).expect("should decode");
        assert_eq!(share.peer_addr, "deadbeefcafe");
        assert_eq!(share.station_id, "abc123");
    }

    #[test]
    fn decodes_spumes_real_hash_query_param_share_link() {
        // this is the actual format spume's "copy share link" button
        // produces (permalink.ts's buildShareUrls: `<host>/#?share=
        // <token>`) - NOT the `#share/<token>` path style above, which
        // an earlier version of this decoder wrongly treated as the
        // only/primary format, silently failing to extract the token at
        // all for every real spume-generated link.
        let link = "https://spume.freqhole.net/#?share=eyJ2IjoyLCJrIjoiZW50aXR5Iiwic\
24iOiIwYjEzZmE3YWE4ZmY1NWYwZTJhNTBhYzk0ODBjMTdmYmY5NDQxMmIxZWUxMDVjNzcyZGMxMTRhY2\
IwOTYxZWZlIiwiZWsiOiJyYWRpb19zdGF0aW9uIiwiaSI6ImIzM2NjNTcyNGYxZDAzYzgiLCJ0IjoidmlkZ\
W8ga2lsbGVkIGRhIHJhZGlvIHN0YXIifQ";
        let share = decode_radio_share(link).expect("should decode");
        assert_eq!(
            share.peer_addr,
            "0b13fa7aa8ff55f0e2a50ac9480c17fbf94412b1ee105c772dc114acb0961efe"
        );
        assert_eq!(share.station_id, "b33cc5724f1d03c8");
    }

    #[test]
    fn decodes_legacy_v1_entity_radio_share() {
        let token = encode(&serde_json::json!({
            "v": 1,
            "s": { "n": "deadbeefcafe", "h": "https://example.freqhole.net" },
            "k": "radio_station",
            "i": "abc123",
        }));
        let share = decode_radio_share(&token).expect("should decode");
        assert_eq!(share.peer_addr, "deadbeefcafe");
        assert_eq!(share.station_id, "abc123");
    }

    #[test]
    fn rejects_non_radio_entity_kinds() {
        let token = encode(&serde_json::json!({
            "v": 2,
            "k": "entity",
            "sn": "deadbeefcafe",
            "ek": "song",
            "i": "abc123",
        }));
        assert!(decode_radio_share(&token).is_none());
    }

    #[test]
    fn rejects_garbage_input() {
        assert!(decode_radio_share("not a share link").is_none());
        assert!(decode_radio_share("").is_none());
    }
}

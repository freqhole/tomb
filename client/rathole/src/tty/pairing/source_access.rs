//! radio source access for rathole as a cenotaph player - the rust
//! counterpart of spume's `cenotaph/adapters/radioSourceAccess.ts`.
//!
//! when a controller tells this player to tune into a station, it's THIS
//! node that dials the broadcaster, so a private station only works if the
//! broadcasting remote knows this player. the radio protocol gives no
//! structured "denied" signal (the broadcaster just closes the stream
//! before Hello), so after a failed tune this probes the remote's
//! authenticated `whoami` route to tell "not allowed" apart from "couldn't
//! reach it" or "something else went wrong", reporting that as a specific
//! ack reason the controller can act on (grant access as admin, or offer
//! to send an access request).
//!
//! the access request (knock) has to come from this node too - the
//! remote's p2p handler stamps the knock with the transport-verified node
//! id, which is the identity its admin will be approving.

use grimoire::cenotaph::{CommandAck, CommandAckReason};
use grimoire::federation::p2p_client::api_request;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SourceAccessProbe {
    Authorized,
    Unauthorized,
    Unreachable,
}

/// maps a `whoami` round trip onto a probe result: a 401 is the p2p
/// handler's "unauthorized: peer not registered", a transport error means
/// we never got through, anything else means the remote answered and
/// access isn't what's in the way.
pub(crate) fn classify_whoami(result: Result<u16, String>) -> SourceAccessProbe {
    match result {
        Ok(401) => SourceAccessProbe::Unauthorized,
        Ok(_) => SourceAccessProbe::Authorized,
        Err(_) => SourceAccessProbe::Unreachable,
    }
}

pub(crate) async fn probe_source_access(peer_addr: &str) -> SourceAccessProbe {
    let result = api_request(peer_addr, "GET", "/api/auth/whoami", None)
        .await
        .map(|resp| resp.status)
        .map_err(|e| e.to_string());
    classify_whoami(result)
}

/// the ack for a tune whose handshake failed with `detail`, given what the
/// follow-up probe found.
pub(crate) fn tune_failure_ack(probe: SourceAccessProbe, detail: String) -> CommandAck {
    let reason = match probe {
        SourceAccessProbe::Unauthorized => CommandAckReason::SourceAccessDenied,
        SourceAccessProbe::Unreachable => CommandAckReason::SourceUnreachable,
        SourceAccessProbe::Authorized => CommandAckReason::TuneFailed,
    };
    with_detail(CommandAck::err(reason), detail)
}

pub(crate) fn request_access_failed_ack(detail: String) -> CommandAck {
    with_detail(CommandAck::err(CommandAckReason::RequestAccessFailed), detail)
}

fn with_detail(ack: CommandAck, detail: String) -> CommandAck {
    CommandAck {
        detail: Some(detail),
        ..ack
    }
}

/// pulls a human-readable reason out of a failed `/api/knock` response
/// body - a `GrimoireResponse` (`errors[0].detail`, falling back to
/// `message`), or the p2p handler's own `{"success":false,"message":..}`
/// rejections (e.g. "knocking is disabled on this server").
pub(crate) fn knock_failure_detail(status: u16, body: &str) -> String {
    let parsed: Option<serde_json::Value> = serde_json::from_str(body).ok();
    let from_errors = parsed
        .as_ref()
        .and_then(|v| v.get("errors"))
        .and_then(|e| e.as_array())
        .and_then(|e| e.first())
        .and_then(|e| e.get("detail"))
        .and_then(|d| d.as_str())
        .filter(|s| !s.is_empty());
    let from_message = parsed
        .as_ref()
        .and_then(|v| v.get("message"))
        .and_then(|m| m.as_str())
        .filter(|s| !s.is_empty());
    from_errors
        .or(from_message)
        .map(str::to_string)
        .unwrap_or_else(|| format!("access request failed (status {status})"))
}

/// sends this player's own knock to `peer_addr`.
pub(crate) async fn send_knock(
    peer_addr: &str,
    username: &str,
    message: Option<&str>,
) -> Result<(), String> {
    let body = serde_json::json!({
        "username": username,
        "message": message.unwrap_or_default(),
    })
    .to_string();
    let resp = api_request(peer_addr, "POST", "/api/knock", Some(body))
        .await
        .map_err(|e| format!("couldn't reach the remote: {e}"))?;
    if resp.status == 200 {
        Ok(())
    } else {
        Err(knock_failure_detail(resp.status, &resp.body))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whoami_401_means_unauthorized() {
        assert_eq!(classify_whoami(Ok(401)), SourceAccessProbe::Unauthorized);
        assert_eq!(classify_whoami(Ok(200)), SourceAccessProbe::Authorized);
        // the remote answered with some other error - access isn't the issue.
        assert_eq!(classify_whoami(Ok(500)), SourceAccessProbe::Authorized);
        assert_eq!(
            classify_whoami(Err("connect timed out".into())),
            SourceAccessProbe::Unreachable
        );
    }

    #[test]
    fn tune_failure_maps_probe_to_reason_with_detail() {
        for (probe, reason) in [
            (
                SourceAccessProbe::Unauthorized,
                CommandAckReason::SourceAccessDenied,
            ),
            (
                SourceAccessProbe::Unreachable,
                CommandAckReason::SourceUnreachable,
            ),
            (SourceAccessProbe::Authorized, CommandAckReason::TuneFailed),
        ] {
            let ack = tune_failure_ack(probe, "closed before hello".into());
            assert!(!ack.ok);
            assert_eq!(ack.reason, Some(reason));
            assert_eq!(ack.detail.as_deref(), Some("closed before hello"));
        }
    }

    #[test]
    fn knock_failure_detail_prefers_structured_errors() {
        let body = r#"{"success":false,"message":"bad request","errors":[{"error_type":"bad_request","title":"bad request","detail":"username taken"}]}"#;
        assert_eq!(knock_failure_detail(400, body), "username taken");
        let body = r#"{"success":false,"message":"knocking is disabled on this server"}"#;
        assert_eq!(
            knock_failure_detail(403, body),
            "knocking is disabled on this server"
        );
        assert_eq!(
            knock_failure_detail(502, "not json"),
            "access request failed (status 502)"
        );
    }
}

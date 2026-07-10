//! two-peer-knock-iroh: the knock-exchange flow over two real localhost
//! iroh endpoints - the phase's own two-endpoint integration test, promoted
//! to a runnable example per PHASE_4_HARUSPEX_RUST.md's "examples +
//! testing exports" section.
//!
//! deliberately shaped as a composition root (build stores, build the
//! service + handler, register on an endpoint, run the accept loop) rather
//! than a minimal smoke test - per the phase doc, this is the seed for a
//! possible future standalone auth-peer mode, even though this particular
//! run exits once it has demonstrated one full exchange.
//!
//! the knock-request/knock-outcome pair rides one bidirectional stream
//! (requester writes the request, then reads the reply off the same
//! stream's recv half) rather than `FriendzService::dispatch`'s generic
//! event/reply machinery: `dispatch` deliberately does not auto-reply to
//! knock messages (that business logic lives above it, per its own module
//! docs), so this demo's responder answers the request directly instead of
//! opening a second connection back - the same "one request/response pair
//! per bidirectional stream" shape skein's `blob_proxy.rs` uses. the
//! `FriendzProtocolHandler`/router IS still registered on both endpoints
//! (a real composition root would run it for the rest of the friendz
//! protocol - heartbeats, friend requests, and so on), it's just not the
//! path this particular exchange takes.
//!
//! run with: `cargo run --example two-peer-knock-iroh --features iroh,test-utils`

use std::sync::Arc;

use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, RelayMode};

use haruspex::knock::policy::{GrantOnAcceptPolicy, KnockPolicy};
use haruspex::protocol::codec;
use haruspex::protocol::iroh_transport::FriendzProtocolHandler;
use haruspex::protocol::messages::{CoreMessage, FriendzMessage, WireKnockScope, FRIENDZ_ALPN};
use haruspex::protocol::service::FriendzService;
use haruspex::stores::grant_store::Role;
use haruspex::stores::knock_store::{KnockDecision, KnockDirection, KnockScope, KnockStatus};
use haruspex::stores::{GrantStore, KnockStore};
use haruspex::testing::{grant_store, identity_store, knock_store, open_in_memory};

/// one composition root: an iroh endpoint + router running the friendz
/// protocol, plus the auth stores an app would wire alongside it. a real
/// standalone auth peer looks exactly like this, minus the process exiting
/// at the end.
struct AuthPeer {
    endpoint: Endpoint,
    identities: Arc<haruspex::sqlite::SqliteIdentityStore>,
    grants: Arc<dyn GrantStore>,
    knocks: Arc<haruspex::sqlite::SqliteKnockStore>,
}

async fn build_peer(local_username: &str) -> AuthPeer {
    let endpoint = Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .bind()
        .await
        .expect("bind iroh endpoint");
    let node_id = endpoint.id().to_string();

    let (service, _events) = FriendzService::new(node_id.clone(), local_username);
    let handler = FriendzProtocolHandler::new(Arc::new(service));
    let router = Router::builder(endpoint.clone())
        .accept(FRIENDZ_ALPN, handler)
        .spawn();
    // a real long-running auth peer holds onto its router for the process
    // lifetime; leaking it here keeps the accept loop alive for this
    // short-lived demo without a shutdown-ordering dance. the friendz
    // router stays registered (heartbeats, friend requests, and so on
    // would flow through it in a real deployment) even though this demo's
    // knock exchange below rides its own separate connection instead.
    Box::leak(Box::new(router));

    let pool = open_in_memory().await;
    let identities = Arc::new(identity_store(&pool));
    let grants: Arc<dyn GrantStore> = Arc::new(grant_store(&pool));
    let knocks = Arc::new(knock_store(&pool));

    println!("peer '{local_username}' listening as {node_id}");
    AuthPeer {
        endpoint,
        identities,
        grants,
        knocks,
    }
}

/// a minimal `iroh::protocol::ProtocolHandler` answering knock-requests:
/// read exactly one `knock-request` off the accepted bi-stream, decide it
/// via `GrantOnAcceptPolicy`, and write the `knock-outcome` back on the
/// same stream. deliberately separate from `FriendzProtocolHandler` (which
/// this demo also registers on `FRIENDZ_ALPN` for the rest of the friendz
/// protocol) - see the module doc comment for why knock messages don't
/// ride `dispatch`'s generic reply path.
#[derive(Clone)]
struct KnockResponder {
    identities: Arc<haruspex::sqlite::SqliteIdentityStore>,
    grants: Arc<dyn GrantStore>,
    knocks: Arc<haruspex::sqlite::SqliteKnockStore>,
    local_node_id: String,
}

// `ProtocolHandler` requires `Debug`; the store handles inside don't
// implement it (and don't need to for this demo), so this is a minimal
// manual impl rather than deriving.
impl std::fmt::Debug for KnockResponder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KnockResponder")
            .field("local_node_id", &self.local_node_id)
            .finish_non_exhaustive()
    }
}

impl iroh::protocol::ProtocolHandler for KnockResponder {
    async fn accept(
        &self,
        connection: iroh::endpoint::Connection,
    ) -> Result<(), iroh::protocol::AcceptError> {
        let (mut send, mut recv) = connection.accept_bi().await?;

        let msg = codec::read_message(&mut recv)
            .await
            .map_err(iroh::protocol::AcceptError::from_err)?;
        let FriendzMessage::Core(CoreMessage::KnockRequest {
            knock_id,
            node_id,
            message,
            scope,
            ..
        }) = msg
        else {
            return Ok(());
        };
        println!("responder received knock-request {knock_id} from {node_id}: {message:?}");

        let local_knock = self
            .knocks
            .create_knock(
                &node_id,
                KnockDirection::Inbound,
                scope.to_store(),
                message,
                1_700_000_001,
                None,
            )
            .await
            .map_err(iroh::protocol::AcceptError::from_err)?;

        let policy = GrantOnAcceptPolicy {
            identities: self.identities.as_ref(),
            grants: self.grants.as_ref(),
            default_role: Role::Viewer,
            granted_by: self.local_node_id.clone(),
        };
        let outcome = policy.on_accept(&local_knock).await.unwrap_or_else(|e| {
            panic!("GrantOnAcceptPolicy denied the knock: {e}");
        });
        println!(
            "responder's GrantOnAcceptPolicy decided: {:?} (role: {:?})",
            outcome.status, outcome.granted_role
        );

        self.knocks
            .record_decision(
                local_knock.id,
                KnockDecision {
                    by_node_id: self.local_node_id.clone(),
                    outcome: outcome.status,
                    granted_role: outcome.granted_role.map(|r| r.as_str().to_string()),
                    at: 1_700_000_002,
                },
            )
            .await
            .map_err(iroh::protocol::AcceptError::from_err)?;

        let reply = FriendzMessage::Core(CoreMessage::KnockOutcome {
            v: 1,
            knock_id: Some(knock_id),
            status: outcome.status,
            granted_role: outcome.granted_role,
            granted_resource_ids: Vec::new(),
            by_node_id: Some(self.local_node_id.clone()),
        });
        codec::write_message(&mut send, &reply)
            .await
            .map_err(iroh::protocol::AcceptError::from_err)?;
        // quinn resets an unfinished send stream on drop (an abrupt RST,
        // not a graceful FIN) - finish() signals "no more data" properly.
        send.finish().ok();
        println!("responder sent knock-outcome back to requester");

        // returning from `accept()` closes the whole connection, which can
        // race ahead of the requester's read of the just-sent reply (quic
        // delivery is reliable once acked, but an immediate local close can
        // beat that ack). wait for the requester to close its end first
        // (it does so right after reading the reply, below) - with a
        // generous timeout as a safety net rather than hanging forever.
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), connection.closed()).await;

        Ok(())
    }
}

#[tokio::main]
async fn main() {
    let requester = build_peer("requester").await;
    let responder = build_peer("responder").await;

    let responder_node_id = responder.endpoint.id().to_string();
    let responder_addr = responder.endpoint.addr();

    // the responder answers knock-requests on its own dedicated ALPN -
    // spawned before the requester connects, so it's ready to accept.
    const KNOCK_ALPN: &[u8] = b"freqhole-friendz-knock-demo/1";
    let responder_knock_router = Router::builder(responder.endpoint.clone())
        .accept(
            KNOCK_ALPN,
            KnockResponder {
                identities: Arc::clone(&responder.identities),
                grants: Arc::clone(&responder.grants),
                knocks: Arc::clone(&responder.knocks),
                local_node_id: responder_node_id.clone(),
            },
        )
        .spawn();
    Box::leak(Box::new(responder_knock_router));

    // the requester creates a local pending knock and sends the matching
    // wire message directly (mirroring what `KnockPeer::send_knock` does
    // in the in-memory `testing::knock_pair` harness, just over a real
    // connection instead of a duplex pair), then reads the reply straight
    // off the same stream.
    let scope = KnockScope::Resource {
        resource_id: "shared-doc".to_string(),
        requested_role: Some(Role::Member),
    };
    let sent = requester
        .knocks
        .create_knock(
            &requester.endpoint.id().to_string(),
            KnockDirection::Outbound,
            scope.clone(),
            "let me edit shared-doc".to_string(),
            1_700_000_000,
            None,
        )
        .await
        .expect("create local knock record");

    println!("requester connecting to responder at {responder_node_id}...");
    let conn = requester
        .endpoint
        .connect(responder_addr, KNOCK_ALPN)
        .await
        .expect("connect to responder");
    let (mut send, mut recv) = conn.open_bi().await.expect("open bi stream");

    let request_msg = FriendzMessage::Core(CoreMessage::KnockRequest {
        v: 1,
        knock_id: sent.id.to_string(),
        node_id: requester.endpoint.id().to_string(),
        username: None,
        message: "let me edit shared-doc".to_string(),
        scope: WireKnockScope::from_store(scope),
    });
    codec::write_message(&mut send, &request_msg)
        .await
        .expect("send knock-request");
    send.finish().expect("finish knock-request stream");
    println!("requester sent knock-request {}", sent.id);

    let reply = codec::read_message(&mut recv)
        .await
        .expect("read knock-outcome reply");
    let FriendzMessage::Core(CoreMessage::KnockOutcome {
        status,
        granted_role,
        ..
    }) = reply
    else {
        panic!("expected a knock-outcome reply, got {reply:?}");
    };
    println!("requester received knock-outcome: {status:?} (role: {granted_role:?})");
    // signal the responder we're done reading, so its `accept()` (which is
    // waiting on `connection.closed()`) can return promptly instead of
    // waiting out its timeout.
    conn.close(0u32.into(), b"done");
    assert_eq!(status, KnockStatus::Accepted);

    requester
        .knocks
        .record_decision(
            sent.id,
            KnockDecision {
                by_node_id: responder_node_id,
                outcome: status,
                granted_role: granted_role.map(|r| r.as_str().to_string()),
                at: 1_700_000_003,
            },
        )
        .await
        .expect("record decision on requester side");

    println!(
        "two-peer-knock-iroh complete: real localhost iroh connection, GrantOnAcceptPolicy, grant visible on both sides"
    );
}

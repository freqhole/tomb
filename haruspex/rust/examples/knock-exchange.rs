//! knock-exchange: two in-memory peers over a duplex channel exercising the
//! full knock lifecycle - request -> pending -> accept -> grant visible.
//! no iroh at all; this is the pure-logic seed example named in
//! PHASE_4_HARUSPEX_RUST.md's "examples + testing exports" section.
//!
//! run with: `cargo run --example knock-exchange --features test-utils`

use haruspex::stores::grant_store::Role;
use haruspex::stores::knock_store::{KnockScope, KnockStatus};
use haruspex::testing::knock_pair;

#[tokio::main]
async fn main() {
    let mut pair = knock_pair().await;

    println!("peer-a knocks on peer-b for member access to doc-1");
    let sent = pair
        .a
        .send_knock(
            KnockScope::Resource {
                resource_id: "doc-1".to_string(),
                requested_role: Some(Role::Member),
            },
            "let me in, please",
            1_700_000_000,
        )
        .await
        .expect("send knock");
    assert_eq!(sent.status, KnockStatus::Pending);
    println!("  knock {} recorded on peer-a as pending", sent.id);

    let received = pair.b.recv_knock(1_700_000_001).await.expect("recv knock");
    println!(
        "  peer-b received the knock from {} (message: {:?})",
        received.node_id, received.message
    );

    println!("peer-b accepts, granting member access");
    let decided = pair
        .b
        .decide(
            received.id,
            KnockStatus::Accepted,
            Some(Role::Member),
            1_700_000_002,
        )
        .await
        .expect("decide");
    assert_eq!(decided.status, KnockStatus::Accepted);

    let outcome = pair
        .a
        .recv_outcome(sent.id, 1_700_000_003)
        .await
        .expect("recv outcome");
    println!(
        "  peer-a sees the outcome: {:?}, granted role: {:?}",
        outcome.status,
        outcome
            .decisions
            .last()
            .and_then(|d| d.granted_role.clone())
    );

    assert_eq!(outcome.status, KnockStatus::Accepted);
    println!("grant visible on both sides - exchange complete");
}

//! loopback integration test: two `SibylNode`s on the same host,
//! one publishes a fake collection, the other downloads it via
//! `SibylPeer::request`. avoids ffmpeg entirely (the transcode pipe
//! is covered by frame.rs unit tests) so this test is hermetic.
//!
//! uses `presets::Minimal` instead of N0 so we don't depend on the
//! n0 relay or DNS at test time. addr resolution between the two
//! local nodes is plumbed via `MemoryLookup`.

use std::sync::{Arc, Mutex};

use bytes::Bytes;
use iroh::address_lookup::memory::MemoryLookup;
use iroh::endpoint::presets::Minimal;
use iroh_blobs::format::collection::Collection;
use iroh_blobs::ticket::BlobTicket;
use iroh_blobs::BlobFormat;
use sibyl_core::{CodecParams, SibylNode, SibylPeer, SibylTicket};

/// publish three tiny fake "chunks" as a collection on `host_node`,
/// return a `SibylTicket` pointing at the collection root.
async fn publish_fake_collection(host_node: &Arc<SibylNode>) -> anyhow::Result<SibylTicket> {
    let store = host_node.store();
    let mut collection = Collection::default();

    for seq in 0u32..3 {
        // synthetic payload; not a real mp3 frame, but the peer
        // doesn't validate frames — that's the player's job.
        let payload = Bytes::from(vec![seq as u8; 32]);
        let tag = store.add_bytes(payload).await?;
        collection.push(format!("{:08}.mp3", seq), tag.hash);
    }

    let root_tag = collection.store(host_node.store()).await?;
    let root_hash = root_tag.hash();

    let addr = host_node.endpoint().addr();
    let blob_ticket = BlobTicket::new(addr, root_hash, BlobFormat::HashSeq);

    Ok(SibylTicket {
        song_id: "loopback-test".into(),
        iroh_ticket: blob_ticket.to_string(),
        params: CodecParams::MP3_DEFAULT,
        title: Some("loopback".into()),
    })
}

#[tokio::test]
async fn host_peer_loopback_round_trip() -> anyhow::Result<()> {
    // tracing init is a no-op if a global subscriber is already
    // set; safe to call from multiple tests in the same binary.
    let _ = tracing_subscriber::fmt()
        .with_env_filter("sibyl_core=debug,iroh=warn,iroh_blobs=warn")
        .with_test_writer()
        .try_init();

    let host_node = SibylNode::spawn_with_preset(Minimal).await?;
    let peer_node = SibylNode::spawn_with_preset(Minimal).await?;

    // teach peer_node how to reach host_node directly. with Minimal
    // preset there's no relay or DNS, so we plug in a static lookup.
    let host_addr = host_node.endpoint().addr();
    peer_node
        .endpoint()
        .address_lookup()?
        .add(MemoryLookup::from_endpoint_info([host_addr]));

    let ticket = publish_fake_collection(&host_node).await?;

    let received: Arc<Mutex<Vec<(u32, Vec<u8>)>>> = Arc::new(Mutex::new(Vec::new()));
    let received_for_cb = received.clone();

    SibylPeer::request(peer_node.clone(), &ticket, &[], move |chunk| {
        received_for_cb
            .lock()
            .unwrap()
            .push((chunk.seq, chunk.bytes));
    })
    .await?;

    let got = received.lock().unwrap().clone();
    assert_eq!(got.len(), 3, "expected 3 chunks, got {}", got.len());
    for (i, (seq, bytes)) in got.iter().enumerate() {
        assert_eq!(*seq, i as u32, "seqs should arrive in declared order");
        assert_eq!(bytes, &vec![i as u8; 32], "payload mismatch at seq={i}");
    }

    Ok(())
}

#[tokio::test]
async fn have_chunks_skips_callback() -> anyhow::Result<()> {
    let host_node = SibylNode::spawn_with_preset(Minimal).await?;
    let peer_node = SibylNode::spawn_with_preset(Minimal).await?;

    peer_node
        .endpoint()
        .address_lookup()?
        .add(MemoryLookup::from_endpoint_info([host_node
            .endpoint()
            .addr()]));

    let ticket = publish_fake_collection(&host_node).await?;

    let received: Arc<Mutex<Vec<u32>>> = Arc::new(Mutex::new(Vec::new()));
    let received_for_cb = received.clone();

    // claim we already have seqs 0 and 2 — only seq 1 should fire.
    SibylPeer::request(peer_node.clone(), &ticket, &[0, 2], move |chunk| {
        received_for_cb.lock().unwrap().push(chunk.seq);
    })
    .await?;

    let got = received.lock().unwrap().clone();
    assert_eq!(got, vec![1], "expected only seq=1 callback, got {got:?}");

    Ok(())
}

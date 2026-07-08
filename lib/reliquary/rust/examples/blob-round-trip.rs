//! two blobz stores in tempdirs: insert into one, export its bytes, register
//! them as ingested in the other, and assert the result is byte-identical.
//! no network at all - this is the layer-2 `BlobStore` contract exercised
//! in isolation, the simplest possible walkthrough of "how do bytes move
//! between two stores".
//!
//! run with: `cargo run --example blob-round-trip --features test-utils`

use reliquary::testing::make_blobz_store;
use reliquary::{BlobStore, NewBlobMeta};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let (store_a, _tmp_a) = make_blobz_store().await;
    let (store_b, _tmp_b) = make_blobz_store().await;

    let original =
        b"blob-round-trip example bytes, byte-identical across two independent stores".to_vec();

    // insert: store a hashes the bytes, writes them to its own
    // content-addressed path, and records a row.
    let record_a = store_a
        .insert(
            &original,
            NewBlobMeta {
                filename: Some("example.txt".to_string()),
                mime: Some("text/plain".to_string()),
                ..Default::default()
            },
        )
        .await?;
    println!("store a: inserted blake3 {}", record_a.blake3);

    // export: read the bytes back out of store a. in production this
    // stands in for a verified iroh-blobs export, a network transfer, or
    // any other means the receiving side ends up with the same bytes.
    let exported = store_a
        .read_bytes(&record_a.blake3)
        .await?
        .expect("store a has the blob it just inserted");
    assert_eq!(
        exported, original,
        "exported bytes must match what was inserted"
    );

    // register_ingested: place the exported bytes at store b's canonical
    // path directly (standing in for however they actually arrived), then
    // record the metadata row - no re-hashing pass, store b just vouches
    // for the blake3 it was told about.
    let canonical_path = store_b.prepare_canonical_path(&record_a.blake3).await?;
    tokio::fs::write(&canonical_path, &exported).await?;
    let record_b = store_b
        .register_ingested(
            &record_a.blake3,
            NewBlobMeta {
                filename: record_a.filename.clone(),
                mime: record_a.mime.clone(),
                ..Default::default()
            },
        )
        .await?;
    println!("store b: registered ingested blake3 {}", record_b.blake3);

    assert_eq!(
        record_a.blake3, record_b.blake3,
        "blake3 must match across stores"
    );

    let bytes_b = store_b
        .read_bytes(&record_b.blake3)
        .await?
        .expect("store b has the blob it just registered");
    assert_eq!(
        bytes_b, original,
        "store b's bytes must be byte-identical to the original"
    );

    println!(
        "blob-round-trip: byte-identical across two independent stores ({} bytes)",
        original.len()
    );
    Ok(())
}

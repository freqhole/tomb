//! native tests for the storage-generic store actor — the payoff of the
//! BlobDir abstraction: full protocol coverage with plain `cargo test`,
//! no browser, no OPFS. adversarial cases (partial-write-then-reload, gc
//! vs tags/protection, deletion) included.

use std::{sync::Arc, time::Duration};

use bao_tree::ChunkRanges;
use bytes::Bytes;
use iroh_blobs::{api::blobs::BlobStatus, protocol::ChunkRangesExt};
use n0_future::StreamExt;

use super::{
    gc::{GcOptions, ProtectCb, ProtectOutcome},
    storage::native::NativeDir,
    OpfsStore,
};

/// run a future on a single-threaded runtime with a LocalSet (the actor
/// uses spawn_local, mirroring the wasm single-threaded model).
fn run<T>(fut: impl std::future::Future<Output = T>) -> T {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap();
    let local = tokio::task::LocalSet::new();
    local.block_on(&rt, fut)
}

fn test_payload(size: usize, seed: usize) -> Bytes {
    let mut data = vec![0u8; size];
    for (i, b) in data.iter_mut().enumerate() {
        *b = ((i * 31 + seed) % 256) as u8;
    }
    Bytes::from(data)
}

#[test]
fn import_export_round_trip() {
    run(async {
        let store = OpfsStore::new_native(NativeDir::new(), None).await.unwrap();
        // multi-group payload => real outboard
        let data = test_payload(1_500_000, 7);

        let tag = store
            .blobs()
            .add_bytes(data.clone())
            .temp_tag()
            .await
            .unwrap();
        let hash = tag.hash();

        let back = store.blobs().get_bytes(hash).await.unwrap();
        assert_eq!(back, data);

        let status = store.blobs().status(hash).await.unwrap();
        assert!(matches!(status, BlobStatus::Complete { size } if size == data.len() as u64));
    });
}

#[test]
fn small_blob_has_no_outboard_and_round_trips() {
    run(async {
        let store = OpfsStore::new_native(NativeDir::new(), None).await.unwrap();
        let data = test_payload(1000, 3); // single block group

        let tag = store
            .blobs()
            .add_bytes(data.clone())
            .temp_tag()
            .await
            .unwrap();
        let back = store.blobs().get_bytes(tag.hash()).await.unwrap();
        assert_eq!(back, data);
    });
}

#[test]
fn add_stream_chunked_import_matches_add_bytes() {
    run(async {
        let store = OpfsStore::new_native(NativeDir::new(), None).await.unwrap();
        let data = test_payload(700_000, 11);

        let chunks: Vec<std::io::Result<Bytes>> = data
            .chunks(64 * 1024)
            .map(|c| Ok(Bytes::copy_from_slice(c)))
            .collect();
        let stream = n0_future::stream::iter(chunks);
        let tag = store
            .blobs()
            .add_stream(stream)
            .await
            .temp_tag()
            .await
            .unwrap();

        let tag2 = store
            .blobs()
            .add_bytes(data.clone())
            .temp_tag()
            .await
            .unwrap();
        assert_eq!(tag.hash(), tag2.hash());

        let back = store.blobs().get_bytes(tag.hash()).await.unwrap();
        assert_eq!(back, data);
    });
}

#[test]
fn bao_export_import_between_stores() {
    run(async {
        let store1 = OpfsStore::new_native(NativeDir::new(), None).await.unwrap();
        let store2 = OpfsStore::new_native(NativeDir::new(), None).await.unwrap();
        let data = test_payload(400_000, 5);

        let tag = store1
            .blobs()
            .add_bytes(data.clone())
            .temp_tag()
            .await
            .unwrap();
        let hash = tag.hash();

        let bao = store1
            .blobs()
            .export_bao(hash, ChunkRanges::all())
            .bao_to_vec()
            .await
            .unwrap();

        store2
            .blobs()
            .import_bao_bytes(hash, ChunkRanges::all(), Bytes::from(bao))
            .await
            .unwrap();
        let back = store2.blobs().get_bytes(hash).await.unwrap();
        assert_eq!(back, data);
    });
}

#[test]
fn blobs_and_tags_survive_reload() {
    run(async {
        let dir = NativeDir::new();
        let data = test_payload(300_000, 13);
        let hash;
        {
            let store = OpfsStore::new_native(dir.clone(), None).await.unwrap();
            let tag = store
                .blobs()
                .add_bytes(data.clone())
                .temp_tag()
                .await
                .unwrap();
            hash = tag.hash();
            store
                .tags()
                .set(iroh_blobs::api::Tag::from("keep"), hash)
                .await
                .unwrap();
            store.shutdown().await.unwrap();
        }

        // a second store over the SAME directory must resume everything
        let store = OpfsStore::new_native(dir, None).await.unwrap();
        let status = store.blobs().status(hash).await.unwrap();
        assert!(
            matches!(status, BlobStatus::Complete { size } if size == data.len() as u64),
            "blob did not survive reload: {status:?}"
        );
        let back = store.blobs().get_bytes(hash).await.unwrap();
        assert_eq!(back, data);

        let mut tags = store.tags().list().await.unwrap();
        let mut found = false;
        while let Some(t) = tags.next().await {
            if t.unwrap().hash == hash {
                found = true;
            }
        }
        assert!(found, "persistent tag did not survive reload");
    });
}

#[test]
fn partial_blob_resumes_across_reload() {
    run(async {
        let dir = NativeDir::new();
        let data = test_payload(1_000_000, 17);

        // source store to produce a valid bao stream + the real hash
        let source = OpfsStore::new_native(NativeDir::new(), None).await.unwrap();
        let tag = source
            .blobs()
            .add_bytes(data.clone())
            .temp_tag()
            .await
            .unwrap();
        let hash = tag.hash();

        // import only the FIRST HALF of the bytes into the target store
        let first_half = ChunkRanges::bytes(..500_000u64);
        let bao_half = source
            .blobs()
            .export_bao(hash, first_half.clone())
            .bao_to_vec()
            .await
            .unwrap();

        {
            let store = OpfsStore::new_native(dir.clone(), None).await.unwrap();
            store
                .blobs()
                .import_bao_bytes(hash, first_half.clone(), Bytes::from(bao_half))
                .await
                .unwrap();
            let status = store.blobs().status(hash).await.unwrap();
            assert!(
                matches!(status, BlobStatus::Partial { .. }),
                "expected partial after half import: {status:?}"
            );
            store.shutdown().await.unwrap();
        }

        // reload: the partial must resume with its persisted bitfield
        let store = OpfsStore::new_native(dir, None).await.unwrap();
        let status = store.blobs().status(hash).await.unwrap();
        assert!(
            matches!(status, BlobStatus::Partial { .. }),
            "partial did not survive reload: {status:?}"
        );

        // completing with the SECOND half must produce a complete,
        // byte-identical blob — proving the persisted first half was kept
        let second_half = ChunkRanges::bytes(500_000u64..);
        let bao_rest = source
            .blobs()
            .export_bao(hash, second_half.clone())
            .bao_to_vec()
            .await
            .unwrap();
        store
            .blobs()
            .import_bao_bytes(hash, second_half, Bytes::from(bao_rest))
            .await
            .unwrap();

        let status = store.blobs().status(hash).await.unwrap();
        assert!(
            matches!(status, BlobStatus::Complete { size } if size == data.len() as u64),
            "blob not complete after resume: {status:?}"
        );
        let back = store.blobs().get_bytes(hash).await.unwrap();
        assert_eq!(back, data);
    });
}

// NOTE: there is no standalone deletion test because iroh-blobs 0.103
// exposes NO public delete api (blobs().delete* are all pub(crate)) —
// deletion is reachable only through gc, which the gc tests below cover.

/// gc: an untagged blob is swept, a tagged one survives, a protected one
/// survives without any tag.
#[test]
fn gc_sweeps_untagged_keeps_tagged_and_protected() {
    run(async {
        let protected_hash: Arc<std::sync::Mutex<Option<iroh_blobs::Hash>>> =
            Arc::new(std::sync::Mutex::new(None));
        let protected_cb = protected_hash.clone();
        let cb: ProtectCb = Arc::new(move |live| {
            let protected = protected_cb.lock().unwrap();
            if let Some(hash) = *protected {
                live.insert(hash);
            }
            Box::pin(async move { ProtectOutcome::Continue })
        });

        let store = OpfsStore::new_native(
            NativeDir::new(),
            Some(GcOptions {
                interval: Duration::from_millis(50),
                add_protected: Some(cb),
            }),
        )
        .await
        .unwrap();

        let doomed = store
            .blobs()
            .add_bytes(test_payload(50_000, 23))
            .temp_tag()
            .await
            .unwrap();
        let kept = store
            .blobs()
            .add_bytes(test_payload(50_000, 29))
            .temp_tag()
            .await
            .unwrap();
        let shielded = store
            .blobs()
            .add_bytes(test_payload(50_000, 31))
            .temp_tag()
            .await
            .unwrap();

        let doomed_hash = doomed.hash();
        let kept_hash = kept.hash();
        let shielded_hash = shielded.hash();

        // persistent tag for `kept`, protect callback for `shielded`
        store
            .tags()
            .set(iroh_blobs::api::Tag::from("kept"), kept_hash)
            .await
            .unwrap();
        *protected_hash.lock().unwrap() = Some(shielded_hash);

        // drop all temp tags (global scope, untracked — the store's gc
        // sees only persistent tags + the protect callback)
        drop(doomed);
        drop(kept);
        drop(shielded);

        // let a few gc cycles run
        n0_future::time::sleep(Duration::from_millis(300)).await;

        let doomed_status = store.blobs().status(doomed_hash).await.unwrap();
        assert!(
            matches!(doomed_status, BlobStatus::NotFound),
            "untagged blob should be swept, got {doomed_status:?}"
        );
        let kept_status = store.blobs().status(kept_hash).await.unwrap();
        assert!(
            matches!(kept_status, BlobStatus::Complete { .. }),
            "tagged blob should survive gc, got {kept_status:?}"
        );
        let shielded_status = store.blobs().status(shielded_hash).await.unwrap();
        assert!(
            matches!(shielded_status, BlobStatus::Complete { .. }),
            "protected blob should survive gc, got {shielded_status:?}"
        );
    });
}

/// deleting a tag makes the blob gc-able; renaming keeps it alive.
#[test]
fn tag_lifecycle_drives_gc() {
    run(async {
        let store = OpfsStore::new_native(
            NativeDir::new(),
            Some(GcOptions {
                interval: Duration::from_millis(50),
                add_protected: None,
            }),
        )
        .await
        .unwrap();

        let tag = store
            .blobs()
            .add_bytes(test_payload(60_000, 37))
            .temp_tag()
            .await
            .unwrap();
        let hash = tag.hash();
        store
            .tags()
            .set(iroh_blobs::api::Tag::from("a"), hash)
            .await
            .unwrap();
        drop(tag);

        n0_future::time::sleep(Duration::from_millis(200)).await;
        assert!(
            matches!(
                store.blobs().status(hash).await.unwrap(),
                BlobStatus::Complete { .. }
            ),
            "tagged blob swept prematurely"
        );

        // rename keeps it alive
        store.tags().rename("a", "b").await.unwrap();
        n0_future::time::sleep(Duration::from_millis(200)).await;
        assert!(matches!(
            store.blobs().status(hash).await.unwrap(),
            BlobStatus::Complete { .. }
        ));

        // delete the tag -> swept
        store.tags().delete("b").await.unwrap();
        n0_future::time::sleep(Duration::from_millis(300)).await;
        assert!(
            matches!(
                store.blobs().status(hash).await.unwrap(),
                BlobStatus::NotFound
            ),
            "blob should be swept after its tag was deleted"
        );
    });
}

/// export of a missing hash errors instead of hanging.
#[test]
fn export_missing_hash_errors() {
    run(async {
        let store = OpfsStore::new_native(NativeDir::new(), None).await.unwrap();
        let bogus = iroh_blobs::Hash::from_bytes([0xab; 32]);
        let result = store.blobs().get_bytes(bogus).await;
        assert!(result.is_err());
    });
}

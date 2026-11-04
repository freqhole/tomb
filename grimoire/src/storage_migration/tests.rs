use super::*;
use tempfile::TempDir;

struct Fixture {
    _temp: TempDir,
    source: PathBuf,
    target: PathBuf,
    config: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let source = root.join("old");
        let target = root.join("new");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&target).unwrap();
        let config = root.join("freqhole-config.toml");
        crate::config::create_config(Some(config.clone()), Some(source.clone()), false).unwrap();
        Self {
            _temp: temp,
            source,
            target,
            config,
        }
    }

    fn queue(&self, merge: bool) {
        schedule(
            &self.config,
            Operation::MoveData,
            &self.target,
            merge,
            CONFIRM,
        )
        .unwrap();
    }
}

#[test]
fn preflight_does_not_change_config_or_files() {
    let f = Fixture::new();
    fs::write(f.source.join("a.flac"), b"music").unwrap();
    let before = fs::read(&f.config).unwrap();
    let report = preview(&f.config, Operation::MoveData, &f.target).unwrap();
    assert_eq!(report.files, 1);
    assert_eq!(report.bytes, 5);
    assert!(report.blockers.is_empty());
    assert_eq!(fs::read(&f.config).unwrap(), before);
    assert!(!pending(&f.config).unwrap());
    assert_eq!(fs::read_dir(&f.target).unwrap().count(), 0);
}

#[test]
fn rejects_nesting_metadata_and_unconfirmed_changes() {
    let f = Fixture::new();
    let nested = f.source.join("nested");
    fs::create_dir(&nested).unwrap();
    assert!(preview(&f.config, Operation::MoveData, &nested).is_err());
    fs::write(f.target.join("grimoire.db"), b"unrelated database").unwrap();
    let report = preview(&f.config, Operation::MoveData, &f.target).unwrap();
    assert_eq!(report.blockers, vec![f.target.join("grimoire.db")]);
    assert!(schedule(&f.config, Operation::MoveData, &f.target, true, CONFIRM).is_err());
    assert!(schedule(&f.config, Operation::SelectData, &nested, false, "yes").is_err());
}

#[tokio::test]
async fn merge_keeps_both_and_reuses_identical_files() {
    let f = Fixture::new();
    fs::write(f.source.join("same.flac"), b"same").unwrap();
    fs::write(f.target.join("same.flac"), b"same").unwrap();
    fs::write(f.source.join("different.mp4"), b"incoming").unwrap();
    fs::write(f.target.join("different.mp4"), b"existing").unwrap();
    let report = preview(&f.config, Operation::MoveData, &f.target).unwrap();
    assert_eq!(report.identical, 1);
    assert_eq!(report.collisions, vec![f.target.join("different.mp4")]);
    assert!(schedule(&f.config, Operation::MoveData, &f.target, false, CONFIRM).is_err());
    f.queue(true);
    apply(&f.config).await.unwrap();
    assert_eq!(
        fs::read(f.target.join("different.mp4")).unwrap(),
        b"existing"
    );
    let copied = tree(&f.target, &f.config, false).unwrap();
    assert!(copied.iter().any(|p| fs::read(p).unwrap() == b"incoming"));
    assert!(!f.source.join("same.flac").exists());
    assert!(!f.source.join("different.mp4").exists());
    assert_eq!(read_config_from_file(&f.config).unwrap().data_dir, f.target);
}

#[tokio::test]
async fn collision_appearing_after_manifest_never_overwrites_or_deletes_source() {
    let f = Fixture::new();
    fs::write(f.source.join("a.flac"), b"incoming").unwrap();
    f.queue(false);
    let mut journal: Journal =
        serde_json::from_slice(&fs::read(pending_path(&f.config)).unwrap()).unwrap();
    journal.entries = Some(vec![Entry {
        source: f.source.join("a.flac"),
        destination: f.target.join("a.flac"),
        hash: digest(&f.source.join("a.flac")).unwrap(),
        destination_hash: None,
    }]);
    journal.config_after = Some(config_after(&journal).unwrap());
    save(&f.config, &journal).unwrap();
    fs::write(f.target.join("a.flac"), b"other").unwrap();
    assert!(apply(&f.config).await.is_err());
    assert_eq!(fs::read(f.source.join("a.flac")).unwrap(), b"incoming");
    assert_eq!(fs::read(f.target.join("a.flac")).unwrap(), b"other");
    assert_eq!(read_config_from_file(&f.config).unwrap().data_dir, f.source);
    assert!(cancel(&f.config).is_err());
}

#[tokio::test]
async fn changing_config_after_confirmation_preserves_source() {
    let f = Fixture::new();
    fs::write(f.source.join("a.flac"), b"music").unwrap();
    f.queue(false);
    let mut text = fs::read_to_string(&f.config).unwrap();
    text.push_str("\n# edited after confirmation\n");
    fs::write(&f.config, &text).unwrap();
    assert!(apply(&f.config).await.is_err());
    assert!(f.source.join("a.flac").exists());
    cancel(&f.config).unwrap();
    assert_eq!(fs::read_to_string(&f.config).unwrap(), text);
}

#[test]
fn shared_process_lease_prevents_offline_move() {
    let f = Fixture::new();
    fs::write(f.source.join("a.flac"), b"music").unwrap();
    let held = lock(&f.source.join(DATA_LOCK), false).unwrap();
    f.queue(false);
    assert!(prepare_startup(&f.config).is_err());
    assert!(f.source.join("a.flac").exists());
    drop(held);
}

#[tokio::test]
async fn select_only_keeps_source_and_requires_fresh_setup() {
    let f = Fixture::new();
    fs::write(f.source.join("a.flac"), b"music").unwrap();
    schedule(&f.config, Operation::SelectData, &f.target, false, CONFIRM).unwrap();
    apply(&f.config).await.unwrap();
    assert!(f.source.join("a.flac").exists());
    assert!(!f.target.join("a.flac").exists());
    let config = read_config_from_file(&f.config).unwrap();
    assert_eq!(config.data_dir, f.target);
    assert!(!config.database_path().exists());
}

#[tokio::test]
async fn updates_databases_paths_and_queued_json_before_removing_source() {
    let f = Fixture::new();
    let config = read_config_from_file(&f.config).unwrap();
    fs::write(f.source.join("a.flac"), b"incoming").unwrap();
    fs::write(f.target.join("a.flac"), b"existing").unwrap();
    let mut db = SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new()
            .filename(config.database_path())
            .create_if_missing(true),
    )
    .await
    .unwrap();
    sqlx::raw_sql("CREATE TABLE media_blobz (id TEXT, local_path TEXT);
        CREATE TABLE jobz (parameters TEXT, result TEXT);
        CREATE TABLE library_source_pathz (source_id TEXT, path TEXT, PRIMARY KEY(source_id, path));")
        .execute(&mut db).await.unwrap();
    sqlx::query("INSERT INTO media_blobz VALUES ('test', ?), ('outside', ?)")
        .bind(f.source.join("a.flac").to_str().unwrap())
        .bind(format!("{}-other/a.flac", f.source.display()))
        .execute(&mut db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO jobz VALUES (?, NULL)")
        .bind(
            serde_json::json!({
                "nested": [{"path": f.source.join("a.flac")}], "root": f.source,
            })
            .to_string(),
        )
        .execute(&mut db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO library_source_pathz VALUES ('x', ?)")
        .bind(f.source.to_str().unwrap())
        .execute(&mut db)
        .await
        .unwrap();
    db.close().await.unwrap();
    let mut blobs = SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new()
            .filename(config.reliquary_db_path())
            .create_if_missing(true),
    )
    .await
    .unwrap();
    sqlx::raw_sql("CREATE TABLE blobz (path TEXT)")
        .execute(&mut blobs)
        .await
        .unwrap();
    sqlx::query("INSERT INTO blobz VALUES (?)")
        .bind(f.source.join("a.flac").to_str().unwrap())
        .execute(&mut blobs)
        .await
        .unwrap();
    blobs.close().await.unwrap();
    f.queue(true);
    apply(&f.config).await.unwrap();
    assert!(!config.database_path().exists());
    let mut db = connect_file(&f.target.join(&config.database.filename))
        .await
        .unwrap();
    let mapped: String = sqlx::query_scalar("SELECT local_path FROM media_blobz WHERE id = 'test'")
        .fetch_one(&mut db)
        .await
        .unwrap();
    assert_ne!(mapped, f.target.join("a.flac").to_str().unwrap());
    assert_eq!(fs::read(&mapped).unwrap(), b"incoming");
    let outside: String =
        sqlx::query_scalar("SELECT local_path FROM media_blobz WHERE id = 'outside'")
            .fetch_one(&mut db)
            .await
            .unwrap();
    assert_eq!(outside, format!("{}-other/a.flac", f.source.display()));
    let json: String = sqlx::query_scalar("SELECT parameters FROM jobz")
        .fetch_one(&mut db)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(json["nested"][0]["path"], mapped);
    assert_eq!(json["root"], f.target.to_str().unwrap());
    let root: String = sqlx::query_scalar("SELECT path FROM library_source_pathz")
        .fetch_one(&mut db)
        .await
        .unwrap();
    assert_eq!(root, f.target.to_str().unwrap());
    db.close().await.unwrap();
    let mut blobs = connect_file(&f.target.join("reliquary.db")).await.unwrap();
    let blob_path: String = sqlx::query_scalar("SELECT path FROM blobz")
        .fetch_one(&mut blobs)
        .await
        .unwrap();
    assert_eq!(blob_path, mapped);
    blobs.close().await.unwrap();
}

#[tokio::test]
async fn copied_manifest_resumes_without_replacing_files() {
    let f = Fixture::new();
    fs::write(f.source.join("a.flac"), b"music").unwrap();
    f.queue(false);
    let mut journal: Journal =
        serde_json::from_slice(&fs::read(pending_path(&f.config)).unwrap()).unwrap();
    let entry = Entry {
        source: f.source.join("a.flac"),
        destination: f.target.join("a.flac"),
        hash: digest(&f.source.join("a.flac")).unwrap(),
        destination_hash: None,
    };
    copy_verified(&entry).unwrap();
    journal.entries = Some(vec![entry]);
    journal.config_after = Some(config_after(&journal).unwrap());
    save(&f.config, &journal).unwrap();
    apply(&f.config).await.unwrap();
    assert_eq!(fs::read(f.target.join("a.flac")).unwrap(), b"music");
    assert!(!pending(&f.config).unwrap());
    assert!(!f.source.join("a.flac").exists());
}

#[tokio::test]
async fn fetch_move_updates_paths_without_switching_data_or_deleting_other_media() {
    let f = Fixture::new();
    let fetch = f.source.join("fetch");
    fs::create_dir_all(&fetch).unwrap();
    fs::write(fetch.join("a.flac"), b"fetched").unwrap();
    fs::write(f.source.join("other.flac"), b"other").unwrap();
    assign_fetch_directory(&f.config, &fetch).unwrap();
    schedule(&f.config, Operation::MoveFetch, &f.target, false, CONFIRM).unwrap();
    apply(&f.config).await.unwrap();
    assert!(!fetch.join("a.flac").exists());
    assert_eq!(fs::read(f.target.join("a.flac")).unwrap(), b"fetched");
    assert_eq!(fs::read(f.source.join("other.flac")).unwrap(), b"other");
    let config = read_config_from_file(&f.config).unwrap();
    assert_eq!(config.data_dir, f.source);
    assert_eq!(
        config
            .server
            .unwrap()
            .fetch_video
            .unwrap()
            .output_dir
            .unwrap(),
        f.target.to_str().unwrap()
    );
}

#[tokio::test]
async fn keeps_config_anchor_and_updates_host_preferences() {
    let f = Fixture::new();
    let config = f.source.join("freqhole-config.toml");
    fs::rename(&f.config, &config).unwrap();
    let prefs = f.source.join("charnel-config.toml");
    fs::write(
        &prefs,
        format!(
            "server_config_path = {:?}\n[[external_storage_devices]]\npath = {:?}\n",
            config.to_str().unwrap(),
            f.source.join("music").to_str().unwrap(),
        ),
    )
    .unwrap();
    fs::write(f.source.join("a.flac"), b"music").unwrap();
    schedule(&config, Operation::MoveData, &f.target, false, CONFIRM).unwrap();
    apply(&config).await.unwrap();
    assert!(config.is_file());
    assert!(!f.target.join("freqhole-config.toml").exists());
    let prefs: toml::Value = fs::read_to_string(prefs).unwrap().parse().unwrap();
    assert_eq!(
        prefs["server_config_path"].as_str().unwrap(),
        config.to_str().unwrap()
    );
    assert_eq!(
        prefs["external_storage_devices"][0]["path"]
            .as_str()
            .unwrap(),
        f.target.join("music").to_str().unwrap()
    );
    assert_eq!(read_config_from_file(&config).unwrap().data_dir, f.target);
}

#[test]
fn assign_fetch_changes_only_future_storage() {
    let f = Fixture::new();
    fs::write(f.source.join("a.flac"), b"music").unwrap();
    assign_fetch_directory(&f.config, &f.target).unwrap();
    let config = read_config_from_file(&f.config).unwrap();
    assert_eq!(config.data_dir, f.source);
    assert_eq!(
        config
            .server
            .unwrap()
            .fetch_music
            .unwrap()
            .output_dir
            .unwrap(),
        f.target.to_str().unwrap()
    );
    assert!(f.source.join("a.flac").exists());
}

#[cfg(unix)]
#[test]
fn refuses_symlinks_even_when_their_contents_match() {
    let f = Fixture::new();
    fs::write(f.source.join("a.flac"), b"music").unwrap();
    std::os::unix::fs::symlink(f.source.join("a.flac"), f.target.join("a.flac")).unwrap();
    assert!(preview(&f.config, Operation::MoveData, &f.target).is_err());
}

#[tokio::test]
async fn malformed_p2p_index_stops_before_config_cutover_or_source_deletion() {
    let f = Fixture::new();
    fs::create_dir(f.source.join("freqhole-blobz")).unwrap();
    fs::write(f.source.join("freqhole-blobz/blobs.db"), b"index").unwrap();
    let report = preview(&f.config, Operation::MoveData, &f.target).unwrap();
    assert!(report.blocked_reason.is_none());
    schedule(&f.config, Operation::MoveData, &f.target, true, CONFIRM).unwrap();
    assert!(apply(&f.config).await.is_err());
    assert_eq!(
        fs::read(f.source.join("freqhole-blobz/blobs.db")).unwrap(),
        b"index"
    );
    assert_eq!(read_config_from_file(&f.config).unwrap().data_dir, f.source);
    assert!(pending(&f.config).unwrap());
}

#[tokio::test]
async fn data_and_fetch_moves_repair_real_p2p_references_before_cleanup() {
    use iroh_blobs::api::blobs::{AddPathOptions, ImportMode};
    use iroh_blobs::store::fs::FsStore;
    for operation in [Operation::MoveData, Operation::MoveFetch] {
        let f = Fixture::new();
        fs::create_dir_all(f.source.join("fetch")).unwrap();
        let old = f.source.join("fetch/a-media.flac");
        let bytes = vec![0x31; 1024 * 1024];
        fs::write(&old, &bytes).unwrap();
        let store = FsStore::load(f.source.join("freqhole-blobz"))
            .await
            .unwrap();
        let tag = store
            .blobs()
            .add_path_with_opts(AddPathOptions {
                path: old.clone(),
                format: iroh_blobs::BlobFormat::Raw,
                mode: ImportMode::TryReference,
            })
            .await
            .unwrap();
        let hash = tag.hash;
        store.sync_db().await.unwrap();
        store.shutdown().await.unwrap();
        drop((tag, store));
        schedule(&f.config, operation, &f.target, false, CONFIRM).unwrap();
        apply(&f.config).await.unwrap();
        assert!(!old.exists());
        let (index, new) = if operation == Operation::MoveData {
            (
                f.target.join("freqhole-blobz"),
                f.target.join("fetch/a-media.flac"),
            )
        } else {
            (
                f.source.join("freqhole-blobz"),
                f.target.join("a-media.flac"),
            )
        };
        assert_eq!(fs::read(new).unwrap(), bytes);
        let store = FsStore::load(index).await.unwrap();
        assert_eq!(store.blobs().get_bytes(hash).await.unwrap().as_ref(), bytes);
        assert_reference_transfer_and_shutdown(&store, hash, Some(&bytes)).await;
        assert!(!pending(&f.config).unwrap());
    }
}

#[tokio::test]
async fn reference_audit_is_read_only_until_repair_and_can_be_repeated() {
    let f = Fixture::new();
    let old = f.source.join("a-old.flac");
    let new = f.source.join("z-new.flac");
    let bytes = vec![0x42; 1024 * 1024];
    fs::write(&old, &bytes).unwrap();
    let hash = iroh_blobs::Hash::new(&bytes);
    let index = f.source.join("freqhole-blobz");
    let store = iroh_blobs::store::fs::FsStore::load(&index).await.unwrap();
    reliquary::node::import_try_reference(&store, &old)
        .await
        .unwrap();
    store.sync_db().await.unwrap();
    store.shutdown().await.unwrap();
    drop(store);
    fs::rename(&old, &new).unwrap();
    let config = read_config_from_file(&f.config).unwrap();
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(config.database_path())
        .create_if_missing(true);
    let mut db = SqliteConnection::connect_with(&options).await.unwrap();
    sqlx::query("CREATE TABLE media_blobz (blake3 TEXT, local_path TEXT, deleted_at INTEGER)")
        .execute(&mut db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO media_blobz (blake3, local_path) VALUES (?, ?)")
        .bind(hash.to_hex().to_string())
        .bind(new.to_str().unwrap())
        .execute(&mut db)
        .await
        .unwrap();
    sqlx::query("INSERT INTO media_blobz (blake3, local_path) VALUES (?, ?)")
        .bind(iroh_blobs::Hash::new(b"missing").to_hex().to_string())
        .bind(f.source.join("missing").to_str().unwrap())
        .execute(&mut db)
        .await
        .unwrap();
    db.close().await.unwrap();
    let before = fs::read(index.join("blobs.db")).unwrap();
    let report = audit_references(&f.config, false).unwrap();
    assert_eq!(
        report
            .entries
            .iter()
            .filter(|e| e.status == "source_verified")
            .count(),
        1
    );
    assert_eq!(
        report.entries.iter().filter(|e| e.error.is_some()).count(),
        1
    );
    assert_eq!(fs::read(index.join("blobs.db")).unwrap(), before);
    for _ in 0..2 {
        let report = audit_references(&f.config, true).unwrap();
        assert_eq!(
            report
                .entries
                .iter()
                .filter(|e| e.status == "repaired")
                .count(),
            1
        );
        assert_eq!(
            report.entries.iter().filter(|e| e.error.is_some()).count(),
            1
        );
    }
    let store = iroh_blobs::store::fs::FsStore::load(index).await.unwrap();
    assert_reference_transfer_and_shutdown(&store, hash, Some(&bytes)).await;
}

#[tokio::test]
async fn resumes_after_transport_repair_before_its_journal_commit() {
    let f = Fixture::new();
    let old = f.source.join("a-media.flac");
    let bytes = vec![0x73; 1024 * 1024];
    fs::write(&old, &bytes).unwrap();
    let store = iroh_blobs::store::fs::FsStore::load(f.source.join("freqhole-blobz"))
        .await
        .unwrap();
    let hash = reliquary::node::import_try_reference(&store, &old)
        .await
        .unwrap();
    store.sync_db().await.unwrap();
    store.shutdown().await.unwrap();
    drop(store);
    f.queue(false);
    let mut journal: Journal =
        serde_json::from_slice(&fs::read(pending_path(&f.config)).unwrap()).unwrap();
    let entries: Vec<_> = tree(&f.source, &f.config, true)
        .unwrap()
        .into_iter()
        .map(|source| {
            let destination = f.target.join(source.strip_prefix(&f.source).unwrap());
            let hash = digest(&source).unwrap();
            Entry {
                source,
                destination,
                hash: hash.clone(),
                destination_hash: Some(hash),
            }
        })
        .collect();
    for entry in &entries {
        copy_verified(entry).unwrap();
    }
    journal.entries = Some(entries);
    journal.config_after = Some(config_after(&journal).unwrap());
    journal.copied = true;
    journal.paths_updated = true;
    save(&f.config, &journal).unwrap();
    repair_moved_references(
        &f.target.join("freqhole-blobz"),
        journal.entries.as_deref().unwrap(),
    )
    .await
    .unwrap();
    // simulate interruption before references_updated and new index hashes were saved.
    apply(&f.config).await.unwrap();
    assert!(!old.exists());
    let store = iroh_blobs::store::fs::FsStore::load(f.target.join("freqhole-blobz"))
        .await
        .unwrap();
    assert_reference_transfer_and_shutdown(&store, hash, Some(&bytes)).await;
}

#[tokio::test]
async fn upstream_reference_reimport_survives_reopen_and_serves_new_path() {
    use iroh_blobs::api::blobs::{AddPathOptions, ImportMode};
    use iroh_blobs::store::fs::FsStore;
    let temp = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(temp.path()).unwrap();
    let old = root.join("a-old.flac");
    let new = root.join("z-new.flac");
    // exceed the inline-data threshold so this really exercises External paths.
    let bytes = vec![0x55; 1024 * 1024];
    fs::write(&old, &bytes).unwrap();
    let store_dir = root.join("index");
    let store = FsStore::load(&store_dir).await.unwrap();
    let tag = store
        .blobs()
        .add_path_with_opts(AddPathOptions {
            path: old.clone(),
            format: iroh_blobs::BlobFormat::Raw,
            mode: ImportMode::TryReference,
        })
        .await
        .unwrap();
    let hash = tag.hash;
    store.sync_db().await.unwrap();
    assert_reference_transfer_and_shutdown(&store, hash, Some(&bytes)).await;
    drop((tag, store));
    fs::rename(&old, &new).unwrap();
    let store = FsStore::load(&store_dir).await.unwrap();
    assert!(store.blobs().has(hash).await.unwrap());
    assert_eq!(fs::read(&new).unwrap(), bytes);
    assert!(store.blobs().get_bytes(hash).await.is_err());
    let tag = store
        .blobs()
        .add_path_with_opts(AddPathOptions {
            path: new.clone(),
            format: iroh_blobs::BlobFormat::Raw,
            mode: ImportMode::TryReference,
        })
        .await
        .unwrap();
    assert_eq!(tag.hash, hash);
    store.sync_db().await.unwrap();
    store.shutdown().await.unwrap();
    drop((tag, store));
    let store = FsStore::load(&store_dir).await.unwrap();
    assert!(store.blobs().has(hash).await.unwrap());
    assert_eq!(store.blobs().get_bytes(hash).await.unwrap().as_ref(), bytes);
    assert!(store
        .blobs()
        .export(hash, root.join("export.flac"))
        .await
        .is_err());
    reliquary::references::export_from_reader(&store, hash, &root.join("fixed-export.flac"))
        .await
        .unwrap();
    assert_eq!(fs::read(root.join("fixed-export.flac")).unwrap(), bytes);
    assert_reference_transfer_and_shutdown(&store, hash, Some(&bytes)).await;
    drop(store);

    fs::copy(&new, &old).unwrap();
    let store = FsStore::load(&store_dir).await.unwrap();
    assert_eq!(store.blobs().get_bytes(hash).await.unwrap().as_ref(), bytes);
    store.shutdown().await.unwrap();
    drop(store);

    fs::remove_file(&old).unwrap();
    let store = FsStore::load(&store_dir).await.unwrap();
    assert_eq!(store.blobs().get_bytes(hash).await.unwrap().as_ref(), bytes);
    // the convenience API uses Copy, unlike our explicit TryReference imports.
    let tag = store.blobs().add_path(&new).await.unwrap();
    assert_eq!(tag.hash, hash);
    store.sync_db().await.unwrap();
    store.shutdown().await.unwrap();
    drop((tag, store));
    let store = FsStore::load(&store_dir).await.unwrap();
    assert_eq!(store.blobs().get_bytes(hash).await.unwrap().as_ref(), bytes);
    let exported = root.join("repaired-export.flac");
    store.blobs().export(hash, &exported).await.unwrap();
    assert_eq!(fs::read(exported).unwrap(), bytes);
    assert_reference_transfer_and_shutdown(&store, hash, Some(&bytes)).await;
}

async fn assert_reference_transfer_and_shutdown(
    source: &iroh_blobs::store::fs::FsStore,
    hash: iroh_blobs::Hash,
    expected: Option<&[u8]>,
) {
    use iroh::{address_lookup::MemoryLookup, protocol::Router, Endpoint, RelayMode};
    use iroh_blobs::{
        api::downloader::Downloader, store::mem::MemStore, BlobsProtocol, HashAndFormat,
    };
    let provider = Endpoint::builder(iroh::endpoint::presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .clear_ip_transports()
        .bind_addr("127.0.0.1:0")
        .unwrap()
        .bind()
        .await
        .unwrap();
    let router = Router::builder(provider)
        .accept(iroh_blobs::ALPN, BlobsProtocol::new(source, None))
        .spawn();
    let address = router.endpoint().addr();
    let lookup = MemoryLookup::new();
    lookup.add_endpoint_info(address.clone());
    let receiver = Endpoint::builder(iroh::endpoint::presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .clear_ip_transports()
        .bind_addr("127.0.0.1:0")
        .unwrap()
        .address_lookup(lookup)
        .bind()
        .await
        .unwrap();
    let destination = MemStore::new();
    let downloader = Downloader::new(&destination, &receiver);
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        downloader.download(HashAndFormat::raw(hash), [address.id]),
    )
    .await
    .expect("transfer must resolve, not hang");
    match expected {
        Some(bytes) => {
            result.expect("healthy reference must transfer");
            assert_eq!(
                destination.blobs().get_bytes(hash).await.unwrap().as_ref(),
                bytes
            );
        }
        None => assert!(
            result.is_err(),
            "stale reference must fail the real transfer"
        ),
    }
    drop(downloader);
    receiver.close().await;
    router.shutdown().await.unwrap();
}

#[tokio::test]
async fn upstream_reference_reimport_can_heal_when_new_path_sorts_first() {
    use iroh_blobs::api::blobs::{AddPathOptions, ImportMode};
    use iroh_blobs::store::fs::FsStore;
    let temp = tempfile::tempdir().unwrap();
    let root = fs::canonicalize(temp.path()).unwrap();
    let old = root.join("z-old.flac");
    let new = root.join("a-new.flac");
    let bytes = vec![0x55; 1024 * 1024];
    fs::write(&old, &bytes).unwrap();
    let store_dir = root.join("index");
    let store = FsStore::load(&store_dir).await.unwrap();
    let tag = store
        .blobs()
        .add_path_with_opts(AddPathOptions {
            path: old.clone(),
            format: iroh_blobs::BlobFormat::Raw,
            mode: ImportMode::TryReference,
        })
        .await
        .unwrap();
    let hash = tag.hash;
    store.sync_db().await.unwrap();
    store.shutdown().await.unwrap();
    drop((tag, store));
    fs::rename(&old, &new).unwrap();
    let store = FsStore::load(&store_dir).await.unwrap();
    assert!(store.blobs().has(hash).await.unwrap());
    assert!(store.blobs().get_bytes(hash).await.is_err());
    let tag = store
        .blobs()
        .add_path_with_opts(AddPathOptions {
            path: new,
            format: iroh_blobs::BlobFormat::Raw,
            mode: ImportMode::TryReference,
        })
        .await
        .unwrap();
    assert_eq!(tag.hash, hash);
    store.sync_db().await.unwrap();
    store.shutdown().await.unwrap();
    drop((tag, store));
    let store = FsStore::load(&store_dir).await.unwrap();
    assert_eq!(store.blobs().get_bytes(hash).await.unwrap().as_ref(), bytes);
    assert_reference_transfer_and_shutdown(&store, hash, Some(&bytes)).await;
}

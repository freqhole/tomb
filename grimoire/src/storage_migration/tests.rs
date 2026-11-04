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

#[test]
fn p2p_index_blocks_moves_but_not_select_or_future_fetch_assignment() {
    let f = Fixture::new();
    fs::create_dir(f.source.join("freqhole-blobz")).unwrap();
    fs::write(f.source.join("freqhole-blobz/blobs.db"), b"index").unwrap();
    let report = preview(&f.config, Operation::MoveData, &f.target).unwrap();
    assert!(report
        .blocked_reason
        .unwrap()
        .contains("absolute file references"));
    assert!(schedule(&f.config, Operation::MoveData, &f.target, true, CONFIRM).is_err());
    assert!(preview(&f.config, Operation::SelectData, &f.target)
        .unwrap()
        .blocked_reason
        .is_none());
    assign_fetch_directory(&f.config, &f.target).unwrap();
}

#[tokio::test]
async fn upstream_reference_paths_survive_reopen_and_reimport_does_not_replace_them() {
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
    store.shutdown().await.unwrap();
    drop((tag, store));
    fs::rename(&old, &new).unwrap();
    let store = FsStore::load(&store_dir).await.unwrap();
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
    assert!(store.blobs().get_bytes(hash).await.is_err());
    store.shutdown().await.unwrap();
}

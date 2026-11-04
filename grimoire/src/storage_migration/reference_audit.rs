use super::*;
use std::collections::BTreeMap;

#[derive(Debug, Serialize)]
pub struct ReferenceAudit {
    pub repair: bool,
    pub entries: Vec<ReferenceAuditEntry>,
}

#[derive(Debug, Serialize)]
pub struct ReferenceAuditEntry {
    pub hash: String,
    pub path: Option<PathBuf>,
    pub status: &'static str,
    pub error: Option<String>,
}

/// offline and restartable: successful registrations are durable and no files are removed.
pub fn audit_references(config: &Path, repair: bool) -> Result<ReferenceAudit> {
    let path = fs::canonicalize(config)?;
    let _queue = lock(&path.with_extension("toml.storage-queue.lock"), true)?;
    if pending(&path)? {
        bail!("finish or cancel the pending storage change before auditing references");
    }
    let config = read_config_from_file(&path)?;
    let root = fs::canonicalize(&config.data_dir)?;
    let _data = lock(&root.join(DATA_LOCK), true)?;
    std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?
            .block_on(audit(&config, repair))
    })
    .join()
    .map_err(|_| anyhow::anyhow!("reference audit worker panicked"))?
}

async fn candidates(config: &GrimoireConfig) -> Result<BTreeMap<String, Vec<PathBuf>>> {
    let mut candidates: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    for (database, table, owned_root) in [
        (config.database_path(), "media_blobz", None),
        (
            config.reliquary_db_path(),
            "blobz",
            Some(config.data_dir.join("blob-files")),
        ),
    ] {
        if !database.try_exists()? {
            continue;
        }
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(database)
            .read_only(true);
        let mut connection = SqliteConnection::connect_with(&options).await?;
        let exists = sqlx::query_scalar!(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
            table,
        )
        .fetch_one(&mut connection)
        .await?;
        if exists > 0 {
            let rows = if owned_root.is_some() {
                reliquary::blobz::reference_paths(&mut connection).await?
            } else {
                sqlx::query!(
                    r#"SELECT blake3 AS "hash!", local_path AS "path!"
                       FROM media_blobz
                       WHERE blake3 IS NOT NULL AND local_path IS NOT NULL AND deleted_at IS NULL"#,
                )
                .fetch_all(&mut connection)
                .await?
                .into_iter()
                .map(|row| (row.hash, row.path))
                .collect()
            };
            for (hash, path) in rows {
                let path = PathBuf::from(path);
                let path = match &owned_root {
                    Some(root) => root.join(path),
                    None => path,
                };
                let paths = candidates.entry(hash).or_default();
                if !paths.contains(&path) {
                    paths.push(path);
                }
            }
        }
        connection.close().await?;
    }
    Ok(candidates)
}

async fn audit(config: &GrimoireConfig, repair: bool) -> Result<ReferenceAudit> {
    let candidates = candidates(config).await?;
    let store = if repair {
        if !config.freqhole_blobz_path().join("blobs.db").try_exists()? {
            bail!("no existing transport index; use blob backfill to initialize one");
        }
        Some(iroh_blobs::store::fs::FsStore::load(config.freqhole_blobz_path()).await?)
    } else {
        None
    };
    let result = audit_candidates(candidates, store.as_ref(), |_, _| async { Ok(()) }).await;
    if let Some(store) = store {
        store.shutdown().await?;
    }
    result
}

pub(crate) async fn audit_online<F, Fut>(repair: bool, progress: F) -> Result<ReferenceAudit>
where
    F: FnMut(usize, usize) -> Fut,
    Fut: std::future::Future<Output = Result<()>>,
{
    let config = crate::config::get_config();
    let candidates = candidates(&config).await?;
    let store = if repair {
        Some(crate::database::storage_node().await?.fs_store)
    } else {
        None
    };
    audit_candidates(candidates, store, progress).await
}

async fn audit_candidates<F, Fut>(
    candidates: BTreeMap<String, Vec<PathBuf>>,
    store: Option<&iroh_blobs::store::fs::FsStore>,
    mut progress: F,
) -> Result<ReferenceAudit>
where
    F: FnMut(usize, usize) -> Fut,
    Fut: std::future::Future<Output = Result<()>>,
{
    let registration = reliquary::references::ReferenceRepair::default();
    let mut report = ReferenceAudit {
        repair: store.is_some(),
        entries: Vec::new(),
    };
    let total = candidates.len();
    progress(0, total).await?;
    for (hash, paths) in candidates {
        let mut entry = ReferenceAuditEntry {
            hash: hash.clone(),
            path: None,
            status: "unresolved",
            error: None,
        };
        let mut failures = Vec::new();
        for path in paths {
            let result: Result<()> = async {
                let expected = hash.parse::<iroh_blobs::Hash>()?;
                if let Some(store) = store {
                    registration.ensure(store, expected, &path).await?;
                } else if reliquary::hash_file(&path).await? != expected.to_hex().as_str() {
                    bail!("content does not match expected hash {hash}");
                }
                Ok(())
            }
            .await;
            match result {
                Ok(()) => {
                    entry.path = Some(path);
                    entry.status = if store.is_some() {
                        "repaired"
                    } else {
                        "source_verified"
                    };
                    break;
                }
                Err(error) => {
                    tracing::warn!(%hash, path = %path.display(), error = %error, "reference audit candidate failed");
                    failures.push(format!("{}: {error:#}", path.display()));
                }
            }
        }
        if entry.path.is_none() {
            entry.error = Some(failures.join("; "));
        }
        report.entries.push(entry);
        progress(report.entries.len(), total).await?;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn online_engine_repairs_with_borrowed_store_and_reports_missing_files() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("media");
        let bytes = vec![2; 1024 * 1024];
        let hash = iroh_blobs::Hash::new(&bytes);
        tokio::fs::write(&source, &bytes).await.unwrap();
        let missing = iroh_blobs::Hash::new(b"missing").to_string();
        let candidates = BTreeMap::from([
            (hash.to_string(), vec![source]),
            (missing.clone(), vec![temporary.path().join("missing")]),
        ]);
        let store = iroh_blobs::store::fs::FsStore::load(temporary.path().join("store"))
            .await
            .unwrap();
        let mut ticks = Vec::new();
        let report = audit_candidates(candidates, Some(&store), |checked, total| {
            ticks.push((checked, total));
            async { Ok(()) }
        })
        .await
        .unwrap();
        assert_eq!(ticks, [(0, 2), (1, 2), (2, 2)]);
        assert!(report.repair);
        assert!(report
            .entries
            .iter()
            .any(|entry| entry.status == "repaired"));
        assert!(report
            .entries
            .iter()
            .any(|entry| entry.hash == missing && entry.error.is_some()));
        reliquary::references::verify_read(&store, hash)
            .await
            .unwrap();
        // the live node still owns and can use this store after the job.
        store
            .blobs()
            .add_bytes(b"still open".to_vec())
            .await
            .unwrap();
        store.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn online_engine_audit_only_never_registers_and_honors_cancellation() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("media");
        tokio::fs::write(&source, b"verified").await.unwrap();
        let hash = iroh_blobs::Hash::new(b"verified");
        let candidates = BTreeMap::from([(hash.to_string(), vec![source])]);
        let report = audit_candidates(candidates.clone(), None, |_, _| async { Ok(()) })
            .await
            .unwrap();
        assert!(!report.repair);
        assert_eq!(report.entries[0].status, "source_verified");
        assert!(!temporary.path().join("store").exists());
        let report = audit_candidates(candidates, None, |_, _| async {
            anyhow::bail!("cancelled")
        })
        .await;
        assert!(report.unwrap_err().to_string().contains("cancelled"));
    }
}

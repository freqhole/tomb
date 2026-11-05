//! restart-time storage moves. source files survive until the config cutover.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::{Connection, Row, SqliteConnection};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tempfile::NamedTempFile;
use toml_edit::{value, DocumentMut, Item};

use crate::config::{read_config_from_file, GrimoireConfig};

mod reference_audit;
pub(crate) use reference_audit::audit_online as audit_references_online;
#[cfg(test)]
mod tests;
pub use reference_audit::{audit_references, ReferenceAudit, ReferenceAuditEntry};

const DATA_LOCK: &str = ".freqhole-storage.lock";
const CONFIRM: &str = "move my storage";
type StorageLeases = HashMap<PathBuf, (PathBuf, Vec<File>)>;
static LEASES: OnceLock<Mutex<StorageLeases>> = OnceLock::new();

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, clap::ValueEnum)]
#[serde(rename_all = "snake_case")]
pub enum Operation {
    MoveData,
    MoveFetch,
    SelectData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preview {
    pub operation: Operation,
    pub source: PathBuf,
    pub destination: PathBuf,
    pub files: usize,
    pub bytes: u64,
    pub identical: usize,
    pub collisions: Vec<PathBuf>,
    pub blockers: Vec<PathBuf>,
    pub destination_has_media: bool,
    #[serde(default)]
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    source: PathBuf,
    destination: PathBuf,
    hash: String,
    #[serde(default)]
    destination_hash: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Journal {
    version: u8,
    preview: Preview,
    config_before: String,
    config_after: Option<String>,
    merge: bool,
    entries: Option<Vec<Entry>>,
    copied: bool,
    paths_updated: bool,
    #[serde(default)]
    references_updated: bool,
    committed: bool,
    #[serde(default)]
    preferences: Option<DocumentChange>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DocumentChange {
    path: PathBuf,
    before: String,
    after: Option<String>,
}

fn pending_path(config: &Path) -> PathBuf {
    config.with_extension("toml.storage-move.json")
}

fn lock(path: &Path, exclusive: bool) -> Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    if exclusive {
        file.try_lock().with_context(|| {
            format!(
                "storage is in use; close all freqhole apps using {}",
                path.display()
            )
        })?;
    } else {
        file.try_lock_shared()
            .with_context(|| format!("storage migration is running: {}", path.display()))?;
    }
    Ok(file)
}

fn digest(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = [0; 128 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

fn sync_parent(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path.parent().context("path has no parent")?)?.sync_all()?;
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8], replace: bool) -> Result<()> {
    let mut temp = NamedTempFile::new_in(path.parent().context("path has no parent")?)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    if replace {
        temp.persist(path).map_err(|e| e.error)?;
    } else {
        temp.persist_noclobber(path).map_err(|e| e.error)?;
    }
    sync_parent(path)
}

fn save(config: &Path, journal: &Journal) -> Result<()> {
    write_atomic(
        &pending_path(config),
        &serde_json::to_vec_pretty(journal)?,
        true,
    )
}

fn canonical_dir(path: &Path) -> Result<PathBuf> {
    if !path.is_absolute() {
        bail!("choose an absolute directory path");
    }
    let path = fs::canonicalize(path)
        .with_context(|| format!("directory must already exist: {}", path.display()))?;
    if !path.is_dir() {
        bail!("not a directory: {}", path.display());
    }
    Ok(path)
}

fn media(path: &Path) -> bool {
    mime_guess::from_path(path).first_raw().is_some_and(|mime| {
        mime.starts_with("audio/") || mime.starts_with("video/") || mime.starts_with("image/")
    })
}

fn retained(path: &Path, config: &Path, root: &Path) -> bool {
    path == config || path == pending_path(config)
        || path == config.with_extension("toml.storage.lock")
        || path == config.with_extension("toml.storage-queue.lock")
        || path == config.with_extension("toml.storage-before")
        || path == root.join(DATA_LOCK)
        // the host's preferences, webview state and logs do not belong to grimoire.
        || path.strip_prefix(root).ok().and_then(|p| p.components().next())
            .is_some_and(|p| matches!(p.as_os_str().to_str(),
                Some("charnel-config.toml" | "charnel.log" | "logs" | "WebKit" | "EBWebView" | "webview")))
}

fn tree(root: &Path, config: &Path, retain_host: bool) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    for item in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.path() != root.join(DATA_LOCK) && (!retain_host || !retained(e.path(), config, root))
        })
    {
        let item = item?;
        if item.path() == root {
            continue;
        }
        if item.file_type().is_symlink()
            || (!item.file_type().is_dir() && !item.file_type().is_file())
        {
            bail!(
                "symlinks and special files cannot be migrated: {}",
                item.path().display()
            );
        }
        if item.file_type().is_file() {
            paths.push(item.into_path());
        }
    }
    paths.sort();
    Ok(paths)
}

fn roots(config: &GrimoireConfig, operation: Operation) -> Result<PathBuf> {
    match operation {
        Operation::MoveData | Operation::SelectData => Ok(fs::canonicalize(&config.data_dir)?),
        Operation::MoveFetch => {
            let music = config
                .server
                .as_ref()
                .and_then(|s| s.fetch_music.as_ref())
                .and_then(|f| f.output_dir.as_ref())
                .map(PathBuf::from)
                .unwrap_or_else(|| config.data_dir.join("fetch"));
            let video = config
                .server
                .as_ref()
                .and_then(|s| s.fetch_video.as_ref())
                .and_then(|f| f.output_dir.as_ref())
                .map(PathBuf::from)
                .unwrap_or_else(|| config.data_dir.join("fetch"));
            if fs::canonicalize(&music)? != fs::canonicalize(&video)? {
                bail!("music and video fetch folders differ; migrate them separately before using a shared folder");
            }
            let source = fs::canonicalize(music)?;
            let data = fs::canonicalize(&config.data_dir)?;
            if data.starts_with(&source) {
                bail!("the fetch folder must not contain the data directory");
            }
            Ok(source)
        }
    }
}

pub fn preview(config_path: &Path, operation: Operation, destination: &Path) -> Result<Preview> {
    let config_path = fs::canonicalize(config_path)?;
    let config = read_config_from_file(&config_path)?;
    let source = roots(&config, operation)?;
    let destination = canonical_dir(destination)?;
    if source.starts_with(&destination) || destination.starts_with(&source) {
        bail!("source and destination must be separate, non-nested directories");
    }
    if config_path.starts_with(&destination) {
        bail!("the destination cannot contain the active config");
    }
    let mut result = Preview {
        operation,
        source,
        destination,
        files: 0,
        bytes: 0,
        identical: 0,
        collisions: Vec::new(),
        blockers: Vec::new(),
        destination_has_media: false,
        blocked_reason: None,
    };
    for path in tree(&result.destination, &config_path, false)? {
        if path.file_name().is_some_and(|n| n == DATA_LOCK) {
            continue;
        }
        if media(&path) {
            result.destination_has_media = true;
        } else {
            result.blockers.push(path);
        }
    }
    if operation == Operation::SelectData {
        result.blocked_reason = destination_problem(&result);
        return Ok(result);
    }
    for path in tree(
        &result.source,
        &config_path,
        operation == Operation::MoveData,
    )? {
        result.files += 1;
        result.bytes += fs::metadata(&path)?.len();
        let target = result.destination.join(path.strip_prefix(&result.source)?);
        if target.try_exists()? {
            if !target.is_file() || !media(&path) || !media(&target) {
                result.blockers.push(target.clone());
            } else if digest(&path)? == digest(&target)? {
                result.identical += 1;
            } else {
                result.collisions.push(target.clone());
            }
        }
        let mut parent = target.parent();
        while let Some(p) = parent {
            if p == result.destination {
                break;
            }
            if p.try_exists()? && !p.is_dir() {
                result.blockers.push(p.to_path_buf());
            }
            parent = p.parent();
        }
    }
    result.blockers.sort();
    result.blockers.dedup();
    result.blocked_reason = destination_problem(&result);
    Ok(result)
}

// headroom for sqlite WAL/journal growth during the copy.
const FREE_SPACE_MARGIN: u64 = 64 * 1024 * 1024;

/// catches read-only or too-small disks before scheduling - a move that only
/// fails at the next startup leaves the app unable to boot until it's fixed.
fn destination_problem(report: &Preview) -> Option<String> {
    if let Err(error) = NamedTempFile::new_in(&report.destination) {
        return Some(format!("destination is not writable: {error}"));
    }
    if report.operation == Operation::SelectData {
        return None;
    }
    let available = available_bytes(&report.destination)?;
    let needed = report.bytes.saturating_add(FREE_SPACE_MARGIN);
    (available < needed).then(|| {
        format!(
            "not enough free space: needs {} MB, {} MB available",
            needed.div_ceil(1024 * 1024),
            available / (1024 * 1024)
        )
    })
}

#[cfg(unix)]
fn available_bytes(path: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: path is NUL-terminated and stat is a valid out pointer.
    if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return None;
    }
    // SAFETY: statvfs returned success, so it initialized stat.
    let stat = unsafe { stat.assume_init() };
    #[allow(clippy::unnecessary_cast)]
    Some((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
}

#[cfg(not(unix))]
fn available_bytes(_path: &Path) -> Option<u64> {
    None
}

/// queue only; no running config, database or media file is changed.
pub fn schedule(
    config_path: &Path,
    operation: Operation,
    destination: &Path,
    merge: bool,
    confirmation: &str,
) -> Result<Preview> {
    schedule_with_preferences(
        config_path,
        operation,
        destination,
        merge,
        confirmation,
        None,
    )
}

pub fn schedule_with_preferences(
    config_path: &Path,
    operation: Operation,
    destination: &Path,
    merge: bool,
    confirmation: &str,
    preferences: Option<&Path>,
) -> Result<Preview> {
    if confirmation != CONFIRM {
        bail!("type '{CONFIRM}' to confirm; this closes the app and changes its storage");
    }
    let config_path = fs::canonicalize(config_path)?;
    let _queue_lock = lock(&config_path.with_extension("toml.storage-queue.lock"), true)?;
    if pending_path(&config_path).try_exists()? {
        bail!("a storage change is already pending; finish or cancel it first");
    }
    let report = preview(&config_path, operation, destination)?;
    if let Some(reason) = &report.blocked_reason {
        bail!("{reason}");
    }
    if !report.blockers.is_empty() {
        bail!(
            "destination contains non-media/freqhole files or incompatible paths: {}",
            describe_paths(&report.blockers)
        );
    }
    if !report.collisions.is_empty() && !merge {
        bail!("different media files have the same names; choose another folder or explicitly enable merge");
    }
    let preferences = preferences
        .map(Path::to_path_buf)
        .unwrap_or_else(|| report.source.join("charnel-config.toml"));
    let preferences = if operation == Operation::MoveData && preferences.try_exists()? {
        let path = fs::canonicalize(preferences)?;
        Some(DocumentChange {
            before: fs::read_to_string(&path)?,
            path,
            after: None,
        })
    } else {
        None
    };
    let journal = Journal {
        version: 1,
        preview: report.clone(),
        config_before: fs::read_to_string(&config_path)?,
        config_after: None,
        merge,
        entries: None,
        copied: false,
        paths_updated: false,
        references_updated: false,
        committed: false,
        preferences,
    };
    write_atomic(
        &pending_path(&config_path),
        &serde_json::to_vec_pretty(&journal)?,
        false,
    )?;
    Ok(report)
}

pub fn describe_paths(paths: &[PathBuf]) -> String {
    if paths.len() <= 5 {
        paths
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    } else {
        format!("{} files (choose another folder)", paths.len())
    }
}

pub fn pending(config: &Path) -> Result<bool> {
    Ok(pending_path(config).try_exists()?)
}

pub fn cancel(config: &Path) -> Result<()> {
    let config = fs::canonicalize(config)?;
    let _queue_lock = lock(&config.with_extension("toml.storage-queue.lock"), true)?;
    let journal: Journal = serde_json::from_slice(&fs::read(pending_path(&config))?)?;
    if journal.entries.is_some() || journal.committed {
        bail!("migration has started; it must resume, not be cancelled. source files are retained until cutover");
    }
    fs::remove_file(pending_path(&config))?;
    sync_parent(&config)
}

/// called before opening pools; shared leases prevent a new binary moving live storage.
pub fn prepare_startup(config_path: &Path) -> Result<()> {
    let config_path = fs::canonicalize(config_path)?;
    let mut leases = LEASES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| anyhow::anyhow!("storage lease lock poisoned"))?;
    let config = read_config_from_file(&config_path)?;
    if let Some((data, _)) = leases.get(&config_path) {
        if fs::canonicalize(&config.data_dir)? != *data {
            bail!("data directory changed while the app was running; close and restart before using it");
        }
        return Ok(());
    }
    if pending(&config_path)? {
        let _queue_lock = lock(&config_path.with_extension("toml.storage-queue.lock"), true)?;
        let journal: Journal = serde_json::from_slice(&fs::read(pending_path(&config_path))?)?;
        let before: GrimoireConfig = toml::from_str(&journal.config_before)?;
        let mut roots = vec![
            fs::canonicalize(before.data_dir)?,
            journal.preview.source.clone(),
            journal.preview.destination.clone(),
        ];
        roots.sort();
        roots.dedup();
        let held = roots
            .iter()
            .map(|root| lock(&root.join(DATA_LOCK), true))
            .collect::<Result<Vec<_>>>()?;
        let path = config_path.clone();
        // init_config is synchronous and is also called from inside tokio runtimes.
        std::thread::spawn(move || {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?
                .block_on(apply(&path))
        })
        .join()
        .map_err(|_| anyhow::anyhow!("storage migration worker panicked; restart to resume"))??;
        drop(held);
    }
    let config = read_config_from_file(&config_path)?;
    fs::create_dir_all(&config.data_dir)?;
    let data = fs::canonicalize(&config.data_dir)?;
    let held = vec![lock(&data.join(DATA_LOCK), false)?];
    leases.insert(config_path, (data, held));
    Ok(())
}

pub fn assign_fetch_directory(config: &Path, destination: &Path) -> Result<PathBuf> {
    let _queue_lock = lock(&config.with_extension("toml.storage-queue.lock"), true)?;
    let destination = canonical_dir(destination)?;
    let probe = NamedTempFile::new_in(&destination).context("destination is not writable")?;
    probe.close()?;
    if pending(config)? {
        bail!("finish or cancel the pending storage change first");
    }
    let text = fs::read_to_string(config)?;
    let mut doc = text.parse::<DocumentMut>()?;
    for kind in ["fetch_music", "fetch_video"] {
        doc["server"][kind]["output_dir"] = value(destination.to_string_lossy().into_owned());
    }
    let text = doc.to_string();
    let _: GrimoireConfig = toml::from_str(&text)?;
    write_atomic(config, text.as_bytes(), true)?;
    if crate::config::is_config_initialized() {
        crate::config::init_config(Some(config.to_path_buf()))?;
    }
    Ok(destination)
}

fn remap(path: &str, report: &Preview, entries: &[Entry]) -> String {
    let path = Path::new(path);
    if let Some(entry) = entries.iter().find(|e| e.source == path) {
        return entry.destination.to_string_lossy().into_owned();
    }
    match path.strip_prefix(&report.source) {
        Ok(relative) if relative.as_os_str().is_empty() => {
            report.destination.to_string_lossy().into_owned()
        }
        Ok(relative) => report
            .destination
            .join(relative)
            .to_string_lossy()
            .into_owned(),
        Err(_) => path.to_string_lossy().into_owned(),
    }
}

fn rewrite_item(item: &mut Item, report: &Preview, entries: &[Entry]) {
    if let Some(value) = item.as_value_mut() {
        rewrite_value(value, report, entries);
    } else if let Some(table) = item.as_table_like_mut() {
        for (_, child) in table.iter_mut() {
            rewrite_item(child, report, entries);
        }
    } else if let Some(tables) = item.as_array_of_tables_mut() {
        for table in tables.iter_mut() {
            for (_, child) in table.iter_mut() {
                rewrite_item(child, report, entries);
            }
        }
    }
}

fn rewrite_value(value: &mut toml_edit::Value, report: &Preview, entries: &[Entry]) {
    if let Some(text) = value.as_str() {
        let new = remap(text, report, entries);
        if new != text {
            *value = new.into();
        }
    } else if let Some(array) = value.as_array_mut() {
        for child in array.iter_mut() {
            rewrite_value(child, report, entries);
        }
    } else if let Some(table) = value.as_inline_table_mut() {
        for (_, child) in table.iter_mut() {
            rewrite_value(child, report, entries);
        }
    }
}

fn config_after(journal: &Journal) -> Result<String> {
    let mut doc = journal.config_before.parse::<DocumentMut>()?;
    match journal.preview.operation {
        Operation::MoveData | Operation::SelectData => {
            for (_, item) in doc.iter_mut() {
                rewrite_item(
                    item,
                    &journal.preview,
                    journal.entries.as_deref().unwrap_or(&[]),
                );
            }
            doc["data_dir"] = value(journal.preview.destination.to_string_lossy().into_owned());
        }
        Operation::MoveFetch => {
            let destination = journal.preview.destination.to_string_lossy().into_owned();
            doc["server"]["fetch_music"]["output_dir"] = value(destination.clone());
            doc["server"]["fetch_video"]["output_dir"] = value(destination);
        }
    }
    let text = doc.to_string();
    let _: GrimoireConfig = toml::from_str(&text)?;
    Ok(text)
}

fn copy_verified(entry: &Entry) -> Result<()> {
    check_location(&entry.source)?;
    check_location(&entry.destination)?;
    if entry.destination.try_exists()? {
        if digest(&entry.destination)? != entry.hash {
            bail!(
                "destination changed; refusing to overwrite {}",
                entry.destination.display()
            );
        }
        return Ok(());
    }
    let parent = entry.destination.parent().context("file has no parent")?;
    fs::create_dir_all(parent)?;
    let mut source = File::open(&entry.source)?;
    let mut temp = NamedTempFile::new_in(parent)?;
    std::io::copy(&mut source, &mut temp)?;
    temp.as_file()
        .set_permissions(source.metadata()?.permissions())?;
    temp.as_file().sync_all()?;
    if digest(temp.path())? != entry.hash || digest(&entry.source)? != entry.hash {
        bail!(
            "source changed while copying {}; source retained",
            entry.source.display()
        );
    }
    temp.persist_noclobber(&entry.destination)
        .map_err(|e| e.error)?;
    sync_parent(&entry.destination)?;
    if digest(&entry.destination)? != entry.hash {
        bail!("copy verification failed; source retained");
    }
    Ok(())
}

fn check_location(path: &Path) -> Result<()> {
    let mut existing = path;
    loop {
        match fs::symlink_metadata(existing) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || fs::canonicalize(existing)? != existing {
                    bail!("path changed or contains a symlink: {}", existing.display());
                }
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                existing = existing.parent().context("missing parent directory")?;
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

async fn connect_file(path: &Path) -> Result<SqliteConnection> {
    use sqlx::sqlite::SqliteConnectOptions;
    let mut connection = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .busy_timeout(std::time::Duration::from_secs(2)),
    )
    .await?;
    let check = sqlx::query_scalar!("PRAGMA quick_check")
        .fetch_one(&mut connection)
        .await?;
    if check.as_deref() != Some("ok") {
        bail!("database check failed for {}: {check:?}", path.display());
    }
    Ok(connection)
}

async fn checkpoint(path: &Path) -> Result<()> {
    if !path.try_exists()? {
        return Ok(());
    }
    let mut connection = connect_file(path).await?;
    struct Checkpoint {
        busy: i64,
        log: i64,
        checkpointed: i64,
    }
    // SQLite does not describe the output types of this write-only pragma.
    let checkpoint = sqlx::query_as_unchecked!(Checkpoint, "PRAGMA wal_checkpoint(TRUNCATE)")
        .fetch_one(&mut connection)
        .await?;
    if checkpoint.busy != 0 {
        bail!(
            "database is busy: {}; close other apps first",
            path.display()
        );
    }
    let _ = (checkpoint.log, checkpoint.checkpointed);
    connection.close().await?;
    Ok(())
}

fn rewrite_json(value: &mut serde_json::Value, report: &Preview, entries: &[Entry]) {
    match value {
        serde_json::Value::String(text) => *text = remap(text, report, entries),
        serde_json::Value::Array(items) => {
            for item in items {
                rewrite_json(item, report, entries);
            }
        }
        serde_json::Value::Object(items) => {
            for item in items.values_mut() {
                rewrite_json(item, report, entries);
            }
        }
        _ => {}
    }
}

async fn rewrite_database(path: &Path, report: &Preview, entries: &[Entry]) -> Result<()> {
    if !path.try_exists()? {
        return Ok(());
    }
    let mut connection = connect_file(path).await?;
    let mut tx = connection.begin_with("BEGIN IMMEDIATE").await?;
    for (table, column, json) in [
        ("media_blobz", "local_path", false),
        ("scanned_directories", "path", false),
        ("directory_tag_rules", "directory_path", false),
        ("library_sourcez", "last_known_path", false),
        ("library_source_pathz", "path", false),
        ("storage_sync_targetz", "path", false),
        ("library_reorganize_claimed_pathz", "target_root", false),
        ("blobz", "path", false),
        ("jobz", "parameters", true),
        ("jobz", "result", true),
        ("job_sessionz", "last_checkpoint", true),
    ] {
        let exists = sqlx::query_scalar!(
            "SELECT count(*) FROM pragma_table_info(?) WHERE name = ?",
            table,
            column
        )
        .fetch_one(&mut *tx)
        .await?;
        if exists == 0 {
            continue;
        }
        // identifiers are fixed above; rowid also covers composite primary keys.
        let query = format!(
            "SELECT rowid, \"{column}\" AS value FROM \"{table}\" WHERE \"{column}\" IS NOT NULL"
        );
        for row in sqlx::query(&query).fetch_all(&mut *tx).await? {
            let rowid: i64 = row.try_get("rowid")?;
            let old: String = row.try_get("value")?;
            let new = if json {
                if table == "job_sessionz" {
                    // checkpoint strings are opaque for some job types.
                    match serde_json::from_str::<serde_json::Value>(&old) {
                        Ok(mut value) => {
                            rewrite_json(&mut value, report, entries);
                            serde_json::to_string(&value)?
                        }
                        Err(_) => remap(&old, report, entries),
                    }
                } else {
                    let mut value: serde_json::Value =
                        serde_json::from_str(&old).with_context(|| {
                            format!("invalid JSON in {table}.{column}, row {rowid}")
                        })?;
                    rewrite_json(&mut value, report, entries);
                    serde_json::to_string(&value)?
                }
            } else {
                remap(&old, report, entries)
            };
            if old != new {
                sqlx::query(&format!(
                    "UPDATE \"{table}\" SET \"{column}\" = ? WHERE rowid = ?"
                ))
                .bind(new)
                .bind(rowid)
                .execute(&mut *tx)
                .await?;
            }
        }
    }
    tx.commit().await?;
    connection.close().await?;
    checkpoint(path).await
}

async fn apply(config_path: &Path) -> Result<()> {
    let mut journal: Journal = serde_json::from_slice(&fs::read(pending_path(config_path))?)?;
    if journal.version != 1 {
        bail!("unsupported storage migration version");
    }
    let current = fs::read_to_string(config_path)?;
    if current != journal.config_before && journal.config_after.as_ref() != Some(&current) {
        bail!("config changed after confirmation; source retained. cancel the unstarted migration and review it again");
    }
    let mut config: GrimoireConfig = toml::from_str(&journal.config_before)?;
    config.data_dir = fs::canonicalize(&config.data_dir)?;
    let report = journal.preview.clone();
    if journal.entries.is_none() {
        let fresh = preview(config_path, report.operation, &report.destination)?;
        if !fresh.blockers.is_empty() {
            bail!(
                "destination is no longer safe: {}",
                describe_paths(&fresh.blockers)
            );
        }
        if !fresh.collisions.is_empty() && !journal.merge {
            bail!("new media collisions; cancel and review with merge or a different folder");
        }
        if report.operation != Operation::SelectData {
            for db in [
                config.database_path(),
                config.blob_data_path(),
                config.data_dir.join("haruspex.db"),
                config.reliquary_db_path(),
            ] {
                checkpoint(&db).await?;
            }
        }
        let mut entries = Vec::new();
        if report.operation != Operation::SelectData {
            for source in tree(
                &report.source,
                config_path,
                report.operation == Operation::MoveData,
            )? {
                if source.file_name().is_some_and(|n| n == DATA_LOCK) {
                    continue;
                }
                let mut destination = report
                    .destination
                    .join(source.strip_prefix(&report.source)?);
                let hash = digest(&source)?;
                if destination.try_exists()? && digest(&destination)? != hash {
                    if !journal.merge || !media(&source) {
                        bail!("file collision: {}", destination.display());
                    }
                    let name = destination
                        .file_name()
                        .context("file has no name")?
                        .to_string_lossy();
                    destination = destination.with_file_name(format!(
                        "{}-{}-{name}",
                        &hash[..12],
                        uuid::Uuid::new_v4()
                    ));
                }
                entries.push(Entry {
                    source,
                    destination,
                    hash,
                    destination_hash: None,
                });
            }
        }
        journal.entries = Some(entries);
        journal.config_after = Some(config_after(&journal)?);
        if let Some(preferences) = journal.preferences.as_mut() {
            let mut doc = preferences.before.parse::<DocumentMut>()?;
            for (key, item) in doc.iter_mut() {
                if key.get() != "server_config_path" {
                    rewrite_item(
                        item,
                        &report,
                        journal.entries.as_deref().context("missing manifest")?,
                    );
                }
            }
            preferences.after = Some(doc.to_string());
        }
        save(config_path, &journal)?;
    }
    let entries = journal
        .entries
        .as_deref()
        .context("migration manifest missing")?;
    if !journal.copied {
        tracing::info!(
            files = entries.len(),
            "storage migration: copying and verifying files"
        );
        for entry in entries {
            copy_verified(entry)?;
        }
        #[cfg(unix)]
        for entry in entries {
            let mut parent = entry.destination.parent();
            while let Some(path) = parent {
                File::open(path)?.sync_all()?;
                if path == report.destination {
                    break;
                }
                parent = path.parent();
            }
        }
        journal.copied = true;
        save(config_path, &journal)?;
    }
    if !journal.paths_updated {
        tracing::info!("storage migration: updating database paths");
        let mut databases = Vec::new();
        if report.operation != Operation::SelectData {
            for path in [config.database_path(), config.reliquary_db_path()] {
                let destination = if report.operation == Operation::MoveData {
                    PathBuf::from(remap(&path.to_string_lossy(), &report, entries))
                } else {
                    path
                };
                rewrite_database(&destination, &report, entries).await?;
                databases.push(destination);
            }
        }
        for entry in journal
            .entries
            .as_mut()
            .context("migration manifest missing")?
        {
            let hash = digest(&entry.destination)?;
            if !databases.contains(&entry.destination) && hash != entry.hash {
                bail!(
                    "destination changed during migration; source retained: {}",
                    entry.destination.display()
                );
            }
            entry.destination_hash = Some(hash);
        }
        journal.paths_updated = true;
        save(config_path, &journal)?;
    }
    if !journal.references_updated {
        let transport = if report.operation == Operation::MoveData {
            PathBuf::from(remap(
                &config.freqhole_blobz_path().to_string_lossy(),
                &report,
                journal.entries.as_deref().context("missing manifest")?,
            ))
        } else {
            config.freqhole_blobz_path()
        };
        if report.operation != Operation::SelectData && transport.join("blobs.db").try_exists()? {
            repair_moved_references(
                &transport,
                journal.entries.as_deref().context("missing manifest")?,
            )
            .await?;
            if report.operation == Operation::MoveData {
                for entry in journal.entries.as_mut().context("missing manifest")? {
                    if entry.destination.starts_with(&transport) {
                        entry.destination_hash = Some(digest(&entry.destination)?);
                    }
                }
            }
        }
        journal.references_updated = true;
        save(config_path, &journal)?;
    }
    if !journal.committed {
        tracing::info!("storage migration: committing configuration");
        for entry in journal
            .entries
            .as_deref()
            .context("migration manifest missing")?
        {
            check_location(&entry.source)?;
            check_location(&entry.destination)?;
            if digest(&entry.source)? != entry.hash {
                bail!(
                    "source changed before cutover: {}; source retained",
                    entry.source.display()
                );
            }
        }
        let after = journal
            .config_after
            .as_ref()
            .context("missing target config")?;
        if let Some(preferences) = &journal.preferences {
            let current = fs::read_to_string(&preferences.path)?;
            let after = preferences
                .after
                .as_ref()
                .context("missing preferences update")?;
            if current != *after {
                if current != preferences.before {
                    bail!("Charnel preferences changed after confirmation; source retained");
                }
                write_atomic(&preferences.path, after.as_bytes(), true)?;
            }
        }
        if current == journal.config_before {
            // retain a no-clobber recovery copy next to the original config.
            let backup = config_path.with_extension("toml.storage-before");
            if !backup.try_exists()? {
                write_atomic(&backup, journal.config_before.as_bytes(), false)?;
            }
            write_atomic(config_path, after.as_bytes(), true)?;
        }
        journal.committed = true;
        save(config_path, &journal)?;
    }
    // a crash during cleanup is harmless: only verified, unchanged source files go.
    tracing::info!("storage migration: verifying and deleting old copies");
    for entry in journal
        .entries
        .as_deref()
        .context("migration manifest missing")?
    {
        if entry.source.try_exists()? {
            check_location(&entry.source)?;
            check_location(&entry.destination)?;
            if digest(&entry.source)? != entry.hash {
                bail!(
                    "source changed before cleanup: {}; retained",
                    entry.source.display()
                );
            }
            if !entry.destination.is_file() {
                bail!(
                    "destination disappeared; source retained: {}",
                    entry.destination.display()
                );
            }
            if digest(&entry.destination)?
                != *entry
                    .destination_hash
                    .as_ref()
                    .context("missing verified destination hash")?
            {
                bail!(
                    "destination changed before cleanup; source retained: {}",
                    entry.destination.display()
                );
            }
            fs::remove_file(&entry.source)?;
            sync_parent(&entry.source)?;
        }
    }
    fs::remove_file(pending_path(config_path))?;
    sync_parent(config_path)?;
    tracing::info!(destination = %report.destination.display(), "storage migration complete; original config and pre-change config backup retained");
    Ok(())
}

async fn repair_moved_references(root: &Path, entries: &[Entry]) -> Result<()> {
    use iroh_blobs::store::fs::FsStore;
    let store = FsStore::load(root).await?;
    let result: Result<()> = async {
        let hashes: std::collections::HashSet<_> =
            store.blobs().list().hashes().await?.into_iter().collect();
        let repair = reliquary::references::ReferenceRepair::default();
        for entry in entries {
            let hash = entry.hash.parse::<iroh_blobs::Hash>()?;
            if hashes.contains(&hash) {
                check_location(&entry.destination)?;
                repair
                    .ensure(&store, hash, &entry.destination)
                    .await
                    .with_context(|| {
                        format!(
                            "cannot relocate transport reference for {}",
                            entry.destination.display()
                        )
                    })?;
            }
        }
        store.sync_db().await?;
        Ok(())
    }
    .await;
    let shutdown = store.shutdown().await;
    result?;
    shutdown?;
    Ok(())
}

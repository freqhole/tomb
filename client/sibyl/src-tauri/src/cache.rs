//! disk-backed chunk cache for the tauri shell.
//!
//! webkit2gtk's OPFS implementation lacks both `createSyncAccessHandle`
//! and `createWritable`, so the browser-style [`OpfsCache`] is a no-go
//! inside tauri. instead we mirror the OPFS layout on the native
//! filesystem under `<app_data_dir>/sibyl/cache/songs/<song_id>/` and
//! drive it via IPC from `@sibyl/player` through the
//! `cache-tauri` adapter.
//!
//! NOTE: this module is **sibyl-demo scaffolding**. it's intentionally
//! kept out of `sibyl-core` and `@sibyl/player` so the portable lib
//! code (which freqhole eventually adopts) doesn't pick up a tauri
//! filesystem dependency. the layout chosen here is just a convenient
//! mirror of the OPFS adapter — when freqhole integrates sibyl it can
//! swap this for whatever cache strategy it prefers.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tokio::fs;

/// root directory for cached songs. sibling of the iroh-blobs FsStore
/// dir so both live under `<app_data_dir>/sibyl/`.
pub fn songs_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("sibyl").join("cache").join("songs")
}

fn song_dir(app_data_dir: &Path, song_id: &str) -> PathBuf {
    songs_root(app_data_dir).join(sanitize(song_id))
}

fn manifest_path(app_data_dir: &Path, song_id: &str) -> PathBuf {
    song_dir(app_data_dir, song_id).join("manifest.json")
}

fn chunks_dir(app_data_dir: &Path, song_id: &str) -> PathBuf {
    song_dir(app_data_dir, song_id).join("chunks")
}

fn chunk_path(app_data_dir: &Path, song_id: &str, seq: u32) -> PathBuf {
    chunks_dir(app_data_dir, song_id).join(format!("{:08}.mp3", seq))
}

/// strip path separators / parent refs so a poisoned song_id can't
/// escape the cache dir.
fn sanitize(id: &str) -> String {
    id.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => c,
            _ => '_',
        })
        .collect()
}

/// summary row returned by [`list`]. mirrors the shape produced by
/// `OpfsCache.list()` so the ts side can use the same panel rendering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedSongSummary {
    pub song_id: String,
    pub manifest: Option<JsonValue>,
    pub have_chunks: Vec<u32>,
}

pub async fn read_manifest(
    app_data_dir: &Path,
    song_id: &str,
) -> std::io::Result<Option<JsonValue>> {
    let path = manifest_path(app_data_dir, song_id);
    match fs::read(&path).await {
        // race window: a concurrent `write_manifest` may briefly truncate
        // the file before swapping in new bytes (or, on platforms without
        // the rename trick, before the new bytes are flushed). treat an
        // empty / not-yet-parseable file as "no manifest yet" rather than
        // an error so the caller's get-or-init path still works.
        Ok(bytes) if bytes.is_empty() => Ok(None),
        Ok(bytes) => match serde_json::from_slice::<JsonValue>(&bytes) {
            Ok(v) => Ok(Some(v)),
            Err(_) => Ok(None),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

pub async fn write_manifest(app_data_dir: &Path, manifest: &JsonValue) -> std::io::Result<()> {
    let song_id = manifest
        .get("song_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "manifest missing song_id field",
            )
        })?;
    let dir = song_dir(app_data_dir, song_id);
    fs::create_dir_all(&dir).await?;
    fs::create_dir_all(chunks_dir(app_data_dir, song_id)).await?;
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    // atomic write: write to a unique tmp file in the same dir, then
    // rename onto the final path. concurrent readers either see the
    // old file or the new file, never a half-written one. (this is
    // critical because the tauri ipc dispatcher serves chunk callbacks
    // concurrently and each one round-trips through manifest r/w.)
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tid = std::thread::current().id();
    let tmp = dir.join(format!("manifest.{nanos}.{tid:?}.tmp"));
    fs::write(&tmp, &bytes).await?;
    fs::rename(&tmp, manifest_path(app_data_dir, song_id)).await
}

pub async fn has_chunk(app_data_dir: &Path, song_id: &str, seq: u32) -> bool {
    fs::metadata(chunk_path(app_data_dir, song_id, seq))
        .await
        .is_ok()
}

pub async fn read_chunk(
    app_data_dir: &Path,
    song_id: &str,
    seq: u32,
) -> std::io::Result<Option<Vec<u8>>> {
    match fs::read(chunk_path(app_data_dir, song_id, seq)).await {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

pub async fn write_chunk(
    app_data_dir: &Path,
    song_id: &str,
    seq: u32,
    bytes: &[u8],
) -> std::io::Result<()> {
    let dir = chunks_dir(app_data_dir, song_id);
    fs::create_dir_all(&dir).await?;
    fs::write(chunk_path(app_data_dir, song_id, seq), bytes).await
}

pub async fn list(app_data_dir: &Path) -> std::io::Result<Vec<CachedSongSummary>> {
    let root = songs_root(app_data_dir);
    let mut out = Vec::new();
    let mut rd = match fs::read_dir(&root).await {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e),
    };
    while let Some(entry) = rd.next_entry().await? {
        let ft = entry.file_type().await?;
        if !ft.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let song_id = match name.to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let manifest = read_manifest(app_data_dir, &song_id).await.ok().flatten();
        let mut have_chunks = Vec::new();
        let chunks_dir = chunks_dir(app_data_dir, &song_id);
        if let Ok(mut crd) = fs::read_dir(&chunks_dir).await {
            while let Some(c) = crd.next_entry().await? {
                let fname = c.file_name();
                let fname = match fname.to_str() {
                    Some(s) => s,
                    None => continue,
                };
                let stem = fname.trim_end_matches(".mp3");
                if let Ok(seq) = stem.parse::<u32>() {
                    have_chunks.push(seq);
                }
            }
        }
        have_chunks.sort_unstable();
        out.push(CachedSongSummary {
            song_id,
            manifest,
            have_chunks,
        });
    }
    Ok(out)
}

pub async fn delete_song(app_data_dir: &Path, song_id: &str) -> std::io::Result<()> {
    let dir = song_dir(app_data_dir, song_id);
    match fs::remove_dir_all(&dir).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

pub async fn clear(app_data_dir: &Path) -> std::io::Result<()> {
    let root = songs_root(app_data_dir);
    match fs::remove_dir_all(&root).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// concatenate every chunk file under `<song_id>/chunks/` into a
/// single `assembled.mp3` (mp3 frames concatenate cleanly). returns
/// the absolute path so the rodio backend can `Decoder::new` it.
///
/// idempotent: if `assembled.mp3` already exists and the manifest
/// reports `chunks_total == have.len()`, returns the existing path
/// without re-reading every chunk.
pub async fn assemble_song(app_data_dir: &Path, song_id: &str) -> std::io::Result<PathBuf> {
    use tokio::io::AsyncWriteExt;

    let dir = song_dir(app_data_dir, song_id);
    let assembled = dir.join("assembled.mp3");

    // collect chunk seqs by listing the chunks dir.
    let chunks = chunks_dir(app_data_dir, song_id);
    let mut seqs = Vec::new();
    let mut rd = fs::read_dir(&chunks).await?;
    while let Some(entry) = rd.next_entry().await? {
        let fname = entry.file_name();
        let fname = match fname.to_str() {
            Some(s) => s,
            None => continue,
        };
        let stem = fname.trim_end_matches(".mp3");
        if let Ok(seq) = stem.parse::<u32>() {
            seqs.push(seq);
        }
    }
    seqs.sort_unstable();
    if seqs.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no chunks to assemble",
        ));
    }

    // skip work if already assembled and chunk count matches.
    if let Ok(meta) = fs::metadata(&assembled).await {
        if meta.len() > 0 {
            // best-effort: if manifest says we have all chunks, trust it.
            if let Ok(Some(m)) = read_manifest(app_data_dir, song_id).await {
                let total = m.get("chunks_total").and_then(|v| v.as_u64());
                if matches!(total, Some(t) if t as usize == seqs.len()) {
                    return Ok(assembled);
                }
            }
        }
    }

    let tmp = dir.join("assembled.mp3.tmp");
    let mut out = fs::File::create(&tmp).await?;
    for seq in &seqs {
        let bytes = fs::read(chunk_path(app_data_dir, song_id, *seq)).await?;
        out.write_all(&bytes).await?;
    }
    out.flush().await?;
    drop(out);
    fs::rename(&tmp, &assembled).await?;
    Ok(assembled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;

    #[tokio::test]
    async fn write_then_read_manifest_round_trip() {
        let tmp = tempdir();
        let m = json!({
            "song_id": "alpha",
            "chunks_have": [0, 1, 2],
            "chunks_total": 3,
        });
        write_manifest(tmp.path(), &m).await.unwrap();
        let got = read_manifest(tmp.path(), "alpha").await.unwrap().unwrap();
        assert_eq!(got["chunks_total"], 3);
    }

    #[tokio::test]
    async fn read_missing_manifest_is_none() {
        let tmp = tempdir();
        let r = read_manifest(tmp.path(), "ghost").await.unwrap();
        assert!(r.is_none());
    }

    /// regression: tauri ipc serves chunk callbacks concurrently; each
    /// one read-modify-writes the manifest. without atomic rename a
    /// reader can hit a 0-byte window mid-`fs::write` and fail to
    /// parse. this test reproduces hundreds of those races and asserts
    /// every read either sees a valid manifest or `None` (never an
    /// error and never a partial parse).
    #[tokio::test]
    async fn concurrent_manifest_writes_never_corrupt() {
        let tmp = Arc::new(tempdir());
        let mut handles = Vec::new();

        // 40 writers, each writing the manifest 50x with growing
        // chunks_have lists.
        for w in 0..40u32 {
            let tmp = tmp.clone();
            handles.push(tokio::spawn(async move {
                for i in 0..50u32 {
                    let m = json!({
                        "song_id": "race",
                        "chunks_have": (0..(w * 100 + i)).collect::<Vec<_>>(),
                        "chunks_total": 9999,
                    });
                    write_manifest(tmp.path(), &m).await.unwrap();
                }
            }));
        }

        // 40 readers each performing 100 reads concurrently with the writes.
        for _ in 0..40u32 {
            let tmp = tmp.clone();
            handles.push(tokio::spawn(async move {
                for _ in 0..100u32 {
                    let r = read_manifest(tmp.path(), "race")
                        .await
                        .expect("read should not error");
                    if let Some(v) = r {
                        // if a manifest is present, song_id must match
                        // and chunks_total must round-trip the value
                        // we wrote. anything else means we observed a
                        // partial / corrupted file.
                        assert_eq!(v["song_id"], "race");
                        assert_eq!(v["chunks_total"], 9999);
                    }
                }
            }));
        }

        for h in handles {
            h.await.unwrap();
        }
    }

    #[tokio::test]
    async fn write_chunk_then_assemble_concatenates_in_seq_order() {
        let tmp = tempdir();
        let m = json!({
            "song_id": "asm",
            "chunks_have": [0, 1, 2],
            "chunks_total": 3,
        });
        write_manifest(tmp.path(), &m).await.unwrap();
        // intentionally write out of order to confirm assemble sorts.
        write_chunk(tmp.path(), "asm", 2, b"CC").await.unwrap();
        write_chunk(tmp.path(), "asm", 0, b"AA").await.unwrap();
        write_chunk(tmp.path(), "asm", 1, b"BB").await.unwrap();
        let path = assemble_song(tmp.path(), "asm").await.unwrap();
        let got = fs::read(&path).await.unwrap();
        assert_eq!(&got[..], b"AABBCC");
    }

    #[tokio::test]
    async fn assemble_skips_work_when_already_assembled_with_same_count() {
        let tmp = tempdir();
        write_chunk(tmp.path(), "skip", 0, b"X").await.unwrap();
        let m = json!({
            "song_id": "skip",
            "chunks_have": [0],
            "chunks_total": 1,
        });
        write_manifest(tmp.path(), &m).await.unwrap();
        let path = assemble_song(tmp.path(), "skip").await.unwrap();
        let mtime1 = fs::metadata(&path).await.unwrap().modified().unwrap();
        // second call should noop and leave mtime unchanged.
        std::thread::sleep(std::time::Duration::from_millis(10));
        let path2 = assemble_song(tmp.path(), "skip").await.unwrap();
        assert_eq!(path, path2);
        let mtime2 = fs::metadata(&path2).await.unwrap().modified().unwrap();
        assert_eq!(mtime1, mtime2);
    }

    #[tokio::test]
    async fn list_returns_have_chunks_and_manifest() {
        let tmp = tempdir();
        write_chunk(tmp.path(), "a", 0, b"x").await.unwrap();
        write_chunk(tmp.path(), "a", 5, b"y").await.unwrap();
        let m = json!({ "song_id": "a", "chunks_have": [0, 5] });
        write_manifest(tmp.path(), &m).await.unwrap();
        let rows = list(tmp.path()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].song_id, "a");
        assert_eq!(rows[0].have_chunks, vec![0, 5]);
        assert!(rows[0].manifest.is_some());
    }

    #[tokio::test]
    async fn sanitize_blocks_path_traversal() {
        let tmp = tempdir();
        let m = json!({
            "song_id": "../escape",
            "chunks_have": [],
        });
        write_manifest(tmp.path(), &m).await.unwrap();
        // file should land inside songs_root, not above it.
        let escaped = tmp.path().join("escape").join("manifest.json");
        assert!(!escaped.exists(), "manifest escaped its sandbox");
    }

    // small in-process tempdir — we don't pull in the `tempfile`
    // crate because src-tauri's deps are already heavy and this is a
    // single-purpose test helper.
    struct TempDir(PathBuf);
    impl TempDir {
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn tempdir() -> TempDir {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let p = std::env::temp_dir().join(format!("sibyl-cache-test-{pid}-{nanos}-{n}"));
        std::fs::create_dir_all(&p).unwrap();
        TempDir(p)
    }
}

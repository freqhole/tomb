//! sibyl IPC: a single `#[tauri::command] sibyl_call` that dispatches
//! a tagged `SibylRequest` enum. mirrors freqhole's
//! `api_call(path, body)` pattern (see
//! `client/charnel/src-tauri/src/commands.rs::api_call`) but with a
//! discriminated union instead of a path string.
//!
//! every new command adds a variant here and one match arm in
//! `dispatch`. ts side speaks the same enum via
//! `@sibyl/player/adapters/transport-tauri.ts`.
//!
//! streaming output (chunk bytes, status, errors) flows via tauri
//! events on dedicated channels:
//! - `sibyl://chunk`   → `{ request_id, seq, bytes }`
//! - `sibyl://status`  → `{ kind: "rodio" | "node" | "host" | "peer", … }`

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;
use tokio::task::AbortHandle;

use sibyl_core::{SibylHost, SibylNode, SibylTicket};

use crate::cache;
use crate::rodio_backend::{RodioCmd, RodioState};

/// app-wide tauri state. owns the iroh node + a registry of in-flight
/// hosts/peers so `cancel_request` can find them.
pub struct SibylState {
    pub node: Arc<SibylNode>,
    pub rodio: Option<RodioState>,
    pub hosts: Mutex<Vec<(String, SibylHost)>>, // (song_id, host)
    pub peers: Arc<Mutex<HashMap<String, AbortHandle>>>, // request_id → abort handle
    /// base dir for the disk-backed chunk cache (see `cache.rs`).
    /// usually `<app_data_dir>` so cache lives at
    /// `<app_data_dir>/sibyl/cache/songs/`.
    pub data_dir: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SibylRequest {
    /// transcode a local file and start hosting its chunks.
    /// returns `Response::Ticket`.
    HostFile {
        path: String,
        song_id: Option<String>,
        title: Option<String>,
    },
    /// open a peer download for a ticket. emits chunks via
    /// `sibyl://chunk` until complete. returns `Response::RequestStarted`.
    RequestTicket {
        ticket: String,
        have_chunks: Vec<u32>,
    },
    /// abort an in-flight host or peer.
    CancelRequest {
        request_id: String,
    },
    /// info about the local iroh node (id, addrs).
    NodeInfo,

    // -- rodio playback (tauri-only backend) -----------------------------
    RodioLoad {
        paths: Vec<String>,
    },
    RodioPlay,
    RodioPause,
    RodioResume,
    RodioStop,
    RodioSeek {
        ms: u64,
    },
    RodioVolume {
        v: f32,
    },
    RodioStatus,

    // -- disk-backed chunk cache (tauri-only; replaces OPFS) -----------
    CacheManifest {
        song_id: String,
    },
    CacheWriteManifest {
        manifest: JsonValue,
    },
    CacheHasChunk {
        song_id: String,
        seq: u32,
    },
    CacheReadChunk {
        song_id: String,
        seq: u32,
    },
    CacheWriteChunk {
        song_id: String,
        seq: u32,
        bytes: Vec<u8>,
    },
    CacheList,
    CacheDeleteSong {
        song_id: String,
    },
    CacheClear,
    /// concatenate every cached chunk for `song_id` into a single
    /// `assembled.mp3` file, then return its path. used by the tauri
    /// rodio backend (which decodes a path, not a chunk stream).
    CacheAssembleSong {
        song_id: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SibylResponse {
    Ticket {
        ticket: String,
        song_id: String,
    },
    RequestStarted {
        request_id: String,
    },
    NodeInfo {
        node_id: String,
    },
    RodioStatus {
        status: crate::rodio_backend::RodioStatus,
    },
    RodioTotalSecs {
        secs: f64,
    },
    Manifest {
        manifest: Option<JsonValue>,
    },
    ChunkBytes {
        bytes: Option<Vec<u8>>,
    },
    HasChunk {
        has: bool,
    },
    CachedSongs {
        songs: Vec<cache::CachedSongSummary>,
    },
    AssembledPath {
        path: String,
    },
    Ok,
}

/// the only `#[tauri::command]` sibyl ships. javascript invokes this
/// with a `SibylRequest` shaped object; rust dispatches to the right
/// `sibyl_core` (or rodio) function.
#[tauri::command]
pub async fn sibyl_call(
    app: AppHandle,
    state: State<'_, SibylState>,
    req: SibylRequest,
) -> Result<SibylResponse, String> {
    match req {
        SibylRequest::HostFile {
            path,
            song_id,
            title,
        } => {
            let song_id = song_id.unwrap_or_else(|| uuid_like(&path));
            let app_emit = app.clone();
            let progress_song = song_id.clone();
            let last_count = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
            let last_count_cb = last_count.clone();
            let host = SibylHost::host_with_progress(
                state.node.clone(),
                song_id.clone(),
                std::path::PathBuf::from(&path),
                sibyl_core::CodecParams::MP3_DEFAULT,
                title,
                move |chunks_published| {
                    last_count_cb.store(chunks_published, std::sync::atomic::Ordering::SeqCst);
                    let _ = app_emit.emit(
                        "sibyl://status",
                        StatusEvent::HostProgress {
                            song_id: progress_song.clone(),
                            chunks_published,
                        },
                    );
                },
            )
            .await
            .map_err(|e| e.to_string())?;
            let ticket_str = host.ticket.encode();
            let _ = app.emit(
                "sibyl://status",
                StatusEvent::HostComplete {
                    song_id: song_id.clone(),
                    chunks_total: last_count.load(std::sync::atomic::Ordering::SeqCst),
                },
            );
            state.hosts.lock().await.push((song_id.clone(), host));
            Ok(SibylResponse::Ticket {
                ticket: ticket_str,
                song_id,
            })
        }
        SibylRequest::RequestTicket {
            ticket,
            have_chunks,
        } => {
            let parsed = SibylTicket::decode(&ticket).map_err(|e| e.to_string())?;
            let request_id = format!("req-{}", parsed.song_id);
            let app_emit = app.clone();
            let node = state.node.clone();
            let rid = request_id.clone();
            let peers_handle = state.peers.clone();
            let rid_for_cleanup = rid.clone();
            let join = tokio::spawn(async move {
                let rid_inner = rid.clone();
                let res =
                    sibyl_core::SibylPeer::request(node, &parsed, &have_chunks, move |chunk| {
                        let _ = app_emit.emit(
                            "sibyl://chunk",
                            ChunkEvent {
                                request_id: rid_inner.clone(),
                                seq: chunk.seq,
                                bytes: chunk.bytes,
                                chunks_total: chunk.chunks_total,
                            },
                        );
                    })
                    .await;
                if let Err(e) = res {
                    let _ = app.emit(
                        "sibyl://status",
                        StatusEvent::PeerError {
                            request_id: rid,
                            error: e.to_string(),
                        },
                    );
                }
                // self-deregister so the registry doesn't accumulate
                // dead handles. cancellation path also removes us, but
                // doing it here covers the success/error case too.
                peers_handle.lock().await.remove(&rid_for_cleanup);
            });
            state
                .peers
                .lock()
                .await
                .insert(request_id.clone(), join.abort_handle());
            Ok(SibylResponse::RequestStarted { request_id })
        }
        SibylRequest::CancelRequest { request_id } => {
            // try peer-task abort first.
            if let Some(handle) = state.peers.lock().await.remove(&request_id) {
                handle.abort();
                return Ok(SibylResponse::Ok);
            }
            // otherwise treat the id as a song_id and drop the host.
            let mut hosts = state.hosts.lock().await;
            if let Some(idx) = hosts.iter().position(|(sid, _)| sid == &request_id) {
                hosts.remove(idx);
            }
            Ok(SibylResponse::Ok)
        }
        SibylRequest::NodeInfo => Ok(SibylResponse::NodeInfo {
            node_id: state.node.node_id(),
        }),

        // rodio path
        SibylRequest::RodioLoad { paths } => {
            let r = rodio(&state)?;
            *r.last_play_error.lock().unwrap() = None;
            r.tx.send(RodioCmd::Play(paths))
                .map_err(|e| e.to_string())?;
            // give the audio thread a moment to populate status (mirror dumb-player)
            for _ in 0..20 {
                std::thread::sleep(std::time::Duration::from_millis(25));
                if let Some(err) = r.last_play_error.lock().unwrap().clone() {
                    return Err(err);
                }
                let s = r.status.lock().unwrap();
                if s.has_sink {
                    return Ok(SibylResponse::RodioTotalSecs { secs: s.total_secs });
                }
            }
            Ok(SibylResponse::RodioTotalSecs { secs: 0.0 })
        }
        SibylRequest::RodioPlay | SibylRequest::RodioResume => {
            rodio(&state)?
                .tx
                .send(RodioCmd::Resume)
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::Ok)
        }
        SibylRequest::RodioPause => {
            rodio(&state)?
                .tx
                .send(RodioCmd::Pause)
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::Ok)
        }
        SibylRequest::RodioStop => {
            rodio(&state)?
                .tx
                .send(RodioCmd::Stop)
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::Ok)
        }
        SibylRequest::RodioSeek { ms } => {
            let r = rodio(&state)?;
            *r.last_play_error.lock().unwrap() = None;
            r.tx.send(RodioCmd::Seek(ms as f64 / 1000.0))
                .map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(50));
            if let Some(err) = r.last_play_error.lock().unwrap().clone() {
                return Err(err);
            }
            Ok(SibylResponse::Ok)
        }
        SibylRequest::RodioVolume { v } => {
            rodio(&state)?
                .tx
                .send(RodioCmd::SetVolume(v))
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::Ok)
        }
        SibylRequest::RodioStatus => Ok(SibylResponse::RodioStatus {
            status: rodio(&state)?.status.lock().unwrap().clone(),
        }),

        // -- disk cache --------------------------------------------------
        SibylRequest::CacheManifest { song_id } => {
            let manifest = cache::read_manifest(&state.data_dir, &song_id)
                .await
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::Manifest { manifest })
        }
        SibylRequest::CacheWriteManifest { manifest } => {
            cache::write_manifest(&state.data_dir, &manifest)
                .await
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::Ok)
        }
        SibylRequest::CacheHasChunk { song_id, seq } => {
            let has = cache::has_chunk(&state.data_dir, &song_id, seq).await;
            Ok(SibylResponse::HasChunk { has })
        }
        SibylRequest::CacheReadChunk { song_id, seq } => {
            let bytes = cache::read_chunk(&state.data_dir, &song_id, seq)
                .await
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::ChunkBytes { bytes })
        }
        SibylRequest::CacheWriteChunk {
            song_id,
            seq,
            bytes,
        } => {
            cache::write_chunk(&state.data_dir, &song_id, seq, &bytes)
                .await
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::Ok)
        }
        SibylRequest::CacheList => {
            let songs = cache::list(&state.data_dir)
                .await
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::CachedSongs { songs })
        }
        SibylRequest::CacheDeleteSong { song_id } => {
            cache::delete_song(&state.data_dir, &song_id)
                .await
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::Ok)
        }
        SibylRequest::CacheClear => {
            cache::clear(&state.data_dir)
                .await
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::Ok)
        }
        SibylRequest::CacheAssembleSong { song_id } => {
            let path = cache::assemble_song(&state.data_dir, &song_id)
                .await
                .map_err(|e| e.to_string())?;
            Ok(SibylResponse::AssembledPath {
                path: path.to_string_lossy().into_owned(),
            })
        }
    }
}

fn rodio<'a>(state: &'a State<'_, SibylState>) -> Result<&'a RodioState, String> {
    state
        .rodio
        .as_ref()
        .ok_or_else(|| "rodio unavailable on this system".to_string())
}

/// crude path → song_id derivation for the prototype. real freqhole
/// integration will pass real song ids in.
fn uuid_like(path: &str) -> String {
    let leaf = std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("song");
    format!("{leaf}-{:x}", path.len())
}

// -- event payloads (kept private to this module; ts mirrors them) -------

#[derive(Serialize, Clone)]
struct ChunkEvent {
    request_id: String,
    seq: u32,
    #[serde(with = "serde_bytes")]
    bytes: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chunks_total: Option<u32>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum StatusEvent {
    PeerError {
        request_id: String,
        error: String,
    },
    HostProgress {
        song_id: String,
        chunks_published: u32,
    },
    HostComplete {
        song_id: String,
        chunks_total: u32,
    },
}

// minimal local serde_bytes shim so we don't pull a new dep.
mod serde_bytes {
    use serde::Serializer;
    pub fn serialize<S: Serializer>(v: &Vec<u8>, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bytes(v)
    }
}

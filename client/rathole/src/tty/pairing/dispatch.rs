//! playback dispatch: `PairingCommand` -> rathole's real backends.
//!
//! the unified play queue (`ratcore::app::QueueEntry`, owned by
//! `MusicState.queue` and advanced by `tty::queue`) is the single
//! source of truth for "what's actually loaded/playing" - both for
//! rathole's own local ui AND for what a remote controller sees via
//! `PlayerStatus`. `replace_queue`/`append_queue` resolve a pushed
//! `Vec<MediaRef>` into `QueueEntry`s and hand them to `run.rs` via
//! `AppAction::PairingReplaceQueue`/`PairingAppendQueue` (dispatch runs
//! without `&mut App` access - see `DispatchContext`'s own doc
//! comment) rather than poking `PlayerCmd`/`VideoCommand` directly, so
//! a queue push and a locally-built queue go through the exact same
//! `tty::queue::set_queue_entries`/`append_queue_entries` path.

use tokio::sync::mpsc;
use tracing::warn;

use crate::ratcore::app::{
    AppAction, CommandAck, CommandAckReason, MediaKind, MediaRef, PairingCommand, PlayerStatus,
    QueueEntry, QueuedVideoRow, SongRow, StatusCommon,
};
use crate::ratcore::transport::{PlayerCmd, VideoPlayer};

use super::now_ms;

/// which backend a generic (kind-less) command like pause/resume/seek
/// should target - derived from the unified queue's current entry's
/// kind (see `run.rs`'s `handle_pairing_dispatch`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveBackend {
    Audio,
    Video,
}

/// snapshot passed in by `run.rs` (which owns `App`) so this module
/// never needs `&mut App` / non-`Send` handles itself — only cloned
/// `Rc<dyn ...>` handles and plain data, all assembled synchronously
/// before any `.await` point.
pub struct DispatchContext {
    pub active_backend: ActiveBackend,
    pub player: Option<std::rc::Rc<dyn crate::ratcore::transport::MusicPlayer>>,
    pub video_player: Option<std::rc::Rc<dyn VideoPlayer>>,
    pub volume: f32,
    /// channel back to the ui loop, used to report live download
    /// progress while resolving queued/played media refs
    /// (`AppAction::PairingDownloadProgress`) and to install resolved
    /// queue entries (`AppAction::PairingReplaceQueue`/
    /// `PairingAppendQueue`). `None` in tests, where there's no ui
    /// loop to report to.
    pub action_tx: Option<mpsc::UnboundedSender<AppAction>>,
    /// real queue for `ctx.active_backend`, current item first -
    /// matches the wire protocol's "queue[0] = currently playing"
    /// convention. built synchronously by `run.rs` from
    /// `app.state.ephemeral.music` before dispatch, so a remote
    /// controller's `get_status`/command acks actually show what's
    /// queued instead of always reporting an empty queue.
    pub queue_snapshot: Vec<MediaRef>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub is_playing: bool,
    /// ids (see `queue_entry_to_media_ref`'s `blake3_hash`) of
    /// recently-finished queue entries, most recent first - built from
    /// `MusicState::history` by `run.rs`'s `handle_pairing_dispatch`.
    pub recently_played: Vec<String>,
}

/// converts a unified queue entry into the wire `MediaRef` shape -
/// `blake3_hash` is the entry's real content hash (`source_blake3`)
/// when known (remote-pushed items), falling back to the entry's
/// synthesized id (media_blob_id/id) for locally-queued songs, which
/// have no wire-provided hash. reporting the real hash here matters:
/// a remote controller's own dedup (e.g. spume's
/// `selectPlaybackTarget.ts` comparing this against a local song's
/// own `blake3`) can only actually recognize "this is already
/// queued" if the value it's comparing against is the real hash, not
/// an arbitrary internal id - see `SongRow::source_blake3`'s doc
/// comment.
pub fn queue_entry_to_media_ref(entry: &QueueEntry) -> MediaRef {
    match entry {
        QueueEntry::Song(song) => MediaRef {
            source_peer_addr: String::new(),
            blake3_hash: song
                .source_blake3
                .clone()
                .or_else(|| song.media_blob_id.clone())
                .unwrap_or_else(|| song.id.clone()),
            size_bytes: None,
            duration_ms: song.duration_ms,
            mime_type: None,
            kind: Some(MediaKind::Audio),
            title: Some(song.title.clone()),
            artist: song.artist.clone(),
            artwork_thumb_url: None,
            artwork_full_url: None,
            available_renditions: Vec::new(),
        },
        QueueEntry::Video(video) => MediaRef {
            source_peer_addr: String::new(),
            blake3_hash: video
                .source_blake3
                .clone()
                .or_else(|| video.media_blob_id.clone())
                .unwrap_or_else(|| video.id.clone()),
            size_bytes: None,
            duration_ms: video.duration_ms,
            mime_type: None,
            kind: Some(MediaKind::Video),
            title: Some(video.title.clone()),
            artist: None,
            artwork_thumb_url: None,
            artwork_full_url: None,
            available_renditions: Vec::new(),
        },
    }
}

/// converts a freshly-imported (real library song/video, not a
/// throwaway cache file) wire `MediaRef` into a unified queue entry -
/// see `super::import::import_pushed_media`'s module doc for why this
/// replaced the old cache-only resolve+wrap approach.
fn media_ref_to_queue_entry(
    media: &MediaRef,
    imported: super::import::ImportedMedia,
) -> QueueEntry {
    let title = media
        .title
        .clone()
        .unwrap_or_else(|| "untitled".to_string());
    match media.kind.unwrap_or(MediaKind::Audio) {
        MediaKind::Audio => QueueEntry::Song(SongRow {
            id: imported.entity_id,
            title,
            artist: media.artist.clone(),
            album: None,
            album_id: None,
            artist_id: None,
            duration_ms: media.duration_ms,
            media_blob_id: Some(imported.media_blob_id),
            local_path: Some(imported.local_path),
            // a freshly-imported song's own thumbnail/waveform
            // extraction may not have finished synchronously yet (or
            // may be job-based, which rathole doesn't run a processor
            // for) - `art_url` (the source peer's thumb/full art,
            // usually a `data:` url) covers art for THIS playback
            // regardless; browsing this song normally later (now a
            // real library entry) will pick up `art_blob_ids` the
            // usual way once/if extraction has landed.
            art_blob_ids: Vec::new(),
            art_url: media
                .artwork_full_url
                .clone()
                .or_else(|| media.artwork_thumb_url.clone()),
            source_blake3: Some(media.blake3_hash.clone()),
        }),
        MediaKind::Video => QueueEntry::Video(QueuedVideoRow {
            id: imported.entity_id,
            title,
            duration_ms: media.duration_ms,
            media_blob_id: Some(imported.media_blob_id),
            local_path: Some(imported.local_path),
            source_blake3: Some(media.blake3_hash.clone()),
        }),
    }
}

/// dispatch one already-authorized `PairingCommand` against real
/// playback state, returning the `CommandAck` to send back on the
/// wire. lives here (not `tty::run`) so the mapping from wire command
/// to concrete `PlayerCmd`/`VideoCommand` calls is unit-testable in
/// isolation from the rest of the event loop.
pub async fn dispatch_pairing_command(ctx: DispatchContext, command: PairingCommand) -> CommandAck {
    match command {
        // a single ad-hoc `play` is just a one-item `replace_queue` -
        // keeping it on the same path means it also correctly updates
        // rathole's own unified queue/ui instead of bypassing it.
        PairingCommand::Play { item } => replace_queue(&ctx, vec![item]).await,
        PairingCommand::ReplaceQueue { items } => replace_queue(&ctx, items).await,
        PairingCommand::AppendQueue { items } => append_queue(&ctx, items).await,
        PairingCommand::Pause => {
            send_generic(
                &ctx,
                PlayerCmd::Pause,
                crate::ratcore::app::VideoCommand::Pause,
            )
            .await;
            status_ack(&ctx, None)
        }
        PairingCommand::Resume => {
            send_generic(
                &ctx,
                PlayerCmd::Play,
                crate::ratcore::app::VideoCommand::Play,
            )
            .await;
            status_ack(&ctx, None)
        }
        PairingCommand::Seek { position_ms } => {
            send_generic(
                &ctx,
                PlayerCmd::Seek(position_ms),
                crate::ratcore::app::VideoCommand::Seek {
                    seconds: position_ms as f64 / 1000.0,
                },
            )
            .await;
            status_ack(&ctx, None)
        }
        PairingCommand::Stop => {
            send_generic(
                &ctx,
                PlayerCmd::Stop,
                crate::ratcore::app::VideoCommand::Close,
            )
            .await;
            status_ack(&ctx, None)
        }
        PairingCommand::SetVolume { volume } => {
            if let Some(player) = &ctx.player {
                let _ = player.send(PlayerCmd::SetVolume(volume as f32)).await;
            }
            if let Some(vp) = &ctx.video_player {
                let _ = vp
                    .send(crate::ratcore::app::VideoCommand::SetVolume { volume })
                    .await;
            }
            status_ack(&ctx, None)
        }
        PairingCommand::Skip => {
            // route through the unified queue's own advance logic
            // (see `AppAction::PairingSkip`'s doc comment) rather than
            // a backend-native "next" - neither rodio nor mpv ever
            // have more than one track loaded at once, so their own
            // Next/skip primitives are a no-op.
            if let Some(tx) = &ctx.action_tx {
                let _ = tx.send(AppAction::PairingSkip);
            }
            status_ack(&ctx, None)
        }
        PairingCommand::GetStatus => status_ack(&ctx, None),
        PairingCommand::RemoveFromQueue { index } => {
            // same "no &mut App here" reasoning as PairingSkip -
            // routed through an AppAction so `run.rs`'s loop (which
            // does have `&mut App`) can call `tty::queue::
            // remove_from_queue` directly.
            if let Some(tx) = &ctx.action_tx {
                let _ = tx.send(AppAction::PairingRemoveFromQueue { index });
            }
            status_ack(&ctx, None)
        }
        PairingCommand::ReorderQueue {
            from_index,
            to_index,
        } => {
            if let Some(tx) = &ctx.action_tx {
                let _ = tx.send(AppAction::PairingReorderQueue {
                    from_index,
                    to_index,
                });
            }
            status_ack(&ctx, None)
        }
        PairingCommand::TuneRadio {
            peer_addr,
            station_id,
        } => {
            // same "no &mut App here" reasoning as PairingSkip - routed
            // through an AppAction so `run.rs`'s loop (which does have
            // `&mut App`) can call `tty::radio::start` directly.
            if let Some(tx) = &ctx.action_tx {
                let _ = tx.send(AppAction::PairingTuneRadio {
                    peer_addr,
                    station_id,
                });
            }
            status_ack(&ctx, None)
        }
        PairingCommand::StopRadio => {
            if let Some(tx) = &ctx.action_tx {
                let _ = tx.send(AppAction::PairingStopRadio);
            }
            status_ack(&ctx, None)
        }
        // not yet supported - see module doc / plan doc follow-ups.
        PairingCommand::SetAutoDownloadEnabled { .. } => {
            CommandAck::err(CommandAckReason::InvalidCommand)
        }
    }
}

async fn send_generic(
    ctx: &DispatchContext,
    audio_cmd: PlayerCmd,
    video_cmd: crate::ratcore::app::VideoCommand,
) {
    match ctx.active_backend {
        ActiveBackend::Audio => {
            if let Some(player) = &ctx.player {
                let _ = player.send(audio_cmd).await;
            }
        }
        ActiveBackend::Video => {
            if let Some(vp) = &ctx.video_player {
                let _ = vp.send(video_cmd).await;
            }
        }
    }
}

/// pushes (or, with `None`, clears) the pairing view's live
/// download-progress indicator - a no-op when no action channel was
/// wired in (e.g. unit tests, which construct `DispatchContext`
/// without one).
fn report_download_progress(
    ctx: &DispatchContext,
    progress: Option<crate::ratcore::app::PairingDownloadProgress>,
) {
    if let Some(tx) = &ctx.action_tx {
        let _ = tx.send(AppAction::PairingDownloadProgress(progress));
    }
}

/// builds a cumulative-bytes progress callback for one item within a
/// batch of `item_count`, reporting through `ctx.action_tx` tagged
/// with enough context (`item_index`/`title`/`total_bytes`) for the ui
/// to render "downloading 2/5: <title> (43%)". `None` when there's no
/// action channel to report through.
fn queue_progress_reporter(
    ctx: &DispatchContext,
    item_index: usize,
    item_count: usize,
    title: Option<String>,
    total_bytes: Option<u64>,
) -> Option<impl Fn(u64) + Send + Sync + 'static> {
    let tx = ctx.action_tx.clone()?;
    Some(move |bytes: u64| {
        let _ = tx.send(AppAction::PairingDownloadProgress(Some(
            crate::ratcore::app::PairingDownloadProgress {
                item_index,
                item_count,
                bytes,
                total_bytes,
                title: title.clone(),
            },
        )));
    })
}

/// which unified-queue action `resolve_queue_items` should send for
/// each item as it finishes resolving (see the function's own doc).
#[derive(Clone, Copy)]
enum DeliveryMode {
    /// the first resolved item replaces the queue (and starts
    /// playback); every item after that appends.
    ReplaceFirstThenAppend,
    /// every resolved item appends, never replaces.
    AlwaysAppend,
}

/// resolves each item to a real local library entry and a unified
/// queue entry (audio or video - see `QueueEntry`), in original order,
/// via `super::import::import_pushed_media`. skips (with a warning)
/// any item that fails to import, best-effort rather than all-or-
/// nothing so one broken/unreachable track doesn't drop an otherwise-
/// good queue push. reports live byte progress per item via
/// `ctx.action_tx` for the tui's download indicator.
///
/// delivers each item to the unified queue AS SOON AS IT RESOLVES
/// (via `mode`), rather than waiting for the whole batch - a queue
/// push with several large/slow files could otherwise leave the tui's
/// queue view completely empty (and playback not started) for a
/// minute or more. the returned `Vec` is still the full resolved set,
/// used by the caller only to build the wire ack's status snapshot.
async fn resolve_queue_items(
    ctx: &DispatchContext,
    items: Vec<MediaRef>,
    mode: DeliveryMode,
) -> Vec<QueueEntry> {
    let item_count = items.len();
    let mut entries = Vec::with_capacity(item_count);
    let mut sent_first = false;
    // defensive dedup: a flaky controller reconnect (or a client-side
    // bug) can resend item(s) it already successfully queued - skip
    // anything whose real content hash is already live in the queue,
    // rather than trusting every caller to get its own dedup right.
    // seeded from `ctx.queue_snapshot` (which now reports each entry's
    // real `source_blake3` - see `queue_entry_to_media_ref`'s doc
    // comment - not an internal id, so this actually matches), then
    // grown as this same batch resolves so a push repeating itself
    // doesn't double up either. `replace_queue` starts from an empty
    // set - the old queue is being thrown away anyway, so there's
    // nothing to compare against yet.
    let mut queued_hashes: std::collections::HashSet<String> = match mode {
        DeliveryMode::AlwaysAppend => ctx
            .queue_snapshot
            .iter()
            .map(|m| m.blake3_hash.clone())
            .collect(),
        DeliveryMode::ReplaceFirstThenAppend => std::collections::HashSet::new(),
    };
    // show every incoming item as a placeholder row immediately (see
    // `AppAction::PairingQueuePending`'s doc comment) - before any of
    // them have actually been pulled/imported. a duplicate skipped
    // below just gets "settled" (removed) quickly with nothing to
    // show for it, same as a genuine resolve failure.
    if let Some(tx) = &ctx.action_tx {
        let _ = tx.send(AppAction::PairingQueuePending {
            items: items.clone(),
        });
    }
    for (item_index, item) in items.into_iter().enumerate() {
        if !queued_hashes.insert(item.blake3_hash.clone()) {
            warn!(target: "player_protocol", blake3 = %item.blake3_hash, "skipping already-queued duplicate item");
            if let Some(tx) = &ctx.action_tx {
                let _ = tx.send(AppAction::PairingQueuePreviewSettled {
                    blake3_hash: item.blake3_hash.clone(),
                });
            }
            continue;
        }
        let kind = item.kind.unwrap_or(MediaKind::Audio);
        // prefer an already-transcoded rendition over the original for
        // videos, if the pushing device advertised one (smallest
        // first) - less to transfer, and rathole's own transcode job
        // (if enabled at all) is more likely to no-op on an already-
        // compatible file anyway (see should_skip_transcode upstream).
        // no equivalent for audio - rathole's backends already handle
        // virtually any audio codec/container directly.
        let preferred_rendition = if kind == MediaKind::Video {
            item.available_renditions
                .iter()
                .min_by_key(|r| r.width.unwrap_or(u32::MAX))
        } else {
            None
        };
        let pull_hash = preferred_rendition
            .map(|r| r.blake3_hash.as_str())
            .unwrap_or(item.blake3_hash.as_str());
        // a rendition's exact size isn't advertised on the wire (only
        // the original's is) - the download-progress indicator falls
        // back to a cumulative-bytes-only display (no percentage) in
        // that case rather than showing progress against the wrong
        // (much larger) total.
        let pull_size_hint = if preferred_rendition.is_some() {
            None
        } else {
            item.size_bytes
        };
        let reporter = queue_progress_reporter(
            ctx,
            item_index,
            item_count,
            item.title.clone(),
            pull_size_hint,
        );
        let on_progress = reporter
            .as_ref()
            .map(|f| f as &grimoire::federation::p2p_client::BlobProgressFn);
        let filename = item
            .title
            .clone()
            .unwrap_or_else(|| item.blake3_hash.clone());
        match super::import::import_pushed_media(
            &item.source_peer_addr,
            pull_hash,
            &filename,
            pull_size_hint,
            kind,
            on_progress,
        )
        .await
        {
            Ok(imported) => {
                let entry = media_ref_to_queue_entry(&item, imported);
                if let Some(tx) = &ctx.action_tx {
                    let action = match (mode, sent_first) {
                        (DeliveryMode::ReplaceFirstThenAppend, false) => {
                            AppAction::PairingReplaceQueue {
                                entries: vec![entry.clone()],
                            }
                        }
                        _ => AppAction::PairingAppendQueue {
                            entries: vec![entry.clone()],
                        },
                    };
                    let _ = tx.send(action);
                    let _ = tx.send(AppAction::PairingQueuePreviewSettled {
                        blake3_hash: item.blake3_hash.clone(),
                    });
                }
                sent_first = true;
                entries.push(entry);
            }
            Err(e) => {
                warn!(target: "player_protocol", error = %e, "failed to import queued media ref, skipping");
                if let Some(tx) = &ctx.action_tx {
                    let _ = tx.send(AppAction::PairingQueuePreviewSettled {
                        blake3_hash: item.blake3_hash.clone(),
                    });
                }
            }
        }
    }
    report_download_progress(ctx, None);
    entries
}

/// replaces rathole's unified play queue with `items`, starting
/// playback from the first item as soon as IT resolves (not waiting
/// for the whole batch - see `resolve_queue_items`'s doc comment).
/// goes through the exact same `tty::queue::set_queue_entries`/
/// `append_queue_entries` path a local queue replace/append does. a
/// queue can be audio-only, video-only, or a genuine mix of both.
async fn replace_queue(ctx: &DispatchContext, items: Vec<MediaRef>) -> CommandAck {
    if items.is_empty() {
        return status_ack(ctx, None);
    }
    let entries = resolve_queue_items(ctx, items, DeliveryMode::ReplaceFirstThenAppend).await;
    if entries.is_empty() {
        return status_ack(
            ctx,
            Some(PlayerStatus::Error {
                message: "no playable items in queue".to_string(),
                common: common_from_ctx(ctx),
            }),
        );
    }
    let fresh_queue: Vec<MediaRef> = entries.iter().map(queue_entry_to_media_ref).collect();
    // built directly from what was just resolved (not `ctx.
    // queue_snapshot`, a stale pre-dispatch snapshot) so the
    // controller sees the new queue immediately rather than waiting
    // for the next status poll/command - see the module doc's "known
    // simplifications" for the residual (same-process, near-instant)
    // timing gap this doesn't cover.
    CommandAck::ok(PlayerStatus::Buffering {
        common: StatusCommon {
            queue: fresh_queue,
            auto_download_enabled: false,
            volume: ctx.volume as f64,
            recently_played: ctx.recently_played.clone(),
        },
    })
}

/// appends `items` to rathole's unified play queue without disturbing
/// what's currently playing, each item appended as soon as IT resolves
/// (not waiting for the whole batch - see `resolve_queue_items`'s doc
/// comment) - the same `tty::queue::append_queue_entries` path a local
/// queue append uses.
async fn append_queue(ctx: &DispatchContext, items: Vec<MediaRef>) -> CommandAck {
    if items.is_empty() {
        return status_ack(ctx, None);
    }
    let entries = resolve_queue_items(ctx, items, DeliveryMode::AlwaysAppend).await;
    if entries.is_empty() {
        return status_ack(
            ctx,
            Some(PlayerStatus::Error {
                message: "no playable items to append".to_string(),
                common: common_from_ctx(ctx),
            }),
        );
    }
    let mut combined_queue = ctx.queue_snapshot.clone();
    combined_queue.extend(entries.iter().map(queue_entry_to_media_ref));
    status_with_common(
        ctx,
        StatusCommon {
            queue: combined_queue,
            auto_download_enabled: false,
            volume: ctx.volume as f64,
            recently_played: ctx.recently_played.clone(),
        },
    )
}

fn common_from_ctx(ctx: &DispatchContext) -> StatusCommon {
    StatusCommon {
        queue: ctx.queue_snapshot.clone(),
        auto_download_enabled: false,
        volume: ctx.volume as f64,
        recently_played: ctx.recently_played.clone(),
    }
}

/// builds a status from an explicit `common` (rather than `ctx.
/// queue_snapshot`) using `ctx.is_playing`/`ctx.position_ms` for the
/// playing/paused/stopped split - shared by `status_ack`'s default
/// path and `append_queue`'s "combined queue, unchanged playback
/// state" ack.
fn status_with_common(ctx: &DispatchContext, common: StatusCommon) -> CommandAck {
    let status = match common.queue.first() {
        None => PlayerStatus::Stopped { common },
        Some(item) if ctx.is_playing => PlayerStatus::NowPlaying {
            item: Box::new(item.clone()),
            position_ms: ctx.position_ms,
            server_time_ms: now_ms().max(0) as u64,
            common,
        },
        Some(_) => PlayerStatus::Paused {
            position_ms: ctx.position_ms,
            common,
        },
    };
    CommandAck::ok(status)
}

/// default status when a command didn't produce a more specific one
/// (e.g. an error) - built from the real queue/position/playing
/// snapshot `run.rs` assembled into `ctx` before dispatch, so
/// `get_status`/every command ack reflects actual playback state
/// instead of always claiming an empty queue stuck `Buffering`.
fn status_ack(ctx: &DispatchContext, explicit: Option<PlayerStatus>) -> CommandAck {
    match explicit {
        Some(status) => CommandAck::ok(status),
        None => status_with_common(ctx, common_from_ctx(ctx)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ratcore::app::MediaKind;

    fn ref_with_kind(kind: MediaKind) -> MediaRef {
        MediaRef {
            source_peer_addr: "peer".into(),
            blake3_hash: "hash".into(),
            size_bytes: None,
            duration_ms: None,
            mime_type: None,
            kind: Some(kind),
            title: None,
            artist: None,
            artwork_thumb_url: None,
            artwork_full_url: None,
            available_renditions: Vec::new(),
        }
    }

    fn empty_ctx() -> DispatchContext {
        DispatchContext {
            active_backend: ActiveBackend::Audio,
            player: None,
            video_player: None,
            volume: 1.0,
            action_tx: None,
            queue_snapshot: vec![],
            position_ms: 0,
            duration_ms: 0,
            is_playing: false,
            recently_played: vec![],
        }
    }

    #[tokio::test]
    async fn get_status_acks_ok_without_a_backend() {
        let ack = dispatch_pairing_command(empty_ctx(), PairingCommand::GetStatus).await;
        assert!(ack.ok);
    }

    #[tokio::test]
    async fn unsupported_commands_ack_with_invalid_command() {
        let ack = dispatch_pairing_command(
            empty_ctx(),
            PairingCommand::SetAutoDownloadEnabled { enabled: true },
        )
        .await;
        assert!(!ack.ok);
        assert_eq!(ack.reason, Some(CommandAckReason::InvalidCommand));
    }

    #[tokio::test]
    async fn tune_radio_acks_ok_even_without_an_action_channel() {
        // dispatch has no `&mut App` (see `DispatchContext`'s doc
        // comment) - it just forwards to `AppAction::PairingTuneRadio`/
        // `PairingStopRadio` when an action channel is wired, and acks
        // ok regardless (mirrors `PairingSkip`/`PairingRemoveFromQueue`).
        let ack = dispatch_pairing_command(
            empty_ctx(),
            PairingCommand::TuneRadio {
                peer_addr: "x".into(),
                station_id: None,
            },
        )
        .await;
        assert!(ack.ok);
        let ack = dispatch_pairing_command(empty_ctx(), PairingCommand::StopRadio).await;
        assert!(ack.ok);
    }

    #[tokio::test]
    async fn append_queue_with_no_items_is_a_no_op_ok_ack() {
        let ack =
            dispatch_pairing_command(empty_ctx(), PairingCommand::AppendQueue { items: vec![] })
                .await;
        assert!(ack.ok);
    }

    #[tokio::test]
    async fn append_queue_with_no_backends_acks_error_status_not_invalid() {
        grimoire::config::init_config_for_tests();
        // video queueing IS supported now (mpv playlist) - no backend
        // attached in this test just means resolution has nowhere to
        // land, not that the command itself is invalid.
        let ack = dispatch_pairing_command(
            empty_ctx(),
            PairingCommand::AppendQueue {
                items: vec![ref_with_kind(MediaKind::Video)],
            },
        )
        .await;
        assert!(
            ack.ok,
            "resolve failure (no network in test) still acks ok/error status, not invalid_command"
        );
    }

    #[tokio::test]
    async fn replace_queue_with_no_items_is_a_no_op_ok_ack() {
        let ack =
            dispatch_pairing_command(empty_ctx(), PairingCommand::ReplaceQueue { items: vec![] })
                .await;
        assert!(ack.ok);
    }
}

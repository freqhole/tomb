//! music view state + types — portable, no rodio/grimoire deps.
//!
//! shells provide:
//! - `Transport::search_songs(...)` to fill in [`MusicState::results`]
//! - a `MusicPlayer` impl (see `super::super::transport::MusicPlayer`)
//!   to drive playback. tty wraps grimoire's rodio backend; web is a
//!   noop today.
//!
//! the ui has three sub-modes (the `Focus` enum stays simple: just
//! `Focus::MusicView`, and [`MusicMode`] picks where keystrokes go).

use super::queue::QueueEntry;
use super::video_player::AudioDeviceInfo;

/// portable subset of `grimoire::music::entities::songs::Song`. only
/// the fields the tui needs to render + queue + play.
#[derive(Debug, Clone, PartialEq)]
pub struct SongRow {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// canonical album id from the library, if known. used by the
    /// "go to album" row action to pivot to the matching album view
    /// without name-string fuzziness.
    pub album_id: Option<String>,
    /// canonical artist id from the library, if known. used by the
    /// "go to artist" row action.
    pub artist_id: Option<String>,
    pub duration_ms: Option<u64>,
    /// id of the row in `media_blobz`; tty resolves this to a local
    /// file path before handing to rodio.
    pub media_blob_id: Option<String>,
    /// if the shell already knows a usable filesystem path, set it
    /// here so the player skips another lookup.
    pub local_path: Option<String>,
    /// `media_blobz` ids for available artwork, priority-ordered (song's
    /// own primary image first, then its other images, then album
    /// images, then artist images; waveform blobs excluded). only the
    /// first is shown today, but the list is kept in priority order so
    /// a future art carousel can just rotate through it - see
    /// docs/rathole-headless-player-plan.md's image rendering section.
    pub art_blob_ids: Vec<String>,
    /// artwork for a remote-pushed queue entry (see `media_ref_to_queue_
    /// entry`), which has no locally-resolvable `art_blob_ids` - a
    /// `data:` url (spume embeds bytes directly for most cases, see
    /// `playerQueuePush.ts`'s `resolveArtwork`) or occasionally a real
    /// http(s) url. `None` for locally-queued songs, which always use
    /// `art_blob_ids` instead.
    pub art_url: Option<String>,
}

/// portable mirror of `grimoire::player::PlayerState`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PlayerState {
    #[default]
    Stopped,
    Loading,
    Playing,
    Paused,
}

/// portable mirror of `grimoire::player::PlayerEvent`. shells fan
/// these into the app's `AppAction::MusicEvent` channel.
#[derive(Debug, Clone)]
pub enum MusicEvent {
    State(PlayerState),
    Progress {
        ms: u64,
        total_ms: u64,
    },
    TrackChanged {
        index: usize,
        path: String,
    },
    /// shells emit this from background blob-resolution tasks so the
    /// ui can show "loading N more" while a queue is still being
    /// fetched. `remaining` is the number of rows still pending.
    QueueResolveProgress {
        remaining: usize,
    },
    Ended,
    Error(String),
    /// reply to a rodio `ListOutputDevices` request (audio output
    /// devices - e.g. a pi's hdmi vs. 3.5mm jack). shares
    /// `video_player`'s `AudioDeviceInfo` shape since it's the same
    /// concept, just from the audio-only backend.
    OutputDevices {
        devices: Vec<AudioDeviceInfo>,
    },
}

/// which sub-area of the music view has focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MusicMode {
    /// editing the search box.
    #[default]
    Search,
    /// browsing the results list.
    Results,
}

/// in-memory state for the music view. lives on `EphemeralState`.
#[derive(Debug, Clone, Default)]
pub struct MusicState {
    pub mode: MusicMode,
    /// search input buffer.
    pub query: String,
    /// caret in `query`, in chars.
    pub query_cursor: usize,
    pub searching: bool,
    pub search_error: Option<String>,
    pub results: Vec<SongRow>,
    pub results_cursor: usize,
    /// play queue. populated when the user picks a result row;
    /// usually `results[results_cursor..]`. can mix song + video
    /// entries (see `QueueEntry`) - only `queue[current]` is ever the
    /// active thing actually playing.
    pub queue: Vec<QueueEntry>,
    /// index into `queue` of the currently-playing track.
    pub current: Option<usize>,
    pub player_state: PlayerState,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub volume: f32,
    pub last_event_error: Option<String>,
    /// number of queue rows whose blob urls are still being fetched
    /// in the background. shells set this when they kick off a
    /// progressive queue load and decrement via
    /// [`MusicEvent::QueueResolveProgress`].
    pub queue_resolving: usize,
    /// when set, the next successful search results will be
    /// auto-played from index 0. used by `/play <query>` slash
    /// commands. shells clear this on consume.
    pub auto_play_on_results: bool,
    /// favorited status of the currently-playing song. shell
    /// refreshes via [`Transport::is_favorited`] on track-change and
    /// flips locally on `f`-keybind toggles.
    pub current_favorited: bool,
    /// most recently reported rodio output-device list (from
    /// `MusicEvent::OutputDevices`); empty until a `ListOutputDevices`
    /// round trip completes at least once.
    pub output_devices: Vec<AudioDeviceInfo>,
    /// name of the device we last asked rodio to switch to
    /// (optimistic - mirrors `VideoPlayerState::selected_audio_device`;
    /// the backend doesn't currently confirm which device ended up
    /// active).
    pub selected_output_device: Option<String>,
    /// true while the unified queue's current entry is a video that's
    /// been loaded into mpv via a queue advance (`tty::queue::
    /// play_index`) - distinguishes that from an unrelated ad-hoc
    /// video preview started from the video browse view (`p` key),
    /// which must NOT trigger the queue to auto-advance when it ends.
    pub queue_video_active: bool,
    /// set right before sending a song to rodio (`PlayerCmd::Load`),
    /// cleared as soon as we see a genuine success signal
    /// (`MusicEvent::State(Playing)`) for it. if `MusicEvent::Ended`
    /// fires while this is still `Some` and matches the current
    /// entry's song id, rodio produced zero playable output (couldn't
    /// decode/init the file) rather than a real end-of-track - see
    /// `audio_fallback_active`.
    pub pending_rodio_song_id: Option<String>,
    /// true while mpv is being used as an audio-only fallback player
    /// for the current queue entry because rodio couldn't decode it
    /// (e.g. opus-in-webm, which rodio's symphonia backend doesn't
    /// support). distinct from `queue_video_active` (a real
    /// `QueueEntry::Video`): mpv is spawned with `--force-window=no`
    /// and this file has no video track, so no window shows - but
    /// mpv's Ended/Closed/Error still needs to advance the queue, and
    /// the qr/art framebuffer sync needs to back off while it's active,
    /// same as it already does for a real video.
    pub audio_fallback_active: bool,
    /// entries that have finished playing (or been skipped past),
    /// most-recently-finished first - removed from `queue` as playback
    /// advances (see `tty::queue::play_index`), so `queue` only ever
    /// holds "currently playing + upcoming", matching cenotaph/web's
    /// queue model instead of accumulating every past track forever.
    /// capped at a small size (see `tty::queue::HISTORY_CAP`);
    /// `play_previous` pulls from the front of this to go back.
    pub history: Vec<QueueEntry>,
}

impl MusicState {
    pub fn new() -> Self {
        Self {
            volume: 1.0,
            ..Self::default()
        }
    }

    pub fn currently_playing(&self) -> Option<&QueueEntry> {
        self.current.and_then(|i| self.queue.get(i))
    }
}

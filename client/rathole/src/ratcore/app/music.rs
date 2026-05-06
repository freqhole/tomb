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

/// portable subset of `grimoire::music::entities::songs::Song`. only
/// the fields the tui needs to render + queue + play.
#[derive(Debug, Clone)]
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
}

/// portable mirror of `grimoire::player::PlayerState`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerState {
    Stopped,
    Loading,
    Playing,
    Paused,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::Stopped
    }
}

/// portable mirror of `grimoire::player::PlayerEvent`. shells fan
/// these into the app's `AppAction::MusicEvent` channel.
#[derive(Debug, Clone)]
pub enum MusicEvent {
    State(PlayerState),
    Progress { ms: u64, total_ms: u64 },
    TrackChanged { index: usize, path: String },
    /// shells emit this from background blob-resolution tasks so the
    /// ui can show "loading N more" while a queue is still being
    /// fetched. `remaining` is the number of rows still pending.
    QueueResolveProgress { remaining: usize },
    Ended,
    Error(String),
}

/// which sub-area of the music view has focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MusicMode {
    /// editing the search box.
    Search,
    /// browsing the results list.
    Results,
}

impl Default for MusicMode {
    fn default() -> Self {
        Self::Search
    }
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
    /// usually `results[results_cursor..]`.
    pub queue: Vec<SongRow>,
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
}

impl MusicState {
    pub fn new() -> Self {
        Self {
            volume: 1.0,
            ..Self::default()
        }
    }

    pub fn currently_playing(&self) -> Option<&SongRow> {
        self.current.and_then(|i| self.queue.get(i))
    }
}

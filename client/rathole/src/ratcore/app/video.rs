//! video view state + types — portable, no grimoire deps.
//!
//! shells provide:
//! - `Transport::query_videos(...)` to fill in [`VideoState::results`]
//! - `Transport::get_video(...)` for detail view
//! - `Transport::update_video(...)` for editing metadata
//! - `Transport::delete_video(...)` for soft-deleting a video
//! - `Transport::list_video_series(...)` for series context display
//!
//! the ui has three sub-modes (the `Focus` enum stays simple: just
//! `Focus::VideoView`, and [`VideoMode`] picks where keystrokes go).

/// portable subset of `grimoire::video::entities::videos::Video`. only
/// the fields the tui needs to render + browse + edit.
#[derive(Debug, Clone)]
pub struct VideoRow {
    pub id: String,
    pub title: String,
    pub series_id: Option<String>,
    pub series_name: Option<String>,
    pub season_id: Option<String>,
    pub episode_number: Option<i64>,
    pub duration_seconds: Option<f64>,
    pub description: Option<String>,
    pub media_blob_id: String,
    pub poster_blob_id: Option<String>,
    pub release_date: Option<String>,
}

/// portable subset of `grimoire::video::entities::series::VideoSeries`.
/// used for read-only series context display in the detail view.
#[derive(Debug, Clone)]
pub struct SeriesRow {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
}

/// which sub-area of the video view has focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VideoMode {
    /// browsing the results list.
    #[default]
    Results,
    /// viewing a single video's detail.
    Detail,
    /// editing the selected video's metadata (title, description, episode_number).
    Edit,
}

/// in-memory state for the video view. lives on `EphemeralState`.
#[derive(Debug, Clone, Default)]
pub struct VideoState {
    pub mode: VideoMode,
    /// search/filter input buffer.
    pub query: String,
    pub searching: bool,
    pub search_error: Option<String>,
    pub results: Vec<VideoRow>,
    pub results_cursor: usize,
    /// the currently-selected video (populated on detail/edit entry).
    pub selected_video: Option<VideoRow>,
    /// edit buffer for title field.
    pub edit_title: String,
    /// edit buffer for description field.
    pub edit_description: String,
    /// edit buffer for episode_number field (stringified for text input).
    pub edit_episode_number: String,
    /// which field in edit mode has focus (0 = title, 1 = description, 2 = episode_number).
    pub edit_field_cursor: usize,
    /// caret position within the active edit field, in chars.
    pub edit_field_caret: usize,
    /// most recent error from an update or delete operation.
    pub last_error: Option<String>,
    /// when true, esc from results list shows a confirmation overlay; y/enter confirms delete.
    pub pending_delete_confirm: bool,
    /// series context for the selected video (loaded when entering detail mode).
    pub series_context: Vec<SeriesRow>,
}

impl VideoState {
    pub fn new() -> Self {
        Self::default()
    }

    /// prepare edit mode for the currently-selected video.
    pub fn begin_edit(&mut self) {
        if let Some(v) = &self.selected_video {
            self.edit_title = v.title.clone();
            self.edit_description = v.description.clone().unwrap_or_default();
            self.edit_episode_number = v.episode_number.map(|n| n.to_string()).unwrap_or_default();
            self.edit_field_cursor = 0;
            self.edit_field_caret = 0;
            self.mode = VideoMode::Edit;
        }
    }

    /// discard edit changes and return to detail view.
    pub fn cancel_edit(&mut self) {
        self.mode = VideoMode::Detail;
        self.edit_field_cursor = 0;
        self.edit_field_caret = 0;
    }

    /// return the currently-selected result row (read-only helper for detail view).
    pub fn current_result(&self) -> Option<&VideoRow> {
        self.results.get(self.results_cursor)
    }
}

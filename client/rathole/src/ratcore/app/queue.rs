//! the unified play queue - audio and video items sit together with a
//! single "current" index, so exactly one item is ever the active
//! thing playing (audio via rodio, video via mpv) - mirrors cenotaph's
//! own single-active-item queue model (one `<video>` element, only
//! `queue[0]` ever loaded). distinct from `MusicState::results`
//! (search/browse results, always audio) and from `VideoState` (video
//! browse/edit, single ad-hoc play, no queueing) - this is
//! specifically the playback queue, whether built locally (rathole's
//! own music search -> queue) or pushed remotely via the
//! `freqhole-player/1` pairing protocol (which can genuinely mix song
//! and video items in one push).

use super::music::SongRow;
use super::pairing::MediaKind;

/// the video counterpart to `SongRow`, for queue purposes only - NOT
/// used for video browse/edit (see `VideoRow` for that). minimal by
/// design: a queue entry only needs enough to display + resolve +
/// load into mpv.
#[derive(Debug, Clone, PartialEq)]
pub struct QueuedVideoRow {
    pub id: String,
    pub title: String,
    pub duration_ms: Option<u64>,
    pub media_blob_id: Option<String>,
    pub local_path: Option<String>,
    /// see `SongRow::source_blake3`'s doc comment.
    pub source_blake3: Option<String>,
}

/// one entry in the unified play queue.
#[derive(Debug, Clone, PartialEq)]
pub enum QueueEntry {
    Song(SongRow),
    Video(QueuedVideoRow),
}

impl QueueEntry {
    pub fn title(&self) -> &str {
        match self {
            QueueEntry::Song(s) => &s.title,
            QueueEntry::Video(v) => &v.title,
        }
    }

    pub fn artist(&self) -> Option<&str> {
        match self {
            QueueEntry::Song(s) => s.artist.as_deref(),
            QueueEntry::Video(_) => None,
        }
    }

    pub fn album(&self) -> Option<&str> {
        match self {
            QueueEntry::Song(s) => s.album.as_deref(),
            QueueEntry::Video(_) => None,
        }
    }

    pub fn duration_ms(&self) -> Option<u64> {
        match self {
            QueueEntry::Song(s) => s.duration_ms,
            QueueEntry::Video(v) => v.duration_ms,
        }
    }

    pub fn kind(&self) -> MediaKind {
        match self {
            QueueEntry::Song(_) => MediaKind::Audio,
            QueueEntry::Video(_) => MediaKind::Video,
        }
    }

    /// library song id, for favorites-toggle matching - `None` for a
    /// video entry (favorites is an audio-only concept today).
    pub fn song_id(&self) -> Option<&str> {
        match self {
            QueueEntry::Song(s) => Some(&s.id),
            QueueEntry::Video(_) => None,
        }
    }

    pub fn as_song(&self) -> Option<&SongRow> {
        match self {
            QueueEntry::Song(s) => Some(s),
            QueueEntry::Video(_) => None,
        }
    }

    pub fn as_video(&self) -> Option<&QueuedVideoRow> {
        match self {
            QueueEntry::Video(v) => Some(v),
            QueueEntry::Song(_) => None,
        }
    }
}

impl From<SongRow> for QueueEntry {
    fn from(s: SongRow) -> Self {
        QueueEntry::Song(s)
    }
}

impl From<QueuedVideoRow> for QueueEntry {
    fn from(v: QueuedVideoRow) -> Self {
        QueueEntry::Video(v)
    }
}

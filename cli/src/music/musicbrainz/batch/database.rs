//! Database operations for batch processing

use legacylib::music::{repository::MusicRepository, Song};

/// get songs for batch scanning based on various filters
pub async fn get_songs_for_batch_scan(
    repository: &MusicRepository,
    limit: i64,
    offset: i64,
    unscanned_only: bool,
    rescan_updated: bool,
    force_rescan: bool,
    _query: Option<&str>, // TODO: implement custom query support
    artist: Option<&str>,
    album: Option<&str>,
    missing_metadata: Option<&str>,
) -> Result<Vec<Song>, Box<dyn std::error::Error>> {
    let songs = repository
        .get_songs_for_batch_scan(
            limit,
            offset,
            unscanned_only,
            rescan_updated,
            force_rescan,
            artist,
            album,
            missing_metadata,
        )
        .await?;

    Ok(songs)
}

//! artist/album linking for music-type videos ("music_video"/"karaoke").
//!
//! resolves what a caller asked for (an existing id, a typed name to
//! find-or-create, or nothing) into the final `(artist_id, album_id)` pair
//! to persist, applying the default-album rule: an artist with no explicit
//! album lands in their "music videos" / "karaoke videos" album. also owns
//! the orphan cleanup that has to run after a video moves between
//! artists/albums or is deleted.

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::music::analytics::feed_events::{
    delete_feed_events_for_album, delete_feed_events_for_artist,
};
use crate::music::crud::create_or_update::find_or_create_album_for_artist;
use crate::music::crud::delete::{delete_album_if_unused, delete_artist_if_unused};
use crate::music::crud::{find_or_create_artist, AlbumImportRequest, ArtistImportRequest};
use crate::video::entities::videos::{default_album_title, is_music_content_type};

/// what a caller asked for. every field is optional - `None` means "no
/// opinion, keep what the video has now" (never "clear", see
/// `resolve_music_link`'s docs).
#[derive(Debug, Clone, Default)]
pub struct MusicLinkRequest {
    pub artist_id: Option<String>,
    /// find-or-create by name (case-insensitive). ignored when `artist_id`
    /// is set.
    pub artist_name: Option<String>,
    pub album_id: Option<String>,
    /// find-or-create by title under the resolved artist. ignored when
    /// `album_id` is set.
    pub album_title: Option<String>,
}

/// the video's current links, for "keep unless asked to change" semantics.
#[derive(Debug, Clone, Default)]
pub struct CurrentMusicLink {
    pub artist_id: Option<String>,
    pub album_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ResolvedMusicLink {
    pub artist_id: Option<String>,
    pub album_id: Option<String>,
}

fn non_blank(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

/// resolve the artist/album a video of `content_type` should end up with.
///
/// - not a music content type: always `(None, None)`.
/// - artist: `artist_id` (must exist), else `artist_name` (find-or-create),
///   else the current artist.
/// - no artist: no album either (an album always belongs to an artist), and
///   an explicitly requested album without an artist is a validation error.
/// - album: `album_id` (must exist), else `album_title` (find-or-create under
///   the artist), else the current album when the artist didn't change and it
///   isn't the other music type's default album, else the artist's default
///   album for `content_type`.
pub async fn resolve_music_link(
    content_type: &str,
    req: &MusicLinkRequest,
    current: &CurrentMusicLink,
    created_by: Option<&str>,
) -> GrimoireResult<ResolvedMusicLink> {
    let Some(default_title) = default_album_title(content_type) else {
        return Ok(ResolvedMusicLink::default());
    };
    debug_assert!(is_music_content_type(content_type));

    let pool = database::connect().await?;

    let artist_id = if let Some(id) = non_blank(&req.artist_id) {
        let exists = sqlx::query_scalar!(
            "SELECT id FROM artistz WHERE id = ? AND deleted_at IS NULL",
            id
        )
        .fetch_optional(&pool)
        .await?;
        if exists.is_none() {
            return Err(GrimoireError::ArtistNotFound { id: id.to_string() });
        }
        Some(id.to_string())
    } else if let Some(name) = non_blank(&req.artist_name) {
        let resp = find_or_create_artist(ArtistImportRequest {
            name: name.to_string(),
            created_by: created_by.map(str::to_string),
        })
        .await;
        match resp.data {
            Some((artist, _)) => Some(artist.id),
            None => {
                return Err(GrimoireError::ProcessingFailed {
                    message: format!("failed to resolve artist \"{name}\": {}", resp.message),
                })
            }
        }
    } else {
        current.artist_id.clone()
    };

    let Some(artist_id) = artist_id else {
        if non_blank(&req.album_id).is_some() || non_blank(&req.album_title).is_some() {
            return Err(GrimoireError::Validation {
                field: "album_id".to_string(),
                message: "an album requires an artist".to_string(),
            });
        }
        return Ok(ResolvedMusicLink::default());
    };

    let album_id = if let Some(id) = non_blank(&req.album_id) {
        let exists = sqlx::query_scalar!(
            "SELECT id FROM albumz WHERE id = ? AND deleted_at IS NULL",
            id
        )
        .fetch_optional(&pool)
        .await?;
        if exists.is_none() {
            return Err(GrimoireError::AlbumNotFound { id: id.to_string() });
        }
        // an album nobody owns yet (e.g. created by hand) joins this
        // artist; an album that already has an artist is left alone -
        // `videoz.album_id` alone is enough to list the video under it.
        sqlx::query!(
            "INSERT INTO artist_albumz (artist_id, album_id)
             SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM artist_albumz WHERE album_id = ?)",
            artist_id,
            id,
            id
        )
        .execute(&pool)
        .await?;
        id.to_string()
    } else if let Some(title) = non_blank(&req.album_title) {
        find_album(title, &artist_id, created_by).await?
    } else if let Some(current_album) =
        keepable_current_album(&pool, content_type, &artist_id, current).await?
    {
        current_album
    } else {
        find_album(default_title, &artist_id, created_by).await?
    };

    Ok(ResolvedMusicLink {
        artist_id: Some(artist_id),
        album_id: Some(album_id),
    })
}

async fn find_album(
    title: &str,
    artist_id: &str,
    created_by: Option<&str>,
) -> GrimoireResult<String> {
    let (album, _) = find_or_create_album_for_artist(
        AlbumImportRequest {
            title: title.to_string(),
            album_type: None,
            release_date: None,
            label: None,
            genre_ids: None,
            created_by: created_by.map(str::to_string),
        },
        artist_id,
    )
    .await?;
    Ok(album.id)
}

/// the video's current album, when it's still a sensible home: the artist
/// didn't change, the album still exists, and it isn't the OTHER music
/// type's default album (a video flipped from music_video to karaoke
/// moves out of "music videos" into "karaoke videos" along with it).
async fn keepable_current_album(
    pool: &sqlx::SqlitePool,
    content_type: &str,
    artist_id: &str,
    current: &CurrentMusicLink,
) -> GrimoireResult<Option<String>> {
    let (Some(current_artist), Some(current_album)) = (&current.artist_id, &current.album_id)
    else {
        return Ok(None);
    };
    if current_artist != artist_id {
        return Ok(None);
    }

    let title = sqlx::query_scalar!(
        "SELECT title FROM albumz WHERE id = ? AND deleted_at IS NULL",
        current_album
    )
    .fetch_optional(pool)
    .await?;
    let Some(title) = title else {
        return Ok(None);
    };

    let is_other_default = ["music_video", "karaoke"]
        .iter()
        .filter(|ct| **ct != content_type)
        .filter_map(|ct| default_album_title(ct))
        .any(|t| t.eq_ignore_ascii_case(&title));
    Ok((!is_other_default).then(|| current_album.clone()))
}

/// soft-delete any of these albums/artists that no longer have a song or a
/// live video attached (and drop their now-pointless feed events). safe to
/// call with ids that are still in use - the underlying `*_if_unused`
/// helpers re-check usage themselves. best-effort: a failure here never
/// fails the edit that triggered it, the video change already succeeded.
pub async fn cleanup_orphaned_music_links(album_ids: &[String], artist_ids: &[String]) {
    let mut seen = std::collections::HashSet::new();
    for album_id in album_ids.iter().filter(|id| seen.insert(id.as_str())) {
        if delete_album_if_unused(album_id).await.data == Some(true) {
            let _ = delete_feed_events_for_album(album_id).await;
        }
    }
    let mut seen = std::collections::HashSet::new();
    for artist_id in artist_ids.iter().filter(|id| seen.insert(id.as_str())) {
        if delete_artist_if_unused(artist_id).await.data == Some(true) {
            let _ = delete_feed_events_for_artist(artist_id).await;
        }
    }
}

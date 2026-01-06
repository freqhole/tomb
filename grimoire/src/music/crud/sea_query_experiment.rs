//! Sea-query implementation with proper album grouping and extensible filters

use sea_query::{Expr, Iden, Order, Query, SqliteQueryBuilder};
use sqlx::SqlitePool;

use crate::error::GrimoireResult;
use crate::music::crud::models::{QueryParams, QueryResult, SongQueryResult};
use crate::music::crud::query::SongViewRow;

#[derive(Iden)]
enum SongQuery {
    #[iden = "song_query_view"]
    Table,
    #[iden = "album_title"]
    AlbumTitle,
    #[iden = "album_id"]
    AlbumId,
    #[iden = "album_release_date"]
    AlbumReleaseDate,
    #[iden = "album_created_at"]
    AlbumCreatedAt,
    #[iden = "album_total_duration"]
    AlbumTotalDuration,
    #[iden = "album_song_count"]
    AlbumSongCount,
    #[iden = "artist_name"]
    ArtistName,
    #[iden = "artist_total_song_count"]
    ArtistTotalSongCount,
    #[iden = "artist_total_duration"]
    ArtistTotalDuration,
    #[iden = "song_title"]
    SongTitle,
    #[iden = "song_disc_number"]
    SongDiscNumber,
    #[iden = "song_track_number"]
    SongTrackNumber,
}

pub async fn query_songs(params: QueryParams) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let pool = crate::database::connect().await?;
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query.column(sea_query::Asterisk).from(SongQuery::Table);

    // Search across multiple fields (manual escaping for now)
    if let Some(ref search_term) = params.q {
        if !search_term.trim().is_empty() {
            let safe_search = search_term.replace("'", "''");
            let condition = format!(
                "(song_title LIKE '%{}%' OR artist_name LIKE '%{}%' OR album_title LIKE '%{}%')",
                safe_search, safe_search, safe_search
            );
            query.and_where(Expr::cust(&condition));
        }
    }

    // TODO: Add more filters here
    // - User favorites: params.filters.get("favorites")
    // - User rating: params.filters.get("min_rating")
    // - Genre: params.filters.get("genre")
    // - Tags: params.filters.get("tags")
    // - Specific column search: params.search_fields

    // Dynamic primary sort order
    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };

    // Primary sort determines album grouping
    match params.sort_by.as_deref() {
        Some("title") => {
            query.order_by(SongQuery::AlbumTitle, sort_direction);
        }
        Some("year") => {
            query.order_by(SongQuery::AlbumReleaseDate, sort_direction);
            // Secondary sort by album title for consistent grouping when years match
            query.order_by(SongQuery::AlbumTitle, Order::Asc);
        }
        Some("artist") => {
            query.order_by(SongQuery::ArtistName, sort_direction);
            // Secondary sort by album to group albums by artist
            query.order_by(SongQuery::AlbumTitle, Order::Asc);
        }
        Some("created_at") => {
            query.order_by(SongQuery::AlbumCreatedAt, sort_direction);
            query.order_by(SongQuery::AlbumTitle, Order::Asc);
        }
        Some("album_duration") => {
            query.order_by(SongQuery::AlbumTotalDuration, sort_direction);
            query.order_by(SongQuery::AlbumTitle, Order::Asc);
        }
        Some("album_song_count") => {
            query.order_by(SongQuery::AlbumSongCount, sort_direction);
            query.order_by(SongQuery::AlbumTitle, Order::Asc);
        }
        Some("artist_song_count") => {
            query.order_by(SongQuery::ArtistTotalSongCount, sort_direction);
            query.order_by(SongQuery::ArtistName, Order::Asc);
            query.order_by(SongQuery::AlbumTitle, Order::Asc);
        }
        Some("artist_duration") => {
            query.order_by(SongQuery::ArtistTotalDuration, sort_direction);
            query.order_by(SongQuery::ArtistName, Order::Asc);
            query.order_by(SongQuery::AlbumTitle, Order::Asc);
        }
        Some("song_title") => {
            // When sorting by individual song, still group by album first
            query.order_by(SongQuery::AlbumTitle, Order::Asc);
            query.order_by(SongQuery::SongTitle, sort_direction);
        }
        _ => {
            // Default: newest albums first
            query.order_by(SongQuery::AlbumCreatedAt, Order::Desc);
            query.order_by(SongQuery::AlbumTitle, Order::Asc);
        }
    }

    // CRITICAL: Always preserve disc/track order within each album
    query
        .order_by(SongQuery::SongDiscNumber, Order::Asc)
        .order_by(SongQuery::SongTrackNumber, Order::Asc);

    // Simple approach: add LIMIT/OFFSET manually to avoid parameter binding complexity
    let (mut sql, _values) = query.build(SqliteQueryBuilder);
    sql = format!("{} LIMIT {} OFFSET {}", sql, limit, offset);

    let rows: Vec<SongViewRow> = sqlx::query_as(&sql).fetch_all(&pool).await?;

    let songs: Vec<SongQueryResult> = rows.into_iter().map(|r| r.to_song_query_result()).collect();
    let song_count = songs.len();

    Ok(QueryResult {
        items: songs,
        total_count: song_count as i64, // TODO: separate count query
        has_more: song_count == limit as usize,
        limit: limit as i64,
        offset: offset as i64,
        query_time_ms: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_album_grouping_order() {
        // Test that albums stay grouped together
        let mut q = Query::select();
        q.column(sea_query::Asterisk)
            .from(SongQuery::Table)
            .order_by(SongQuery::AlbumTitle, Order::Asc) // Group by album
            .order_by(SongQuery::SongDiscNumber, Order::Asc) // Then by disc
            .order_by(SongQuery::SongTrackNumber, Order::Asc); // Then by track

        let (sql, _) = q.build(SqliteQueryBuilder);

        // Verify the ORDER BY clause maintains album grouping
        assert!(sql.contains("ORDER BY"));
        assert!(sql.contains("album_title"));
        assert!(sql.contains("song_disc_number"));
        assert!(sql.contains("song_track_number"));

        println!("Album-grouped query: {}", sql);
    }

    #[test]
    fn test_artist_sort_with_album_grouping() {
        // When sorting by artist, albums should still be grouped
        let mut q = Query::select();
        q.column(sea_query::Asterisk)
            .from(SongQuery::Table)
            .order_by(SongQuery::ArtistName, Order::Asc) // Primary: artist
            .order_by(SongQuery::AlbumTitle, Order::Asc) // Secondary: album
            .order_by(SongQuery::SongDiscNumber, Order::Asc) // Tertiary: disc
            .order_by(SongQuery::SongTrackNumber, Order::Asc); // Final: track

        let (sql, _) = q.build(SqliteQueryBuilder);

        assert!(sql.contains("artist_name"));
        assert!(sql.contains("album_title"));
        assert!(sql.contains("song_disc_number"));

        println!("Artist-sorted with album grouping: {}", sql);
    }
}

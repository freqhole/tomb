//! cross-entity video queries (composing series/season/video reads that
//! don't belong to any single entity's own repository.rs)

use sea_query::{Alias, Cond, Expr, Iden, Order, Query, SqliteQueryBuilder};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use zod_gen_derive::ZodSchema;

use crate::database;
use crate::error::ErrorDetail;
use crate::music::crud::QueryParams;
use crate::query_ordering::apply_clustered_order;
use crate::response::GrimoireResponse;
use crate::video::entities::seasons::{self, VideoSeason};
use crate::video::entities::series::{self, VideoSeries};
use crate::video::entities::videos::{self, Video};

/// one season plus the videos that belong to it
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct SeasonWithVideos {
    pub season: VideoSeason,
    pub videos: Vec<Video>,
}

/// full series detail: the series itself, every season (each with its
/// videos), and any videos attached directly to the series with no season
/// (season-less docuseries episodes)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct SeriesDetail {
    pub series: VideoSeries,
    pub seasons: Vec<SeasonWithVideos>,
    pub unassigned_videos: Vec<Video>,
}

/// fetch a series along with every season (each populated with its videos)
/// and any season-less videos attached directly to the series - one call
/// instead of a series + N seasons + N video-list round trips.
pub async fn get_series_detail(series_id: &str) -> GrimoireResponse<SeriesDetail> {
    let series_response = series::get_video_series(series_id).await;
    if !series_response.success {
        return GrimoireResponse::failure(series_response.message, series_response.errors);
    }
    let series = series_response.data.expect("success response has data");

    let seasons_response = seasons::list_video_seasons(series_id).await;
    if !seasons_response.success {
        return GrimoireResponse::failure(seasons_response.message, seasons_response.errors);
    }
    let season_rows = seasons_response.data.expect("success response has data");

    let videos_response = videos::list_videos_by_series(series_id).await;
    if !videos_response.success {
        return GrimoireResponse::failure(videos_response.message, videos_response.errors);
    }
    let all_videos = videos_response.data.expect("success response has data");

    let mut seasons_with_videos = Vec::with_capacity(season_rows.len());
    for season in season_rows {
        let videos: Vec<Video> = all_videos
            .iter()
            .filter(|v| v.season_id.as_deref() == Some(season.id.as_str()))
            .cloned()
            .collect();
        seasons_with_videos.push(SeasonWithVideos { season, videos });
    }

    let unassigned_videos: Vec<Video> = all_videos
        .into_iter()
        .filter(|v| v.season_id.is_none())
        .collect();

    GrimoireResponse::success(
        "Series detail retrieved successfully",
        SeriesDetail {
            series,
            seasons: seasons_with_videos,
            unassigned_videos,
        },
    )
}

// ============================================================================
// query_video_seriez / query_videos - filtered/sorted/paginated listings,
// hand-rolled against `video_seriez`/`videoz` directly (not a sql view -
// favorites/ratings only ever apply to `videoz` rows, not series/seasons).
// ============================================================================

#[derive(Iden)]
enum VideoSeriezCol {
    #[iden = "video_seriez"]
    Table,
    #[iden = "title"]
    Title,
    #[iden = "description"]
    Description,
    #[iden = "created_at"]
    CreatedAt,
    #[iden = "deleted_at"]
    DeletedAt,
}

#[derive(Iden)]
enum VideozCol {
    #[iden = "videoz"]
    Table,
    #[iden = "series_id"]
    SeriesId,
    #[iden = "season_id"]
    SeasonId,
    #[iden = "title"]
    Title,
    #[iden = "description"]
    Description,
    #[iden = "content_type"]
    ContentType,
    #[iden = "deleted_at"]
    DeletedAt,
}

/// bind a sea_query value list onto a sqlx query in declaration order
/// (mirrors the same manual binding loop used by `query_albums`/
/// `query_artists` in `music/crud/query.rs`).
fn bind_values<'q, O>(
    mut q: sqlx::query::QueryAs<'q, sqlx::Sqlite, O, sqlx::sqlite::SqliteArguments<'q>>,
    values: sea_query::Values,
) -> sqlx::query::QueryAs<'q, sqlx::Sqlite, O, sqlx::sqlite::SqliteArguments<'q>> {
    for v in values.0 {
        match v {
            sea_query::Value::String(Some(s)) => {
                q = q.bind(s.as_ref().to_string());
            }
            sea_query::Value::BigInt(Some(i)) => {
                q = q.bind(i);
            }
            sea_query::Value::BigUnsigned(Some(i)) => {
                q = q.bind(i as i64);
            }
            _ => {}
        }
    }
    q
}

/// paginated/filtered/sorted video series listing
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SeriesQueryResult {
    pub items: Vec<VideoSeries>,
    pub total_count: i64,
    pub has_more: bool,
    pub offset: i64,
    pub limit: i64,
    pub query_time_ms: Option<u64>,
}

/// paginated/filtered/sorted video listing
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideosQueryResult {
    pub items: Vec<Video>,
    pub total_count: i64,
    pub has_more: bool,
    pub offset: i64,
    pub limit: i64,
    pub query_time_ms: Option<u64>,
}

/// query video series with search/sort/pagination
pub async fn query_video_seriez(params: QueryParams) -> GrimoireResponse<SeriesQueryResult> {
    let start_time = Instant::now();
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let apply_filters = |q: &mut sea_query::SelectStatement| {
        q.and_where(Expr::col(VideoSeriezCol::DeletedAt).is_null());
        if let Some(search) = params.q.as_ref().filter(|s| !s.trim().is_empty()) {
            let pattern = format!("%{}%", search);
            q.cond_where(
                Cond::any()
                    .add(Expr::col(VideoSeriezCol::Title).like(pattern.clone()))
                    .add(Expr::col(VideoSeriezCol::Description).like(pattern)),
            );
        }
    };

    let mut count_q = Query::select();
    count_q
        .expr(Expr::cust("COUNT(*)"))
        .from(VideoSeriezCol::Table);
    apply_filters(&mut count_q);
    let (count_sql, count_values) = count_q.build(SqliteQueryBuilder);
    let total_count = bind_values(sqlx::query_as::<_, (i64,)>(&count_sql), count_values)
        .fetch_one(&pool)
        .await
        .map(|(n,)| n)
        .unwrap_or(0);

    let mut query = Query::select();
    query
        .column(sea_query::Asterisk)
        .from(VideoSeriezCol::Table);
    apply_filters(&mut query);

    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };
    match params.sort_by.as_deref() {
        Some("title") => {
            query.order_by(VideoSeriezCol::Title, sort_direction);
        }
        _ => {
            let dir = match params.sort_direction.as_deref() {
                Some("asc") => Order::Asc,
                _ => Order::Desc,
            };
            query.order_by(VideoSeriezCol::CreatedAt, dir);
        }
    }
    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);
    let items = match bind_values(sqlx::query_as::<_, VideoSeries>(&sql), values)
        .fetch_all(&pool)
        .await
    {
        Ok(items) => items,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to query video series",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success(
        format!("Found {} video series", total_count),
        SeriesQueryResult {
            has_more: items.len() == limit as usize,
            items,
            total_count,
            limit: limit as i64,
            offset: offset as i64,
            query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        },
    )
}

/// query videos with search/sort/pagination, optionally scoped to a
/// series/season or to standalone (unattached) videos, and optionally
/// filtered by the caller's own favorites/ratings (`target_type = 'video'`).
pub async fn query_videos(
    params: QueryParams,
    series_id: Option<String>,
    season_id: Option<String>,
    unassigned: bool,
) -> GrimoireResponse<VideosQueryResult> {
    let start_time = Instant::now();
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let apply_filters = |q: &mut sea_query::SelectStatement| {
        q.and_where(Expr::col(VideozCol::DeletedAt).is_null());
        if let Some(search) = params.q.as_ref().filter(|s| !s.trim().is_empty()) {
            let pattern = format!("%{}%", search);
            q.cond_where(
                Cond::any()
                    .add(Expr::col(VideozCol::Title).like(pattern.clone()))
                    .add(Expr::col(VideozCol::Description).like(pattern)),
            );
        }
        if let Some(ref sid) = series_id {
            q.and_where(Expr::col(VideozCol::SeriesId).eq(sid.clone()));
        }
        if let Some(ref seid) = season_id {
            q.and_where(Expr::col(VideozCol::SeasonId).eq(seid.clone()));
        }
        if unassigned {
            q.and_where(Expr::col(VideozCol::SeriesId).is_null());
        }
        if params.favorites_only == Some(true) {
            if let Some(uid) = params.user_id.as_deref().filter(|s| !s.is_empty()) {
                let uid_escaped = uid.replace('\'', "''");
                q.and_where(Expr::cust(format!(
                    "EXISTS (SELECT 1 FROM user_favoritez uf WHERE uf.target_type = 'video' \
                     AND uf.target_id = videoz.id AND uf.user_id = '{uid_escaped}')"
                )));
            }
        }
        if let Some(min_rating) = params.min_rating {
            if let Some(uid) = params.user_id.as_deref().filter(|s| !s.is_empty()) {
                let uid_escaped = uid.replace('\'', "''");
                q.and_where(Expr::cust(format!(
                    "EXISTS (SELECT 1 FROM user_ratingz ur WHERE ur.target_type = 'video' \
                     AND ur.target_id = videoz.id AND ur.user_id = '{uid_escaped}' \
                     AND ur.rating >= {min_rating})"
                )));
            }
        }

        // tag filters (mirrors music's include_tags/exclude_tags in
        // grimoire/src/music/crud/query.rs, but against the generic
        // entity_tagz junction table rather than a denormalized JSON
        // column - video has no such column).
        // include_tags: show only videos that have ANY of these tags (OR logic)
        if let Some(include_tags) = params
            .filters
            .get("include_tags")
            .and_then(|v| v.as_array())
        {
            let tag_names: Vec<String> = include_tags
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.replace('\'', "''")))
                .collect();
            if !tag_names.is_empty() {
                let quoted = tag_names
                    .iter()
                    .map(|n| format!("'{n}'"))
                    .collect::<Vec<_>>()
                    .join(",");
                q.and_where(Expr::cust(format!(
                    "EXISTS (SELECT 1 FROM entity_tagz et_inc \
                     JOIN tagz t_inc ON t_inc.id = et_inc.tag_id \
                     WHERE et_inc.entity_type = 'video' AND et_inc.entity_id = videoz.id \
                     AND t_inc.deleted_at IS NULL AND t_inc.name IN ({quoted}))"
                )));
            }
        }

        // exclude_tags: show only videos that have NONE of these tags
        if let Some(exclude_tags) = params
            .filters
            .get("exclude_tags")
            .and_then(|v| v.as_array())
        {
            let tag_names: Vec<String> = exclude_tags
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.replace('\'', "''")))
                .collect();
            if !tag_names.is_empty() {
                let quoted = tag_names
                    .iter()
                    .map(|n| format!("'{n}'"))
                    .collect::<Vec<_>>()
                    .join(",");
                q.and_where(Expr::cust(format!(
                    "NOT EXISTS (SELECT 1 FROM entity_tagz et_exc \
                     JOIN tagz t_exc ON t_exc.id = et_exc.tag_id \
                     WHERE et_exc.entity_type = 'video' AND et_exc.entity_id = videoz.id \
                     AND t_exc.deleted_at IS NULL AND t_exc.name IN ({quoted}))"
                )));
            }
        }

        // content_types: show only videos whose content_type is one of these
        // ("series"/"movie"/"clip") - a simple multi-select, not include/exclude
        // like the tag filters above.
        if let Some(content_types) = params
            .filters
            .get("content_types")
            .and_then(|v| v.as_array())
        {
            let types: Vec<String> = content_types
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            if !types.is_empty() {
                q.and_where(Expr::col(VideozCol::ContentType).is_in(types));
            }
        }
    };

    let mut count_q = Query::select();
    count_q.expr(Expr::cust("COUNT(*)")).from(VideozCol::Table);
    apply_filters(&mut count_q);
    let (count_sql, count_values) = count_q.build(SqliteQueryBuilder);
    let total_count = bind_values(sqlx::query_as::<_, (i64,)>(&count_sql), count_values)
        .fetch_one(&pool)
        .await
        .map(|(n,)| n)
        .unwrap_or(0);

    let mut query = Query::select();
    query.column(sea_query::Asterisk).from(VideozCol::Table);
    query.expr_as(
        Expr::cust(
            "(SELECT COALESCE(json_group_array(json_object('blob_id', media_blob_id, 'is_primary', is_primary, 'blob_type', blob_type)), '[]') \
             FROM (SELECT media_blob_id, is_primary, blob_type FROM entity_imagez \
                   WHERE entity_type = 'video' AND entity_id = videoz.id \
                   ORDER BY is_primary DESC, created_at DESC))",
        ),
        Alias::new("images"),
    );
    query.expr_as(
        Expr::cust(
            "(SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = videoz.id)",
        ),
        Alias::new("play_count"),
    );
    apply_filters(&mut query);

    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };
    // videos always cluster by series first (a whole series stays one
    // contiguous block, ordered by whatever the chosen sort_by means at
    // the series level), then season/episode number is the fixed
    // tie-breaker within that series - mirrors query_songs' album+disc+
    // track clustering (see grimoire::query_ordering) but without that
    // function's duration/play_count/song_id exception: every sort_by
    // option here clusters, per the video domain's own grouping rule.
    let (primary_key, primary_dir) = match params.sort_by.as_deref() {
        Some("release_date") | Some("year") => (
            Expr::cust(
                "COALESCE((SELECT MIN(release_date) FROM videoz v2 \
                 WHERE v2.series_id = videoz.series_id AND v2.deleted_at IS NULL), \
                 videoz.release_date)",
            ),
            sort_direction,
        ),
        Some("duration") => (
            Expr::cust(
                "COALESCE((SELECT SUM(duration_seconds) FROM videoz v2 \
                 WHERE v2.series_id = videoz.series_id AND v2.deleted_at IS NULL), \
                 videoz.duration_seconds)",
            ),
            sort_direction,
        ),
        Some("added_at") | None => (
            Expr::cust(
                "COALESCE((SELECT MAX(created_at) FROM videoz v2 \
                 WHERE v2.series_id = videoz.series_id AND v2.deleted_at IS NULL), \
                 videoz.created_at)",
            ),
            match params.sort_direction.as_deref() {
                Some("asc") => Order::Asc,
                _ => Order::Desc,
            },
        ),
        Some("title") => (
            // the video's OWN title (not the series' metadata title) - a
            // series still clusters as one block, positioned by its
            // earliest-alphabetically episode title.
            Expr::cust(
                "COALESCE((SELECT MIN(title) FROM videoz v2 \
                 WHERE v2.series_id = videoz.series_id AND v2.deleted_at IS NULL), \
                 videoz.title)",
            ),
            sort_direction,
        ),
        // "series", "episode_number", and anything else fall back to
        // clustering alphabetically by the series' own title metadata -
        // episode_number in particular is already the intra-series
        // tie-breaker below, so it has no separate series-level meaning.
        _ => (
            Expr::cust(
                "COALESCE((SELECT title FROM video_seriez WHERE id = videoz.series_id), videoz.title)",
            ),
            sort_direction,
        ),
    };
    apply_clustered_order(
        &mut query,
        (primary_key, primary_dir),
        [
            (
                Expr::cust("(SELECT season_number FROM video_seasonz WHERE id = videoz.season_id)"),
                Order::Asc,
            ),
            (Expr::cust("videoz.episode_number"), Order::Asc),
        ],
    );
    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);
    let items = match bind_values(sqlx::query_as::<_, Video>(&sql), values)
        .fetch_all(&pool)
        .await
    {
        Ok(items) => items,
        Err(e) => {
            return GrimoireResponse::failure("Failed to query videos", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success(
        format!("Found {} video(s)", total_count),
        VideosQueryResult {
            has_more: items.len() == limit as usize,
            items,
            total_count,
            limit: limit as i64,
            offset: offset as i64,
            query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        },
    )
}

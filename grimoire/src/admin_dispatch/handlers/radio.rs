//! radio handlers — stations, filters, seed-suggest, config, supervisor, bumpers.

use crate::admin_dispatch::helpers::{decode, internal, resolve_config_path, to_value};
use crate::admin_dispatch::types::radio::{
    RadioBumper, RadioBumpersAddRequest, RadioBumpersListRequest, RadioBumpersRemoveRequest,
    RadioBumpersSetFrequencyRequest, RadioConfigPayload, RadioFiltersAddRequest,
    RadioFiltersRemoveRequest, RadioSeedSuggestRequest, RadioSeedSuggestion,
    RadioStationByStationIdRequest, RadioStationSupervisorStatus, RadioStationsByIdRequest,
    RadioSupervisorStationRequest, RadioSupervisorStatusResponse,
};
use crate::error::ErrorDetail;
use crate::radio::stations::models::{CreateStationRequest, UpdateStationRequest};
use crate::radio::stations::repository as radio_stations;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

fn ffmpeg_available() -> bool {
    crate::setup::check_dependencies().has_ffmpeg()
}

// =========================================================================
// stations
// =========================================================================

pub(in crate::admin_dispatch) async fn stations_list() -> GrimoireResponse<JsonValue> {
    match radio_stations::list_stations().await {
        Ok(stations) => to_value(GrimoireResponse::success("radio stations listed", stations)),
        Err(e) => GrimoireResponse::failure("failed to list radio stations", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn stations_get(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RadioStationsByIdRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::get_station(&req.id).await {
        Ok(Some(s)) => to_value(GrimoireResponse::success("radio station found", s)),
        Ok(None) => GrimoireResponse::failure(
            "radio station not found",
            vec![ErrorDetail::new(
                "not_found",
                "radio station not found",
                format!("no station with id {}", req.id),
            )],
        ),
        Err(e) => GrimoireResponse::failure("failed to get radio station", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn stations_create(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let mut req: CreateStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if !ffmpeg_available() {
        req.timeline_only_mode = Some(true);
    }
    match radio_stations::create_station(req).await {
        Ok(s) => {
            if crate::radio::config::effective().enabled && s.is_enabled != 0 {
                if let Err(e) = crate::radio::broadcaster::start_station(&s.id).await {
                    return GrimoireResponse::failure(
                        "radio station created but failed to start broadcaster",
                        vec![e.into()],
                    );
                }
            }
            to_value(GrimoireResponse::success("radio station created", s))
        }
        Err(e) => GrimoireResponse::failure("failed to create radio station", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn stations_update(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let mut req: UpdateStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if !ffmpeg_available() && req.timeline_only_mode == Some(false) {
        req.timeline_only_mode = Some(true);
    }
    let station_id = req.id.clone();
    let timeline_only_requested = req.timeline_only_mode;
    match radio_stations::update_station(req).await {
        Ok(s) => {
            if crate::radio::config::effective().enabled {
                if s.is_enabled != 0 {
                    if let Err(e) = crate::radio::broadcaster::start_station(&station_id).await {
                        return GrimoireResponse::failure(
                            "radio station updated but failed to start broadcaster",
                            vec![e.into()],
                        );
                    }
                } else if let Err(e) = crate::radio::broadcaster::stop_station(&station_id).await {
                    return GrimoireResponse::failure(
                        "radio station updated but failed to stop broadcaster",
                        vec![e.into()],
                    );
                }
            }

            // propagate timeline_only_mode change to the running broadcaster
            // immediately so the flag takes effect without a server restart.
            if let Some(tlo) = timeline_only_requested {
                if let Some(bc) = crate::radio::broadcaster::get_station(&station_id).await {
                    bc.set_timeline_only(tlo);
                }
            }
            to_value(GrimoireResponse::success("radio station updated", s))
        }
        Err(e) => GrimoireResponse::failure("failed to update radio station", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn stations_delete(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RadioStationsByIdRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::delete_station(&req.id).await {
        Ok(()) => {
            if let Err(e) = crate::radio::broadcaster::stop_station(&req.id).await {
                return GrimoireResponse::failure(
                    "radio station deleted but failed to stop broadcaster",
                    vec![e.into()],
                );
            }
            GrimoireResponse::success("radio station deleted", JsonValue::Null)
        }
        Err(e) => GrimoireResponse::failure("failed to delete radio station", vec![e.into()]),
    }
}

// =========================================================================
// filters
// =========================================================================

pub(in crate::admin_dispatch) async fn filters_list(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RadioStationByStationIdRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::list_filters(&req.station_id).await {
        Ok(filters) => to_value(GrimoireResponse::success("filters listed", filters)),
        Err(e) => GrimoireResponse::failure("failed to list filters", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn filters_add(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioFiltersAddRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::add_filter(
        &req.station_id,
        &req.filter_type,
        &req.filter_value,
        &req.mode,
    )
    .await
    {
        Ok(f) => to_value(GrimoireResponse::success("filter added", f)),
        Err(e) => GrimoireResponse::failure("failed to add filter", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn filters_remove(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RadioFiltersRemoveRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::remove_filter(&req.filter_id).await {
        Ok(()) => GrimoireResponse::success("filter removed", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to remove filter", vec![e.into()]),
    }
}

// =========================================================================
// seed suggest (search across tag/genre/artist/album/song/playlist)
// =========================================================================

pub(in crate::admin_dispatch) async fn seed_suggest(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    use crate::music::crud::{query_albums, query_artists, search_songs, QueryParams};
    use crate::music::entities::tags::query_tags;

    let req: RadioSeedSuggestRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let limit = req.limit.unwrap_or(15).min(50);
    let q = req.query.trim().to_string();

    let suggestions: Vec<RadioSeedSuggestion> = match req.kind.as_str() {
        "tag" => {
            let resp = query_tags(&q).await;
            resp.data
                .unwrap_or_default()
                .into_iter()
                .take(limit as usize)
                .map(|t| RadioSeedSuggestion {
                    id: t.id,
                    name: t.name,
                    subtitle: None,
                })
                .collect()
        }
        // "taxon" returns matches across every taxon kind unless the
        // caller scopes it via `kind_slug`. "genre" is kept as a
        // backward-compatible shortcut for `kind="taxon", kind_slug="genre"`.
        "taxon" | "genre" => {
            use crate::music::entities::taxonomy::{query_taxons, QueryTaxonsRequest};
            let kind_slug = if req.kind == "genre" {
                Some("genre".to_string())
            } else {
                req.kind_slug.clone()
            };
            let taxon_req = QueryTaxonsRequest {
                kind_slug,
                q: if q.is_empty() { None } else { Some(q.clone()) },
                limit: Some(limit),
                offset: Some(0),
            };
            let resp = query_taxons(taxon_req).await;
            resp.data
                .map(|r| r.items)
                .unwrap_or_default()
                .into_iter()
                .take(limit as usize)
                .map(|t| RadioSeedSuggestion {
                    id: t.id,
                    name: t.label,
                    subtitle: Some(t.kind_slug),
                })
                .collect()
        }
        "artist" => {
            let params = QueryParams {
                q: if q.is_empty() { None } else { Some(q.clone()) },
                search_fields: None,
                filters: std::collections::HashMap::new(),
                sort_by: Some("name".to_string()),
                sort_direction: Some("asc".to_string()),
                limit: Some(limit),
                offset: Some(0),
                user_id: None,
                favorites_only: None,
                min_rating: None,
                mb_lookup_status: None,
            };
            let resp = query_artists(params).await;
            resp.data
                .map(|qr| qr.items)
                .unwrap_or_default()
                .into_iter()
                .map(|r| RadioSeedSuggestion {
                    id: r.artist.id,
                    name: r.artist.name,
                    subtitle: None,
                })
                .collect()
        }
        "album" => {
            let params = QueryParams {
                q: if q.is_empty() { None } else { Some(q.clone()) },
                search_fields: None,
                filters: std::collections::HashMap::new(),
                sort_by: Some("title".to_string()),
                sort_direction: Some("asc".to_string()),
                limit: Some(limit),
                offset: Some(0),
                user_id: None,
                favorites_only: None,
                min_rating: None,
                mb_lookup_status: None,
            };
            let resp = query_albums(params).await;
            resp.data
                .map(|qr| qr.items)
                .unwrap_or_default()
                .into_iter()
                .map(|r| RadioSeedSuggestion {
                    id: r.album.id,
                    name: r.album.title,
                    subtitle: r.artist.map(|a| a.name),
                })
                .collect()
        }
        "song" => {
            if q.is_empty() {
                Vec::new()
            } else {
                let resp = search_songs(&q, Some(limit), Some(0)).await;
                resp.data
                    .map(|qr| qr.items)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| {
                        let artist_name = r
                            .artist
                            .as_ref()
                            .map(|a| a.name.clone())
                            .unwrap_or_default();
                        let album_name = r.album.as_ref().map(|a| a.title.clone());
                        let label = if artist_name.is_empty() {
                            r.song.title.clone()
                        } else {
                            format!("{} — {}", r.song.title, artist_name)
                        };
                        RadioSeedSuggestion {
                            id: r.song.id,
                            name: label,
                            subtitle: album_name,
                        }
                    })
                    .collect()
            }
        }
        "playlist" => {
            // playlists don't have a dedicated search endpoint yet, so
            // do a case-insensitive substring filter on the full list.
            // empty query returns the most-recently-created playlists.
            let resp = crate::music::list_playlists().await;
            let needle = q.to_ascii_lowercase();
            resp.data
                .unwrap_or_default()
                .into_iter()
                .filter(|p| {
                    if needle.is_empty() {
                        true
                    } else {
                        p.title.to_ascii_lowercase().contains(&needle)
                    }
                })
                .take(limit as usize)
                .map(|p| RadioSeedSuggestion {
                    id: p.id,
                    name: p.title,
                    subtitle: p.description,
                })
                .collect()
        }
        other => {
            return GrimoireResponse::failure(
                format!("unknown seed-suggest kind: {}", other),
                vec![],
            );
        }
    };

    to_value(GrimoireResponse::success("suggestions", suggestions))
}

// =========================================================================
// config
// =========================================================================

pub(in crate::admin_dispatch) async fn config_get() -> GrimoireResponse<JsonValue> {
    let cfg = crate::radio::config::effective();
    let payload = RadioConfigPayload {
        enabled: cfg.enabled,
        encode_args: cfg.encode_args,
        ffmpeg_available: ffmpeg_available(),
    };
    to_value(GrimoireResponse::success("ok", payload))
}

pub(in crate::admin_dispatch) async fn config_set(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioConfigPayload = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return internal(format!("could not locate config file: {}", e)),
    };
    let toml_str = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => return internal(format!("failed to read config file: {}", e)),
    };
    // parse to a generic toml::Value table so we can swap just the
    // [radio] section without touching any other keys.
    let mut doc: toml::Value = match toml::from_str(&toml_str) {
        Ok(v) => v,
        Err(e) => return internal(format!("config file is not valid toml: {}", e)),
    };
    let table = match doc.as_table_mut() {
        Some(t) => t,
        None => return internal("config root is not a table".to_string()),
    };
    let radio_table = toml::Value::Table({
        let mut m = toml::map::Map::new();
        m.insert("enabled".into(), toml::Value::Boolean(req.enabled));
        m.insert(
            "encode_args".into(),
            toml::Value::String(req.encode_args.clone()),
        );
        m
    });
    table.insert("radio".into(), radio_table);
    let new_toml = match toml::to_string_pretty(&doc) {
        Ok(s) => s,
        Err(e) => return internal(format!("failed to serialize config: {}", e)),
    };
    // validate full document still parses as a `GrimoireConfig`.
    if let Err(e) = toml::from_str::<crate::config::GrimoireConfig>(&new_toml) {
        return crate::admin_dispatch::helpers::bad_request(format!(
            "invalid resulting config: {}",
            e
        ));
    }
    if let Err(e) = std::fs::write(&path, new_toml.as_bytes()) {
        return internal(format!("failed to write config: {}", e));
    }
    if let Err(e) = crate::config::init_config(Some(path.clone())) {
        return internal(format!("config written but reload failed: {}", e));
    }
    let cfg = crate::radio::config::effective();
    // act on the new effective state. flipping the master switch on
    // spawns broadcasters for every enabled station; flipping it off
    // tears them all down. note: the iroh router's RADIO_ALPN handler
    // is wired during `init_p2p_client` (app startup) — without an app
    // restart, broadcasters are running but unreachable from peers
    // unless radio was already enabled at startup.
    if cfg.enabled {
        if let Err(e) = crate::radio::broadcaster::init_registry().await {
            return internal(format!(
                "config saved but broadcasters failed to start: {}",
                e
            ));
        }
    } else if let Err(e) = crate::radio::broadcaster::stop_all().await {
        return internal(format!(
            "config saved but broadcasters failed to stop: {}",
            e
        ));
    }
    let out = RadioConfigPayload {
        enabled: cfg.enabled,
        encode_args: cfg.encode_args,
        ffmpeg_available: ffmpeg_available(),
    };
    to_value(GrimoireResponse::success("config updated", out))
}

// =========================================================================
// supervisor (start/stop/restart broadcasters)
// =========================================================================

async fn build_supervisor_status() -> GrimoireResponse<JsonValue> {
    let stations = match crate::radio::stations::list_stations().await {
        Ok(v) => v,
        Err(e) => return GrimoireResponse::failure("failed to list stations", vec![e.into()]),
    };
    let default_id = crate::radio::broadcaster::current_default_station_id().await;
    let mut rows: Vec<RadioStationSupervisorStatus> = Vec::with_capacity(stations.len());
    for st in stations {
        let bc = crate::radio::broadcaster::get_station(&st.id).await;
        let (is_running, listener_count, current_seq, np) = if let Some(bc) = bc {
            let np = bc.now_playing().await;
            (true, bc.listener_count(), bc.current_seq(), Some(np))
        } else {
            (false, 0u32, 0u32, None)
        };
        let (current_song_id, current_title) = match np {
            Some(np) => {
                let song_id = if np.song_id.is_empty() {
                    None
                } else {
                    Some(np.song_id.clone())
                };
                let title = if np.title.is_empty() {
                    None
                } else {
                    Some(np.title.clone())
                };
                (song_id, title)
            }
            None => (None, None),
        };
        rows.push(RadioStationSupervisorStatus {
            station_id: st.id.clone(),
            name: st.name,
            is_enabled: st.is_enabled != 0,
            is_running,
            listener_count,
            current_seq,
            current_song_id,
            current_title,
            is_default: default_id.as_deref() == Some(st.id.as_str()),
        });
    }
    let payload = RadioSupervisorStatusResponse {
        radio_enabled: crate::radio::config::effective().enabled,
        stations: rows,
    };
    to_value(GrimoireResponse::success("ok", payload))
}

pub(in crate::admin_dispatch) async fn supervisor_status() -> GrimoireResponse<JsonValue> {
    build_supervisor_status().await
}

pub(in crate::admin_dispatch) async fn supervisor_start(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RadioSupervisorStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if let Err(e) = crate::radio::broadcaster::start_station(&req.station_id).await {
        return GrimoireResponse::failure("failed to start station", vec![e.into()]);
    }
    build_supervisor_status().await
}

pub(in crate::admin_dispatch) async fn supervisor_stop(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RadioSupervisorStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if let Err(e) = crate::radio::broadcaster::stop_station(&req.station_id).await {
        return GrimoireResponse::failure("failed to stop station", vec![e.into()]);
    }
    build_supervisor_status().await
}

pub(in crate::admin_dispatch) async fn supervisor_restart(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RadioSupervisorStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if let Err(e) = crate::radio::broadcaster::restart_station(&req.station_id).await {
        return GrimoireResponse::failure("failed to restart station", vec![e.into()]);
    }
    build_supervisor_status().await
}

pub(in crate::admin_dispatch) async fn supervisor_skip_track(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RadioSupervisorStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if let Err(e) = crate::radio::broadcaster::skip_station_track(&req.station_id).await {
        return GrimoireResponse::failure("failed to skip current track", vec![e.into()]);
    }
    build_supervisor_status().await
}

// =========================================================================
// bumpers
// =========================================================================

fn bumper_to_payload(b: crate::radio::bumpers::Bumper) -> RadioBumper {
    RadioBumper {
        id: b.id,
        station_id: b.station_id,
        song_id: b.song_id,
        label: b.label,
        weight: b.weight,
        created_at: b.created_at,
    }
}

pub(in crate::admin_dispatch) async fn bumpers_list(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RadioBumpersListRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match crate::radio::bumpers::list_bumpers(&req.station_id).await {
        Ok(rows) => {
            let payload: Vec<RadioBumper> = rows.into_iter().map(bumper_to_payload).collect();
            to_value(GrimoireResponse::success("bumpers listed", payload))
        }
        Err(e) => GrimoireResponse::failure("failed to list bumpers", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn bumpers_add(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioBumpersAddRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let weight = req.weight.unwrap_or(1);
    match crate::radio::bumpers::add_bumper(&req.station_id, &req.song_id, &req.label, Some(weight))
        .await
    {
        Ok(b) => {
            let payload = bumper_to_payload(b);
            to_value(GrimoireResponse::success("bumper added", payload))
        }
        Err(e) => GrimoireResponse::failure("failed to add bumper", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn bumpers_remove(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RadioBumpersRemoveRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match crate::radio::bumpers::remove_bumper(&req.bumper_id).await {
        Ok(()) => GrimoireResponse::success("bumper removed", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to remove bumper", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn bumpers_set_frequency(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RadioBumpersSetFrequencyRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match crate::radio::bumpers::set_frequency(&req.station_id, req.frequency_seconds).await {
        Ok(()) => GrimoireResponse::success("frequency updated", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to set bumper frequency", vec![e.into()]),
    }
}

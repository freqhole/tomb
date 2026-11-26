//! album sync: receive an album shell with metadata + cover images.

use serde_json::Value as JsonValue;

use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;

use super::images::{resolve_sync_image_ref, sync_artist_images};
use super::models::{SyncAlbumRequest, SyncAlbumResponse};

/// sync an album shell to local grimoire storage.
///
/// path: POST /api/sync/album
pub async fn sync_album(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::music::crud::create_or_update::{
        find_or_create_album_for_artist, find_or_create_artist,
    };
    use crate::music::crud::{AlbumImportRequest, ArtistImportRequest};
    use crate::music::entities::albums::transfer::{
        merge_transferred_metadata, TransferredAlbumMetadata,
    };

    let req: SyncAlbumRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("sync_album: bad request from {}: {}", caller.username, e);
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            );
        }
    };

    if let Err(e) = crate::music::entities::albums::metadata::merge_transfer(
        None,
        req.metadata.as_deref(),
        req.mb_release_id.as_deref(),
        req.mb_release_group_id.as_deref(),
    ) {
        return GrimoireResponse::failure(
            "invalid album metadata",
            vec![ErrorDetail::new(
                "bad_request",
                "bad request",
                e.to_string(),
            )],
        );
    }

    tracing::info!(
        "sync_album: START from {} -- title=\"{}\" artist=\"{}\" remote_album_id={} expected_songs={} images={}",
        caller.username,
        req.title,
        req.artist_name,
        req.remote_album_id,
        req.expected_song_blake3s.len(),
        req.images.len(),
    );

    // 1. resolve / create the album artist by name (case-insensitive)
    let artist_resp = find_or_create_artist(ArtistImportRequest {
        name: req.artist_name.clone(),
        created_by: Some(caller.user_id.clone()),
    })
    .await;
    if !artist_resp.success {
        return GrimoireResponse::failure("failed to resolve artist", artist_resp.errors);
    }
    let (artist, _artist_was_new) = match artist_resp.data {
        Some(d) => d,
        None => {
            return GrimoireResponse::failure(
                "artist resolve returned no data",
                vec![ErrorDetail::new(
                    "internal_error",
                    "artist resolve",
                    "no artist returned",
                )],
            )
        }
    };

    // 2. dedupe / create album by (artist_id, lower(title)).
    //    find_or_create_album_for_artist upgrades generic album types only.
    let album_req = AlbumImportRequest {
        title: req.title.clone(),
        album_type: req.album_type.clone(),
        release_date: None,
        label: None,
        genre_ids: None,
        created_by: Some(caller.user_id.clone()),
    };
    let (album, was_created) = match find_or_create_album_for_artist(album_req, &artist.id).await {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure("failed to find or create album", vec![e.into()])
        }
    };
    let existing = !was_created;

    // 3. merge the complete metadata envelope even when songs created a shell
    // previously. source-local taxon/url ids must never cross this boundary.
    let metadata_result = merge_transferred_metadata(
        &album.id,
        TransferredAlbumMetadata {
            taxons: &req.taxons,
            genres: &req.genres,
            release_date: req.release_date.as_deref(),
            label: req.label.as_deref(),
            urls: &req.urls,
            entity_urls: &req.entity_urls,
            metadata: req.metadata.as_deref(),
            mb_release_id: req.mb_release_id.as_deref(),
            mb_release_group_id: req.mb_release_group_id.as_deref(),
        },
    )
    .await;
    if !metadata_result.success {
        return metadata_result.map(|_| JsonValue::Null);
    }

    // 4. import album cover images. each ref carries a blake3 hash - pulled
    //    from source_node_id if not already local. missing/unpullable
    //    images are skipped, not fatal.
    let mut images_linked: i64 = 0;
    let mut missing_image_blake3s: Vec<String> = Vec::new();
    let source_node_id = req.source_node_id.as_deref().unwrap_or("");
    for (idx, img) in req.images.iter().enumerate() {
        let blob_id_opt = match resolve_sync_image_ref(
            img,
            source_node_id,
            &format!("album-{}-{}", album.id, idx),
            None,
        )
        .await
        {
            Ok(Some(id)) => Some(id),
            Ok(None) => {
                missing_image_blake3s.push(img.blake3.clone());
                None
            }
            Err(e) => {
                tracing::warn!(
                    "sync_album: failed to import image {} for album {}: {}",
                    img.blake3,
                    album.id,
                    e
                );
                missing_image_blake3s.push(img.blake3.clone());
                None
            }
        };
        if let Some(blob_id) = blob_id_opt {
            let is_primary = img.is_primary || idx == 0;
            let add_result = crate::music::entities::albums::add_album_image(
                &album.id, &blob_id, is_primary, None,
            )
            .await;
            if add_result.success {
                images_linked += 1;
            } else {
                tracing::warn!(
                    "sync_album: failed to add image {} to album {}: {}",
                    blob_id,
                    album.id,
                    add_result.message
                );
                missing_image_blake3s.push(img.blake3.clone());
            }
        }
    }

    let (artist_images_linked, artist_images_missing) =
        sync_artist_images(&artist.id, &req.artist_images, source_node_id).await;
    images_linked += artist_images_linked;
    missing_image_blake3s.extend(artist_images_missing);

    // 5. attach tags (provenance + caller-supplied). idempotent.
    let mut tag_names: Vec<String> = Vec::with_capacity(1 + req.tags.len());
    tag_names.push(req.remote_name.clone());
    tag_names.extend(req.tags.iter().cloned());
    let tag_names: Vec<String> = tag_names
        .into_iter()
        .filter(|n| !n.trim().is_empty())
        .collect();
    if !tag_names.is_empty() {
        let tag_result = crate::music::entities::tags::add_albums_tags(
            crate::music::entities::tags::AddAlbumsTagsRequest {
                album_ids: vec![album.id.clone()],
                tag_ids: vec![],
                tag_names,
            },
        )
        .await;
        if !tag_result.success {
            tracing::warn!(
                "sync_album: failed to add tags to album {}: {}",
                album.id,
                tag_result.message
            );
        }
    }

    let response = SyncAlbumResponse {
        album_id: album.id.clone(),
        artist_id: artist.id.clone(),
        existing,
        images_linked,
        missing_image_blake3s: missing_image_blake3s.clone(),
    };

    tracing::info!(
        "sync_album: OK for {} title=\"{}\" album_id={} artist_id={} existing={} images_linked={} missing_images={}",
        caller.username,
        req.title,
        album.id,
        artist.id,
        existing,
        images_linked,
        missing_image_blake3s.len(),
    );

    GrimoireResponse::success(
        if existing {
            "album already existed"
        } else {
            "album synced successfully"
        },
        serde_json::to_value(response).unwrap_or_default(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // uses the real database singleton; run this alone with --ignored --exact.
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singleton"]
    async fn sync_album_preserves_metadata_and_all_taxons_on_create_and_retry() {
        let fixture = tempfile::Builder::new()
            .prefix(".album-transfer-test-")
            .tempdir_in(".")
            .expect("fixture directory");
        let data_dir = fixture.path().canonicalize().unwrap();
        let config_path = data_dir.join("freqhole-config.toml");
        std::fs::write(
            &config_path,
            format!(
                "data_dir = {:?}\n[database]\nfilename = \"grimoire.db\"\n[musicbrainz]\nenabled = false\n",
                data_dir.to_str().unwrap()
            ),
        )
        .unwrap();
        std::fs::write(data_dir.join("grimoire.db"), b"").unwrap();
        crate::config::init_config(Some(config_path)).unwrap();
        crate::database::run_migrations().await.unwrap();
        let pool = crate::database::connect().await.unwrap();
        sqlx::query(
            "INSERT INTO user_accountz (id, username, role) VALUES ('sender', 'sender', 'root')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let caller = Caller::new("sender", "sender", crate::users::UserRole::Root);
        let body = json!({
            "remote_album_id": "source-album",
            "title": "a transferred album",
            "artist_name": "a transferred artist",
            "remote_name": "source",
            "release_date": "2024",
            "label": "projection must not replace full labels",
            "genres": ["ambient"],
            "taxons": [
                {"id": "source-date", "kind_slug": "release_date", "label": "2024-06-15"},
                {"id": "source-label-1", "kind_slug": "label", "label": "first label"},
                {"id": "source-label-2", "kind_slug": "label", "label": "second label"},
                {"id": "source-mood", "kind_slug": "mood", "label": "dreamy"},
                {"id": "source-custom", "kind_slug": "custom-transfer-kind", "label": "custom value"}
            ],
            "metadata": r#"{"musicbrainz":{"release_id":"release"},"future_field":{"nested":[1,2]}}"#,
            "mb_release_group_id": "release-group",
            "entity_urls": [{"id":"source-url","name":"bandcamp","url":"https://example.com/album"}],
            "urls": ["https://example.com/album"]
        });
        let created = sync_album(&caller, body.clone()).await;
        assert!(created.success, "{}: {:?}", created.message, created.errors);
        let result = created.data.unwrap();
        assert_eq!(result["existing"], false);
        let album_id = result["album_id"].as_str().unwrap();
        let read_taxons = || {
            sqlx::query_as::<_, (String, String, String)>(
                "SELECT t.id, k.slug, t.label FROM album_taxonz a
                 JOIN taxonz t ON t.id = a.taxon_id JOIN taxon_kindz k ON k.id = t.kind_id
                 WHERE a.album_id = ? ORDER BY k.slug, t.label",
            )
            .bind(album_id)
            .fetch_all(&pool)
        };
        let before = read_taxons().await.unwrap();
        assert_eq!(before.len(), 6);
        assert!(before.iter().all(|(id, _, _)| !id.starts_with("source-")));
        assert!(before
            .iter()
            .any(|(_, kind, label)| kind == "release_date" && label == "2024-06-15"));
        assert_eq!(
            before.iter().filter(|(_, kind, _)| kind == "label").count(),
            2
        );
        sqlx::query("UPDATE albumz SET metadata = json_set(metadata, '$.destination_only', 42) WHERE id = ?")
            .bind(album_id)
            .execute(&pool)
            .await
            .unwrap();
        let retried = sync_album(&caller, body).await;
        assert!(retried.success, "{}: {:?}", retried.message, retried.errors);
        assert_eq!(retried.data.unwrap()["album_id"], album_id);
        assert_eq!(read_taxons().await.unwrap(), before);
        let metadata: String = sqlx::query_scalar("SELECT metadata FROM albumz WHERE id = ?")
            .bind(album_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let metadata: JsonValue = serde_json::from_str(&metadata).unwrap();
        assert_eq!(metadata["future_field"]["nested"], json!([1, 2]));
        assert_eq!(metadata["musicbrainz"]["release_id"], "release");
        assert_eq!(metadata["musicbrainz"]["release_group_id"], "release-group");
        assert_eq!(metadata["destination_only"], 42);
        let urls: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT url, name FROM entity_urlz WHERE entity_type = 'album' AND entity_id = ?",
        )
        .bind(album_id)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            urls,
            vec![("https://example.com/album".into(), Some("bandcamp".into()))]
        );
        let legacy = json!({
            "remote_album_id": "source-album", "title": "a transferred album",
            "artist_name": "a transferred artist", "remote_name": "source",
            "release_date": "2025", "label": "legacy label", "genres": ["jazz"]
        });
        assert!(sync_album(&caller, legacy).await.success);
        let after = read_taxons().await.unwrap();
        assert_eq!(after.len(), before.len() + 3);
        assert!(before.iter().all(|taxon| after.contains(taxon)));
    }
}

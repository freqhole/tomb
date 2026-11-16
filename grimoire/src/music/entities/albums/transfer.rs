//! additive album metadata import for send-to-remote.

use crate::database;
use crate::error::{ErrorDetail, GrimoireResult};
use crate::music::entities::taxonomy::{self, AddAlbumTaxonRequest, TaxonRef};
use crate::music::EntityUrl;
use crate::GrimoireResponse;

pub struct TransferredAlbumMetadata<'a> {
    pub taxons: &'a [TaxonRef],
    pub genres: &'a [String],
    pub release_date: Option<&'a str>,
    pub label: Option<&'a str>,
    pub urls: &'a [String],
    pub entity_urls: &'a [EntityUrl],
    pub metadata: Option<&'a str>,
    pub mb_release_id: Option<&'a str>,
    pub mb_release_group_id: Option<&'a str>,
}

/// resolve source references locally and add them to new or reused albums.
/// omissions never remove destination-only taxons, urls, or metadata.
pub async fn merge_transferred_metadata(
    album_id: &str,
    req: TransferredAlbumMetadata<'_>,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(pool) => pool,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };
    let mut taxons: Vec<(&str, &str)> = req
        .taxons
        .iter()
        .map(|taxon| (taxon.kind_slug.trim(), taxon.label.trim()))
        .filter(|(kind, label)| !kind.is_empty() && !label.is_empty())
        .collect();
    taxons.extend(req.genres.iter().map(|genre| ("genre", genre.as_str())));
    // compatibility projections must not replace the complete taxon set.
    for (kind, label) in [
        (taxonomy::KIND_RELEASE_DATE, req.release_date),
        (taxonomy::KIND_LABEL, req.label),
    ] {
        if !taxons.iter().any(|(slug, _)| *slug == kind) {
            if let Some(label) = label {
                taxons.push((kind, label));
            }
        }
    }
    for (kind, label) in taxons {
        if kind.trim().is_empty() || label.trim().is_empty() {
            continue;
        }
        let kind_result = taxonomy::find_or_create_taxon_kind(kind, kind).await;
        if !kind_result.success {
            return GrimoireResponse::failure("failed to resolve taxon kind", kind_result.errors);
        }
        let result = taxonomy::find_or_create_taxon(kind, label).await;
        let taxon = match result.data {
            Some(taxon) => taxon,
            None => return GrimoireResponse::failure("failed to resolve taxon", result.errors),
        };
        let result = taxonomy::add_album_taxon(AddAlbumTaxonRequest {
            album_id: album_id.to_string(),
            taxon_id: taxon.id,
            origin: "user".to_string(),
            confidence: None,
        })
        .await;
        if !result.success {
            return result;
        }
    }

    let result: GrimoireResult<()> = async {
        let mut tx = pool.begin().await?;
        let raw: Option<String> = sqlx::query_scalar("SELECT metadata FROM albumz WHERE id = ?")
            .bind(album_id)
            .fetch_one(&mut *tx)
            .await?;
        let merged = super::metadata::merge_transfer(
            raw.as_deref(),
            req.metadata,
            req.mb_release_id,
            req.mb_release_group_id,
        )
        .map_err(|e| crate::error::GrimoireError::InvalidFormat {
            reason: format!("invalid transferred album metadata: {e}"),
        })?;
        if let Some(merged) = merged {
            sqlx::query("UPDATE albumz SET metadata = ?, updated_at = unixepoch() WHERE id = ?")
                .bind(merged)
                .bind(album_id)
                .execute(&mut *tx)
                .await?;
        }
        for (url, name) in req
            .entity_urls
            .iter()
            .map(|url| (url.url.as_str(), url.name.as_deref()))
            .chain(req.urls.iter().map(|url| (url.as_str(), None)))
        {
            if url.trim().is_empty() {
                continue;
            }
            sqlx::query(
                "INSERT INTO entity_urlz (entity_type, entity_id, name, url)
                 SELECT 'album', ?, ?, ?
                 WHERE NOT EXISTS (
                     SELECT 1 FROM entity_urlz
                     WHERE entity_type = 'album' AND entity_id = ? AND url = ?
                 )",
            )
            .bind(album_id)
            .bind(name)
            .bind(url)
            .bind(album_id)
            .bind(url)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }
    .await;
    match result {
        Ok(()) => GrimoireResponse::success("album metadata synced", ()),
        Err(e) => {
            GrimoireResponse::failure("failed to sync album metadata", vec![ErrorDetail::from(e)])
        }
    }
}

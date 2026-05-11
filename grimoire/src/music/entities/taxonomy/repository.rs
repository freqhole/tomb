//! taxonomy repository.
//!
//! all writes that create taxonomy rows accept an optional
//! `created_by` caller id; reads ignore caller. cycle prevention for
//! `taxon_parentz` is enforced here via a recursive cte before
//! insert (sqlite has no native cycle check).

use super::models::{
    AddAlbumTaxonRequest, AddTaxonParentRequest, AlbumTaxonLink, CreateTaxonKindRequest,
    CreateTaxonRequest, GetTaxonRequest, QueryScalarRangeRequest, QueryTaxonsRequest,
    RemoveAlbumTaxonRequest, RemoveTaxonParentRequest, ScalarAttribute, ScalarValueType,
    SetAlbumTaxonsRequest, SetScalarAttributeRequest, Taxon, TaxonKind, TaxonRef, TaxonWithStats,
    TaxonsQueryResult,
};
use crate::database;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;

/// normalize a free-form label to a taxon slug.
///
/// lowercase, replace runs of non-alphanumerics with `-`, trim
/// leading/trailing dashes. empty strings become `"untitled"`.
pub fn slugify_taxon_label(label: &str) -> String {
    let mut out = String::with_capacity(label.len());
    let mut last_dash = true;
    for ch in label.chars() {
        if ch.is_ascii_alphanumeric() {
            for c in ch.to_lowercase() {
                out.push(c);
            }
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "untitled".to_string()
    } else {
        out
    }
}

// ---- kinds ----

/// list all (non-deleted) taxon kinds, ordered by `display_order` then label.
pub async fn list_taxon_kinds() -> GrimoireResponse<Vec<TaxonKind>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let rows = match sqlx::query!(
        r#"SELECT
            id              as "id!",
            slug            as "slug!",
            label           as "label!",
            description,
            color,
            value_type      as "value_type!",
            unit,
            display_order   as "display_order!",
            is_user_defined as "is_user_defined!: bool",
            created_at      as "created_at!"
           FROM taxon_kindz
           WHERE deleted_at IS NULL
           ORDER BY display_order ASC, label ASC"#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to list taxon kinds",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let kinds = rows
        .into_iter()
        .map(|r| TaxonKind {
            id: r.id,
            slug: r.slug,
            label: r.label,
            description: r.description,
            color: r.color,
            value_type: r.value_type,
            unit: r.unit,
            display_order: r.display_order,
            is_user_defined: r.is_user_defined,
            created_at: r.created_at,
        })
        .collect();

    GrimoireResponse::success("taxon kinds retrieved", kinds)
}

/// create a user-defined taxon kind.
pub async fn create_taxon_kind(req: CreateTaxonKindRequest) -> GrimoireResponse<TaxonKind> {
    let slug = req.slug.trim().to_string();
    if slug.is_empty() {
        return GrimoireResponse::failure("kind slug is required", vec![]);
    }
    let label = req.label.trim().to_string();
    if label.is_empty() {
        return GrimoireResponse::failure("kind label is required", vec![]);
    }
    let value_type = req
        .value_type
        .clone()
        .unwrap_or_else(|| ScalarValueType::Categorical.as_str().to_string());
    if ScalarValueType::from_str(&value_type).is_none() {
        return GrimoireResponse::failure(
            "value_type must be one of: categorical, scalar_f64, scalar_int",
            vec![],
        );
    }
    let display_order = req.display_order.unwrap_or(100);

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let row = match sqlx::query!(
        r#"INSERT INTO taxon_kindz
              (slug, label, description, color, value_type, unit, display_order, is_user_defined)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            RETURNING
              id              as "id!",
              slug            as "slug!",
              label           as "label!",
              description,
              color,
              value_type      as "value_type!",
              unit,
              display_order   as "display_order!",
              is_user_defined as "is_user_defined!: bool",
              created_at      as "created_at!""#,
        slug,
        label,
        req.description,
        req.color,
        value_type,
        req.unit,
        display_order,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to create taxon kind",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    GrimoireResponse::success(
        "taxon kind created",
        TaxonKind {
            id: row.id,
            slug: row.slug,
            label: row.label,
            description: row.description,
            color: row.color,
            value_type: row.value_type,
            unit: row.unit,
            display_order: row.display_order,
            is_user_defined: row.is_user_defined,
            created_at: row.created_at,
        },
    )
}

// ---- taxons ----

async fn lookup_kind_id(
    pool: &sqlx::SqlitePool,
    kind_slug: &str,
) -> Result<String, GrimoireResponse<()>> {
    match sqlx::query!(
        r#"SELECT id as "id!" FROM taxon_kindz WHERE slug = ? AND deleted_at IS NULL"#,
        kind_slug
    )
    .fetch_optional(pool)
    .await
    {
        Ok(Some(r)) => Ok(r.id),
        Ok(None) => Err(GrimoireResponse::failure("unknown taxon kind", vec![])),
        Err(e) => Err(GrimoireResponse::failure(
            "failed to look up taxon kind",
            vec![ErrorDetail::from(e)],
        )),
    }
}

/// look up an existing taxon by `(kind, label)` or insert one. label
/// is normalized via `slugify_taxon_label` to derive `slug`.
pub async fn find_or_create_taxon(kind_slug: &str, label: &str) -> GrimoireResponse<Taxon> {
    let label = label.trim().to_string();
    if label.is_empty() {
        return GrimoireResponse::failure("taxon label is required", vec![]);
    }
    let slug = slugify_taxon_label(&label);

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let kind_id = match lookup_kind_id(&pool, kind_slug).await {
        Ok(id) => id,
        Err(resp) => return resp.map(|_| unreachable!()),
    };

    if let Ok(Some(row)) = sqlx::query!(
        r#"SELECT
            id              as "id!",
            kind_id         as "kind_id!",
            slug            as "slug!",
            label           as "label!",
            description,
            is_user_defined as "is_user_defined!: bool",
            created_at      as "created_at!",
            created_by
           FROM taxonz
           WHERE kind_id = ? AND slug = ? AND deleted_at IS NULL"#,
        kind_id,
        slug,
    )
    .fetch_optional(&pool)
    .await
    {
        let kind_slug_owned = kind_slug.to_string();
        return GrimoireResponse::success(
            "taxon found",
            Taxon {
                id: row.id,
                kind_id: row.kind_id,
                kind_slug: kind_slug_owned,
                slug: row.slug,
                label: row.label,
                description: row.description,
                is_user_defined: row.is_user_defined,
                created_at: row.created_at,
                created_by: row.created_by,
            },
        );
    }

    let row = match sqlx::query!(
        r#"INSERT INTO taxonz (kind_id, slug, label, is_user_defined)
           VALUES (?, ?, ?, 1)
           RETURNING
             id              as "id!",
             kind_id         as "kind_id!",
             slug            as "slug!",
             label           as "label!",
             description,
             is_user_defined as "is_user_defined!: bool",
             created_at      as "created_at!",
             created_by"#,
        kind_id,
        slug,
        label,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("failed to create taxon", vec![ErrorDetail::from(e)]);
        }
    };

    GrimoireResponse::success(
        "taxon created",
        Taxon {
            id: row.id,
            kind_id: row.kind_id,
            kind_slug: kind_slug.to_string(),
            slug: row.slug,
            label: row.label,
            description: row.description,
            is_user_defined: row.is_user_defined,
            created_at: row.created_at,
            created_by: row.created_by,
        },
    )
}

/// create a new taxon; optionally link initial parents.
pub async fn create_taxon(req: CreateTaxonRequest) -> GrimoireResponse<Taxon> {
    let resp = find_or_create_taxon(&req.kind_slug, &req.label).await;
    let Some(taxon) = resp.data.clone() else {
        return resp;
    };
    if let Some(parents) = req.parent_ids {
        for parent_id in parents {
            let r = add_taxon_parent(AddTaxonParentRequest {
                child_id: taxon.id.clone(),
                parent_id,
            })
            .await;
            if !r.success {
                return GrimoireResponse::failure(&r.message, r.errors);
            }
        }
    }
    GrimoireResponse::success("taxon created", taxon)
}

/// fetch a single taxon by id (joined to its kind for `kind_slug`).
pub async fn get_taxon(req: GetTaxonRequest) -> GrimoireResponse<Taxon> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let row = match sqlx::query!(
        r#"SELECT
            t.id              as "id!",
            t.kind_id         as "kind_id!",
            k.slug            as "kind_slug!",
            t.slug            as "slug!",
            t.label           as "label!",
            t.description,
            t.is_user_defined as "is_user_defined!: bool",
            t.created_at      as "created_at!",
            t.created_by
           FROM taxonz t
           JOIN taxon_kindz k ON k.id = t.kind_id
           WHERE t.id = ? AND t.deleted_at IS NULL"#,
        req.id,
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("failed to get taxon", vec![ErrorDetail::from(e)]);
        }
    };

    match row {
        Some(r) => GrimoireResponse::success(
            "taxon retrieved",
            Taxon {
                id: r.id,
                kind_id: r.kind_id,
                kind_slug: r.kind_slug,
                slug: r.slug,
                label: r.label,
                description: r.description,
                is_user_defined: r.is_user_defined,
                created_at: r.created_at,
                created_by: r.created_by,
            },
        ),
        None => GrimoireResponse::failure("taxon not found", vec![]),
    }
}

/// list every taxon under a kind (no stats, no pagination).
pub async fn list_taxons_by_kind(kind_slug: &str) -> GrimoireResponse<Vec<Taxon>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let rows = match sqlx::query!(
        r#"SELECT
            t.id              as "id!",
            t.kind_id         as "kind_id!",
            k.slug            as "kind_slug!",
            t.slug            as "slug!",
            t.label           as "label!",
            t.description,
            t.is_user_defined as "is_user_defined!: bool",
            t.created_at      as "created_at!",
            t.created_by
           FROM taxonz t
           JOIN taxon_kindz k ON k.id = t.kind_id
           WHERE k.slug = ? AND t.deleted_at IS NULL
           ORDER BY t.label ASC"#,
        kind_slug,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to list taxons by kind",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let taxons = rows
        .into_iter()
        .map(|r| Taxon {
            id: r.id,
            kind_id: r.kind_id,
            kind_slug: r.kind_slug,
            slug: r.slug,
            label: r.label,
            description: r.description,
            is_user_defined: r.is_user_defined,
            created_at: r.created_at,
            created_by: r.created_by,
        })
        .collect();

    GrimoireResponse::success("taxons retrieved", taxons)
}

/// search/page taxons with album/song count stats.
pub async fn query_taxons(req: QueryTaxonsRequest) -> GrimoireResponse<TaxonsQueryResult> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let limit = req.limit.unwrap_or(50).min(500) as i64;
    let offset = req.offset.unwrap_or(0) as i64;
    let kind_filter = req.kind_slug.clone();
    let q_filter = req.q.as_ref().map(|s| format!("%{}%", s.to_lowercase()));

    let rows = match sqlx::query!(
        r#"SELECT
              t.id                                         as "id!",
              t.kind_id                                    as "kind_id!",
              k.slug                                       as "kind_slug!",
              t.slug                                       as "slug!",
              t.label                                      as "label!",
              t.created_at                                 as "created_at!",
              COALESCE((SELECT COUNT(DISTINCT at.album_id)
                          FROM album_taxonz at
                         WHERE at.taxon_id = t.id), 0)     as "album_count!",
              0                                            as "song_count!",
              0                                            as "total_duration!"
            FROM taxonz t
            JOIN taxon_kindz k ON k.id = t.kind_id
            WHERE t.deleted_at IS NULL
              AND (?1 IS NULL OR k.slug = ?1)
              AND (?2 IS NULL OR LOWER(t.label) LIKE ?2)
            ORDER BY t.label ASC
            LIMIT ?3 OFFSET ?4"#,
        kind_filter,
        q_filter,
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("failed to query taxons", vec![ErrorDetail::from(e)]);
        }
    };

    let total_count = match sqlx::query!(
        r#"SELECT COUNT(*) as "n!"
            FROM taxonz t
            JOIN taxon_kindz k ON k.id = t.kind_id
            WHERE t.deleted_at IS NULL
              AND (?1 IS NULL OR k.slug = ?1)
              AND (?2 IS NULL OR LOWER(t.label) LIKE ?2)"#,
        kind_filter,
        q_filter,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r.n,
        Err(e) => {
            return GrimoireResponse::failure("failed to count taxons", vec![ErrorDetail::from(e)]);
        }
    };

    let items: Vec<TaxonWithStats> = rows
        .into_iter()
        .map(|r| TaxonWithStats {
            id: r.id,
            kind_id: r.kind_id,
            kind_slug: r.kind_slug,
            slug: r.slug,
            label: r.label,
            created_at: r.created_at,
            album_count: r.album_count,
            song_count: r.song_count,
            total_duration: r.total_duration,
        })
        .collect();

    let has_more = (offset + items.len() as i64) < total_count;

    GrimoireResponse::success(
        "taxons retrieved",
        TaxonsQueryResult {
            items,
            total_count,
            has_more,
            offset: offset as u32,
            limit: limit as u32,
        },
    )
}

// ---- DAG edges ----

/// returns true if `candidate_ancestor_id` already appears in the
/// transitive ancestor set of `descendant_id` (used to prevent cycles
/// when adding a parent edge: if the proposed parent already has the
/// child as one of its ancestors, the new edge would close a cycle).
async fn would_form_cycle(
    pool: &sqlx::SqlitePool,
    child_id: &str,
    parent_id: &str,
) -> Result<bool, sqlx::Error> {
    // a cycle would form if `child_id` is already an ancestor of
    // `parent_id` (i.e. somewhere up the DAG from `parent_id`, we
    // hit `child_id`).
    let row = sqlx::query!(
        r#"WITH RECURSIVE ancestors(node) AS (
              SELECT parent_id FROM taxon_parentz WHERE child_id = ?1
              UNION
              SELECT tp.parent_id
                FROM taxon_parentz tp
                JOIN ancestors a ON tp.child_id = a.node
            )
            SELECT EXISTS(SELECT 1 FROM ancestors WHERE node = ?2) as "hit!: bool""#,
        parent_id,
        child_id,
    )
    .fetch_one(pool)
    .await?;
    Ok(row.hit)
}

pub async fn add_taxon_parent(req: AddTaxonParentRequest) -> GrimoireResponse<()> {
    if req.child_id == req.parent_id {
        return GrimoireResponse::failure("a taxon cannot be its own parent", vec![]);
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    match would_form_cycle(&pool, &req.child_id, &req.parent_id).await {
        Ok(true) => {
            return GrimoireResponse::failure(
                "adding this parent would create a cycle in the taxonomy DAG",
                vec![],
            );
        }
        Ok(false) => {}
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to check for taxonomy cycle",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    if let Err(e) = sqlx::query!(
        r#"INSERT INTO taxon_parentz (child_id, parent_id)
           VALUES (?, ?)
           ON CONFLICT (child_id, parent_id) DO NOTHING"#,
        req.child_id,
        req.parent_id,
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure("failed to add taxon parent", vec![ErrorDetail::from(e)]);
    }

    GrimoireResponse::success("taxon parent linked", ())
}

pub async fn remove_taxon_parent(req: RemoveTaxonParentRequest) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    if let Err(e) = sqlx::query!(
        r#"DELETE FROM taxon_parentz WHERE child_id = ? AND parent_id = ?"#,
        req.child_id,
        req.parent_id,
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure(
            "failed to remove taxon parent",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success("taxon parent unlinked", ())
}

/// every transitive ancestor of `id` (excluding itself).
pub async fn get_taxon_ancestors(id: &str) -> GrimoireResponse<Vec<TaxonRef>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let rows = match sqlx::query!(
        r#"WITH RECURSIVE ancestors(id) AS (
              SELECT parent_id FROM taxon_parentz WHERE child_id = ?1
              UNION
              SELECT tp.parent_id
                FROM taxon_parentz tp
                JOIN ancestors a ON tp.child_id = a.id
            )
            SELECT t.id as "id!", k.slug as "kind_slug!", t.label as "label!"
              FROM ancestors a
              JOIN taxonz t       ON t.id = a.id
              JOIN taxon_kindz k  ON k.id = t.kind_id
              WHERE t.deleted_at IS NULL
              ORDER BY t.label ASC"#,
        id,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to get taxon ancestors",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    GrimoireResponse::success(
        "ancestors retrieved",
        rows.into_iter()
            .map(|r| TaxonRef {
                id: r.id,
                kind_slug: r.kind_slug,
                label: r.label,
            })
            .collect(),
    )
}

/// every transitive descendant of `id` (excluding itself).
pub async fn get_taxon_descendants(id: &str) -> GrimoireResponse<Vec<TaxonRef>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let rows = match sqlx::query!(
        r#"WITH RECURSIVE descendants(id) AS (
              SELECT child_id FROM taxon_parentz WHERE parent_id = ?1
              UNION
              SELECT tp.child_id
                FROM taxon_parentz tp
                JOIN descendants d ON tp.parent_id = d.id
            )
            SELECT t.id as "id!", k.slug as "kind_slug!", t.label as "label!"
              FROM descendants d
              JOIN taxonz t       ON t.id = d.id
              JOIN taxon_kindz k  ON k.id = t.kind_id
              WHERE t.deleted_at IS NULL
              ORDER BY t.label ASC"#,
        id,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to get taxon descendants",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    GrimoireResponse::success(
        "descendants retrieved",
        rows.into_iter()
            .map(|r| TaxonRef {
                id: r.id,
                kind_slug: r.kind_slug,
                label: r.label,
            })
            .collect(),
    )
}

// ---- album <-> taxon links ----

pub async fn get_album_taxon_links(album_id: &str) -> GrimoireResponse<Vec<AlbumTaxonLink>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let rows = match sqlx::query!(
        r#"SELECT
              at.album_id   as "album_id!",
              at.taxon_id   as "taxon_id!",
              k.slug        as "kind_slug!",
              t.label       as "label!",
              at.origin     as "origin!",
              at.confidence,
              at.created_at as "created_at!",
              at.created_by
            FROM album_taxonz at
            JOIN taxonz t      ON t.id = at.taxon_id
            JOIN taxon_kindz k ON k.id = t.kind_id
            WHERE at.album_id = ? AND t.deleted_at IS NULL
            ORDER BY k.display_order ASC, t.label ASC"#,
        album_id,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to get album taxon links",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    GrimoireResponse::success(
        "album taxon links retrieved",
        rows.into_iter()
            .map(|r| AlbumTaxonLink {
                album_id: r.album_id,
                taxon_id: r.taxon_id,
                kind_slug: r.kind_slug,
                label: r.label,
                origin: r.origin,
                confidence: r.confidence,
                created_at: r.created_at,
                created_by: r.created_by,
            })
            .collect(),
    )
}

pub async fn add_album_taxon(req: AddAlbumTaxonRequest) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    if let Err(e) = sqlx::query!(
        r#"INSERT INTO album_taxonz (album_id, taxon_id, origin, confidence)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (album_id, taxon_id, origin)
            DO UPDATE SET confidence = excluded.confidence"#,
        req.album_id,
        req.taxon_id,
        req.origin,
        req.confidence,
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure(
            "failed to add album taxon link",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success("album taxon linked", ())
}

pub async fn remove_album_taxon(req: RemoveAlbumTaxonRequest) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let result = match req.origin {
        Some(origin) => {
            sqlx::query!(
                r#"DELETE FROM album_taxonz
                    WHERE album_id = ? AND taxon_id = ? AND origin = ?"#,
                req.album_id,
                req.taxon_id,
                origin,
            )
            .execute(&pool)
            .await
        }
        None => {
            sqlx::query!(
                r#"DELETE FROM album_taxonz WHERE album_id = ? AND taxon_id = ?"#,
                req.album_id,
                req.taxon_id,
            )
            .execute(&pool)
            .await
        }
    };

    if let Err(e) = result {
        return GrimoireResponse::failure(
            "failed to remove album taxon link",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success("album taxon unlinked", ())
}

/// replace the full set of `(taxon_id, origin)` links for an album.
/// any existing link not present in `req.links` is removed.
pub async fn set_album_taxons(req: SetAlbumTaxonsRequest) -> GrimoireResponse<Vec<AlbumTaxonLink>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to begin transaction",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    if let Err(e) = sqlx::query!(
        r#"DELETE FROM album_taxonz WHERE album_id = ?"#,
        req.album_id,
    )
    .execute(&mut *tx)
    .await
    {
        return GrimoireResponse::failure(
            "failed to clear existing album taxon links",
            vec![ErrorDetail::from(e)],
        );
    }

    for link in &req.links {
        if let Err(e) = sqlx::query!(
            r#"INSERT INTO album_taxonz (album_id, taxon_id, origin, confidence)
                VALUES (?, ?, ?, ?)"#,
            req.album_id,
            link.taxon_id,
            link.origin,
            link.confidence,
        )
        .execute(&mut *tx)
        .await
        {
            return GrimoireResponse::failure(
                "failed to insert album taxon link",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    if let Err(e) = tx.commit().await {
        return GrimoireResponse::failure(
            "failed to commit album taxons",
            vec![ErrorDetail::from(e)],
        );
    }

    get_album_taxon_links(&req.album_id).await
}

/// sync the single user-origin taxon link for `(album_id, kind_slug)`.
///
/// removes any existing user-origin link for that album under that kind,
/// then (if `value` is `Some` and non-empty) finds-or-creates a taxon
/// with that label and links it back with origin='user'.
///
/// used by writers that previously stored a single string value as a
/// column on `albumz` (e.g. `label`, `release_date`) and now route it
/// through the taxonomy. callers should pass the trimmed user input.
pub async fn sync_album_user_taxon(
    album_id: &str,
    kind_slug: &str,
    value: Option<&str>,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    // remove any existing user-origin link for this album+kind. other
    // origins (musicbrainz/lastfm/audiodb) are preserved.
    if let Err(e) = sqlx::query!(
        r#"DELETE FROM album_taxonz
            WHERE album_id = ?
              AND origin = 'user'
              AND taxon_id IN (
                  SELECT t.id FROM taxonz t
                  JOIN taxon_kindz k ON k.id = t.kind_id
                  WHERE k.slug = ?
              )"#,
        album_id,
        kind_slug,
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure(
            "failed to clear existing user taxon link",
            vec![ErrorDetail::from(e)],
        );
    }

    let trimmed = value.map(str::trim).filter(|s| !s.is_empty());
    let Some(label) = trimmed else {
        return GrimoireResponse::success("album user taxon cleared", ());
    };

    let taxon_resp = find_or_create_taxon(kind_slug, label).await;
    let Some(taxon) = taxon_resp.data else {
        return GrimoireResponse::failure(
            &format!("failed to find_or_create taxon for kind={}", kind_slug),
            taxon_resp.errors,
        );
    };

    add_album_taxon(AddAlbumTaxonRequest {
        album_id: album_id.to_string(),
        taxon_id: taxon.id,
        origin: "user".to_string(),
        confidence: None,
    })
    .await
}

// ---- scalar attributes ----

pub async fn set_scalar_attribute(
    req: SetScalarAttributeRequest,
) -> GrimoireResponse<ScalarAttribute> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let kind_id = match lookup_kind_id(&pool, &req.kind_slug).await {
        Ok(id) => id,
        Err(resp) => return resp.map(|_| unreachable!()),
    };

    let row = match sqlx::query!(
        r#"INSERT INTO scalar_attributez (album_id, taxon_kind_id, value_f64, origin, confidence)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT (album_id, taxon_kind_id, origin)
            DO UPDATE SET value_f64 = excluded.value_f64, confidence = excluded.confidence
            RETURNING
              album_id      as "album_id!",
              taxon_kind_id as "taxon_kind_id!",
              value_f64     as "value_f64!",
              origin        as "origin!",
              confidence,
              created_at    as "created_at!",
              created_by"#,
        req.album_id,
        kind_id,
        req.value_f64,
        req.origin,
        req.confidence,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to set scalar attribute",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    GrimoireResponse::success(
        "scalar attribute set",
        ScalarAttribute {
            album_id: row.album_id,
            taxon_kind_id: row.taxon_kind_id,
            kind_slug: req.kind_slug,
            value_f64: row.value_f64,
            origin: row.origin,
            confidence: row.confidence,
            created_at: row.created_at,
            created_by: row.created_by,
        },
    )
}

/// list album_ids whose scalar value for `kind_slug` falls in
/// `[min, max]` (either bound optional).
pub async fn query_albums_by_scalar_range(
    req: QueryScalarRangeRequest,
) -> GrimoireResponse<Vec<String>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let kind_id = match lookup_kind_id(&pool, &req.kind_slug).await {
        Ok(id) => id,
        Err(resp) => return resp.map(|_| unreachable!()),
    };

    let limit = req.limit.unwrap_or(500).min(5000) as i64;
    let offset = req.offset.unwrap_or(0) as i64;

    let rows = match sqlx::query!(
        r#"SELECT DISTINCT album_id as "album_id!"
            FROM scalar_attributez
            WHERE taxon_kind_id = ?1
              AND (?2 IS NULL OR value_f64 >= ?2)
              AND (?3 IS NULL OR value_f64 <= ?3)
            ORDER BY album_id ASC
            LIMIT ?4 OFFSET ?5"#,
        kind_id,
        req.min,
        req.max,
        limit,
        offset,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to query scalar range",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    GrimoireResponse::success(
        "matching album ids retrieved",
        rows.into_iter().map(|r| r.album_id).collect(),
    )
}

/// soft-delete a taxon by id (sets `deleted_at` + `deleted_by`).
/// returns ok with an `()` payload if the row was already deleted or
/// did not exist; only sql failure produces an error response. callers
/// who care about whether the row actually existed should consult
/// `get_taxon` first.
pub async fn delete_taxon(id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    if let Err(e) = sqlx::query!(
        r#"UPDATE taxonz
              SET deleted_at = ?, deleted_by = ?
            WHERE id = ? AND deleted_at IS NULL"#,
        now,
        deleted_by,
        id,
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure("failed to delete taxon", vec![ErrorDetail::from(e)]);
    }

    GrimoireResponse::success("taxon deleted", ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify_taxon_label("Hip Hop"), "hip-hop");
        assert_eq!(slugify_taxon_label("  Drum & Bass  "), "drum-bass");
        assert_eq!(slugify_taxon_label("R&B/Soul"), "r-b-soul");
        assert_eq!(slugify_taxon_label("---"), "untitled");
        assert_eq!(slugify_taxon_label(""), "untitled");
        assert_eq!(slugify_taxon_label("Detroit, MI"), "detroit-mi");
    }
}

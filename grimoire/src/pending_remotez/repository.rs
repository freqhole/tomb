//! pending-remote registry repository
//!
//! operates on the *same* `remotez` table established remotes use,
//! filtered to `pending_stage IS NOT NULL` - see this module's mod.rs doc
//! comment for why there's no separate table.

use crate::database;
use crate::error::GrimoireResult;
use crate::pending_remotez::models::{
    CreatePendingRemoteRequest, PendingRemote, PendingRemoteStage, UpsertPendingRemoteRequest,
};

use time::OffsetDateTime;
use uuid::Uuid;

/// raw row shape - only the columns relevant to a pending remote, aliased
/// to their `PendingRemote`-facing names where the underlying remotez
/// column is named differently (name -> server_name, etc).
#[derive(Debug)]
struct PendingRemoteRow {
    id: String,
    peer_addr: String,
    transport: String,
    stage: String,
    created_at: i64,
    updated_at: i64,
    server_name: Option<String>,
    server_description: Option<String>,
    server_version: Option<String>,
    server_image_data: Option<String>,
    server_image_type: Option<String>,
    knock_username: Option<String>,
    knock_message: Option<String>,
    error_message: Option<String>,
}

impl From<PendingRemoteRow> for PendingRemote {
    fn from(r: PendingRemoteRow) -> Self {
        PendingRemote {
            id: r.id,
            peer_addr: r.peer_addr,
            transport: r.transport,
            stage: PendingRemoteStage::from(r.stage),
            created_at: r.created_at,
            updated_at: r.updated_at,
            server_name: r.server_name,
            server_description: r.server_description,
            server_version: r.server_version,
            server_image_data: r.server_image_data,
            server_image_type: r.server_image_type,
            knock_username: r.knock_username,
            knock_message: r.knock_message,
            error_message: r.error_message,
        }
    }
}

#[derive(Debug, Default)]
pub struct PendingRemoteRepository;

impl PendingRemoteRepository {
    pub fn new() -> Self {
        Self
    }

    /// list all pending remotes, ordered by `updated_at` descending
    pub async fn list(&self) -> GrimoireResult<Vec<PendingRemote>> {
        let pool = database::connect().await?;

        let rows = sqlx::query_as!(
            PendingRemoteRow,
            r#"
            SELECT
                remote_id as "id!",
                peer_addr as "peer_addr!",
                transport as "transport!",
                pending_stage as "stage!",
                created_at as "created_at!",
                updated_at as "updated_at!",
                name as server_name,
                description as server_description,
                version as server_version,
                server_image_data,
                server_image_type,
                knock_username,
                knock_message,
                error_message
            FROM remotez
            WHERE pending_stage IS NOT NULL
            ORDER BY updated_at DESC
            "#
        )
        .fetch_all(&pool)
        .await?;

        Ok(rows.into_iter().map(PendingRemote::from).collect())
    }

    /// fetch a single pending remote by id (the underlying `remote_id`)
    pub async fn get(&self, id: &str) -> GrimoireResult<Option<PendingRemote>> {
        let pool = database::connect().await?;

        let row = sqlx::query_as!(
            PendingRemoteRow,
            r#"
            SELECT
                remote_id as "id!",
                peer_addr as "peer_addr!",
                transport as "transport!",
                pending_stage as "stage!",
                created_at as "created_at!",
                updated_at as "updated_at!",
                name as server_name,
                description as server_description,
                version as server_version,
                server_image_data,
                server_image_type,
                knock_username,
                knock_message,
                error_message
            FROM remotez
            WHERE remote_id = ?1 AND pending_stage IS NOT NULL
            "#,
            id
        )
        .fetch_optional(&pool)
        .await?;

        Ok(row.map(PendingRemote::from))
    }

    /// fetch a single pending remote by peer_addr - more than one pending
    /// row can share a peer_addr (the relaxed partial unique index only
    /// applies to established remotes, see migration 097), so this
    /// returns whichever row sqlite happens to pick first, same
    /// nondeterminism the old separate-table/IDB designs both had.
    pub async fn get_by_peer_addr(&self, peer_addr: &str) -> GrimoireResult<Option<PendingRemote>> {
        let pool = database::connect().await?;

        let row = sqlx::query_as!(
            PendingRemoteRow,
            r#"
            SELECT
                remote_id as "id!",
                peer_addr as "peer_addr!",
                transport as "transport!",
                pending_stage as "stage!",
                created_at as "created_at!",
                updated_at as "updated_at!",
                name as server_name,
                description as server_description,
                version as server_version,
                server_image_data,
                server_image_type,
                knock_username,
                knock_message,
                error_message
            FROM remotez
            WHERE peer_addr = ?1 AND pending_stage IS NOT NULL
            "#,
            peer_addr
        )
        .fetch_optional(&pool)
        .await?;

        Ok(row.map(PendingRemote::from))
    }

    /// create a new pending remote with a fresh server-generated id.
    pub async fn create(&self, req: &CreatePendingRemoteRequest) -> GrimoireResult<PendingRemote> {
        let pool = database::connect().await?;

        let id = Uuid::new_v4().to_string();
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let stage = req.stage.as_str();

        let row = sqlx::query_as!(
            PendingRemoteRow,
            r#"
            INSERT INTO remotez (
                remote_id, peer_addr, transport, pending_stage, created_at, updated_at,
                name, description, version,
                server_image_data, server_image_type,
                knock_username, knock_message, error_message
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            RETURNING
                remote_id as "id!",
                peer_addr as "peer_addr!",
                transport as "transport!",
                pending_stage as "stage!",
                created_at as "created_at!",
                updated_at as "updated_at!",
                name as server_name,
                description as server_description,
                version as server_version,
                server_image_data,
                server_image_type,
                knock_username,
                knock_message,
                error_message
            "#,
            id,
            req.peer_addr,
            req.transport,
            stage,
            now,
            req.server_name,
            req.server_description,
            req.server_version,
            req.server_image_data,
            req.server_image_type,
            req.knock_username,
            req.knock_message,
            req.error_message,
        )
        .fetch_one(&pool)
        .await?;

        Ok(PendingRemote::from(row))
    }

    /// update a pending remote. only supplied fields are changed (`None`
    /// leaves the existing value untouched, same COALESCE convention as
    /// `remotez::repository::RemoteRepository::upsert`); `updated_at` is
    /// always bumped to now. returns `None` if no *pending* row with this
    /// id exists (an established remote's row is never touched by this
    /// path, even if the id happened to collide).
    pub async fn update(
        &self,
        id: &str,
        req: &UpsertPendingRemoteRequest,
    ) -> GrimoireResult<Option<PendingRemote>> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();
        let stage = req.stage.map(|s| s.as_str());

        let row = sqlx::query_as!(
            PendingRemoteRow,
            r#"
            UPDATE remotez SET
                peer_addr = COALESCE(?2, peer_addr),
                transport = COALESCE(?3, transport),
                pending_stage = COALESCE(?4, pending_stage),
                updated_at = ?5,
                name = COALESCE(?6, name),
                description = COALESCE(?7, description),
                version = COALESCE(?8, version),
                server_image_data = COALESCE(?9, server_image_data),
                server_image_type = COALESCE(?10, server_image_type),
                knock_username = COALESCE(?11, knock_username),
                knock_message = COALESCE(?12, knock_message),
                error_message = COALESCE(?13, error_message)
            WHERE remote_id = ?1 AND pending_stage IS NOT NULL
            RETURNING
                remote_id as "id!",
                peer_addr as "peer_addr!",
                transport as "transport!",
                pending_stage as "stage!",
                created_at as "created_at!",
                updated_at as "updated_at!",
                name as server_name,
                description as server_description,
                version as server_version,
                server_image_data,
                server_image_type,
                knock_username,
                knock_message,
                error_message
            "#,
            id,
            req.peer_addr,
            req.transport,
            stage,
            now,
            req.server_name,
            req.server_description,
            req.server_version,
            req.server_image_data,
            req.server_image_type,
            req.knock_username,
            req.knock_message,
            req.error_message,
        )
        .fetch_optional(&pool)
        .await?;

        Ok(row.map(PendingRemote::from))
    }

    /// delete a pending remote by id. returns true if a row was removed.
    /// only ever matches a row with `pending_stage IS NOT NULL` - an
    /// established remote can never be deleted through this path.
    pub async fn remove(&self, id: &str) -> GrimoireResult<bool> {
        let pool = database::connect().await?;

        let result = sqlx::query!(
            r#"DELETE FROM remotez WHERE remote_id = ?1 AND pending_stage IS NOT NULL"#,
            id
        )
        .execute(&pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// delete every pending remote matching peer_addr (there's normally
    /// only one, but the relaxed partial unique index technically allows
    /// more - see `get_by_peer_addr`'s doc comment).
    pub async fn remove_by_peer_addr(&self, peer_addr: &str) -> GrimoireResult<bool> {
        let pool = database::connect().await?;

        let result = sqlx::query!(
            r#"DELETE FROM remotez WHERE peer_addr = ?1 AND pending_stage IS NOT NULL"#,
            peer_addr
        )
        .execute(&pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }
}

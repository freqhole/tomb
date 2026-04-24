//! remote registry repository
//!
//! sqlx access to the `remotez` table. all bool fields are stored as INTEGER
//! 0/1; this module handles the mapping.

use crate::database;
use crate::error::GrimoireResult;
use crate::remotez::models::{Remote, RemoteTransport, UpsertRemoteRequest};

use time::OffsetDateTime;

/// raw row shape mirroring the `remotez` table
#[derive(Debug)]
struct RemoteRow {
    remote_id: String,
    name: String,
    transport: String,
    base_url: Option<String>,
    peer_addr: Option<String>,
    api_key: Option<String>,
    is_active: i64,
    is_charnel_managed: i64,
    last_connected_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
    description: Option<String>,
    image_url: Option<String>,
    image_blob_id: Option<String>,
    version: Option<String>,
    last_info_check: Option<i64>,
    is_offline: Option<i64>,
    offline_since: Option<i64>,
    last_checked: Option<i64>,
    metadata: Option<String>,
}

impl From<RemoteRow> for Remote {
    fn from(r: RemoteRow) -> Self {
        Remote {
            remote_id: r.remote_id,
            name: r.name,
            transport: RemoteTransport::from(r.transport),
            base_url: r.base_url,
            peer_addr: r.peer_addr,
            api_key: r.api_key,
            is_active: r.is_active != 0,
            is_charnel_managed: r.is_charnel_managed != 0,
            last_connected_at: r.last_connected_at,
            created_at: r.created_at,
            updated_at: r.updated_at,
            description: r.description,
            image_url: r.image_url,
            image_blob_id: r.image_blob_id,
            version: r.version,
            last_info_check: r.last_info_check,
            is_offline: r.is_offline.map(|v| v != 0),
            offline_since: r.offline_since,
            last_checked: r.last_checked,
            metadata: r.metadata,
        }
    }
}

#[derive(Debug, Default)]
pub struct RemoteRepository;

impl RemoteRepository {
    pub fn new() -> Self {
        Self
    }

    /// list all remotes, ordered by `updated_at` descending
    pub async fn list(&self) -> GrimoireResult<Vec<Remote>> {
        let pool = database::connect().await?;

        let rows = sqlx::query_as!(
            RemoteRow,
            r#"
            SELECT
                remote_id as "remote_id!",
                name as "name!",
                transport as "transport!",
                base_url,
                peer_addr,
                api_key,
                is_active as "is_active!",
                is_charnel_managed as "is_charnel_managed!",
                last_connected_at,
                created_at as "created_at!",
                updated_at as "updated_at!",
                description,
                image_url,
                image_blob_id,
                version,
                last_info_check,
                is_offline,
                offline_since,
                last_checked,
                metadata
            FROM remotez
            ORDER BY updated_at DESC
            "#
        )
        .fetch_all(&pool)
        .await?;

        Ok(rows.into_iter().map(Remote::from).collect())
    }

    /// fetch a single remote by id
    pub async fn get(&self, remote_id: &str) -> GrimoireResult<Option<Remote>> {
        let pool = database::connect().await?;

        let row = sqlx::query_as!(
            RemoteRow,
            r#"
            SELECT
                remote_id as "remote_id!",
                name as "name!",
                transport as "transport!",
                base_url,
                peer_addr,
                api_key,
                is_active as "is_active!",
                is_charnel_managed as "is_charnel_managed!",
                last_connected_at,
                created_at as "created_at!",
                updated_at as "updated_at!",
                description,
                image_url,
                image_blob_id,
                version,
                last_info_check,
                is_offline,
                offline_since,
                last_checked,
                metadata
            FROM remotez
            WHERE remote_id = ?1
            "#,
            remote_id
        )
        .fetch_optional(&pool)
        .await?;

        Ok(row.map(Remote::from))
    }

    /// fetch a single remote by peer_addr (P2P node id or json endpoint)
    pub async fn get_by_peer_addr(&self, peer_addr: &str) -> GrimoireResult<Option<Remote>> {
        let pool = database::connect().await?;

        let row = sqlx::query_as!(
            RemoteRow,
            r#"
            SELECT
                remote_id as "remote_id!",
                name as "name!",
                transport as "transport!",
                base_url,
                peer_addr,
                api_key,
                is_active as "is_active!",
                is_charnel_managed as "is_charnel_managed!",
                last_connected_at,
                created_at as "created_at!",
                updated_at as "updated_at!",
                description,
                image_url,
                image_blob_id,
                version,
                last_info_check,
                is_offline,
                offline_since,
                last_checked,
                metadata
            FROM remotez
            WHERE peer_addr = ?1
            "#,
            peer_addr
        )
        .fetch_optional(&pool)
        .await?;

        Ok(row.map(Remote::from))
    }

    /// insert or update a remote. preserves existing `created_at` on conflict;
    /// `updated_at` is always set to now. fields not supplied in the request
    /// are left unchanged on conflict.
    pub async fn upsert(&self, req: &UpsertRemoteRequest) -> GrimoireResult<Remote> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();
        let transport = req.transport.as_str();
        let is_active = req.is_active.map(|b| b as i64);
        let is_charnel_managed = req.is_charnel_managed.map(|b| b as i64);
        let is_offline = req.is_offline.map(|b| b as i64);

        let row = sqlx::query_as!(
            RemoteRow,
            r#"
            INSERT INTO remotez (
                remote_id, name, transport, base_url, peer_addr, api_key,
                is_active, is_charnel_managed, last_connected_at,
                created_at, updated_at,
                description, image_url, image_blob_id, version, last_info_check,
                is_offline, offline_since, last_checked, metadata
            )
            VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6,
                COALESCE(?7, 0), COALESCE(?8, 0), ?9,
                ?10, ?10,
                ?11, ?12, ?13, ?14, ?15,
                ?16, ?17, ?18, ?19
            )
            ON CONFLICT (remote_id) DO UPDATE SET
                name = ?2,
                transport = ?3,
                base_url = COALESCE(?4, base_url),
                peer_addr = COALESCE(?5, peer_addr),
                api_key = COALESCE(?6, api_key),
                is_active = COALESCE(?7, is_active),
                is_charnel_managed = COALESCE(?8, is_charnel_managed),
                last_connected_at = COALESCE(?9, last_connected_at),
                updated_at = ?10,
                description = COALESCE(?11, description),
                image_url = COALESCE(?12, image_url),
                image_blob_id = COALESCE(?13, image_blob_id),
                version = COALESCE(?14, version),
                last_info_check = COALESCE(?15, last_info_check),
                is_offline = COALESCE(?16, is_offline),
                offline_since = COALESCE(?17, offline_since),
                last_checked = COALESCE(?18, last_checked),
                metadata = COALESCE(?19, metadata)
            RETURNING
                remote_id as "remote_id!",
                name as "name!",
                transport as "transport!",
                base_url,
                peer_addr,
                api_key,
                is_active as "is_active!",
                is_charnel_managed as "is_charnel_managed!",
                last_connected_at,
                created_at as "created_at!",
                updated_at as "updated_at!",
                description,
                image_url,
                image_blob_id,
                version,
                last_info_check,
                is_offline,
                offline_since,
                last_checked,
                metadata
            "#,
            req.remote_id,
            req.name,
            transport,
            req.base_url,
            req.peer_addr,
            req.api_key,
            is_active,
            is_charnel_managed,
            req.last_connected_at,
            now,
            req.description,
            req.image_url,
            req.image_blob_id,
            req.version,
            req.last_info_check,
            is_offline,
            req.offline_since,
            req.last_checked,
            req.metadata,
        )
        .fetch_one(&pool)
        .await?;

        Ok(Remote::from(row))
    }

    /// delete a remote by id. returns true if a row was removed.
    pub async fn remove(&self, remote_id: &str) -> GrimoireResult<bool> {
        let pool = database::connect().await?;

        let result = sqlx::query!(r#"DELETE FROM remotez WHERE remote_id = ?1"#, remote_id)
            .execute(&pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    /// mark a remote as the active one. atomically clears is_active on all
    /// other rows so at most one remote is active at a time.
    pub async fn mark_active(&self, remote_id: &str) -> GrimoireResult<()> {
        let pool = database::connect().await?;

        let mut tx = pool.begin().await?;

        sqlx::query!(r#"UPDATE remotez SET is_active = 0 WHERE is_active = 1"#)
            .execute(&mut *tx)
            .await?;

        sqlx::query!(
            r#"
            UPDATE remotez
            SET is_active = 1, last_connected_at = unixepoch(), updated_at = unixepoch()
            WHERE remote_id = ?1
            "#,
            remote_id
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    /// update cached server info (response to /api/hello). leaves other
    /// fields untouched.
    pub async fn update_server_info(
        &self,
        remote_id: &str,
        description: Option<&str>,
        image_url: Option<&str>,
        image_blob_id: Option<&str>,
        version: Option<&str>,
    ) -> GrimoireResult<()> {
        let pool = database::connect().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();

        sqlx::query!(
            r#"
            UPDATE remotez
            SET description = COALESCE(?2, description),
                image_url = COALESCE(?3, image_url),
                image_blob_id = COALESCE(?4, image_blob_id),
                version = COALESCE(?5, version),
                last_info_check = ?6,
                updated_at = ?6
            WHERE remote_id = ?1
            "#,
            remote_id,
            description,
            image_url,
            image_blob_id,
            version,
            now
        )
        .execute(&pool)
        .await?;

        Ok(())
    }
}

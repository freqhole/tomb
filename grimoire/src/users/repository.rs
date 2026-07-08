//! User repository for database operations
//!
//! This module handles all database interactions for the user system,
//! including users, invite codes, favorites, ratings, and sessions.

use crate::database;
use crate::users::haruspex_bridge;
use crate::users::models::*;
use haruspex::stores::IdentityStore;
use time::OffsetDateTime;

/// Database row struct for user_accountz table
#[derive(Debug)]
struct UserRow {
    id: String,
    username: String,
    role: String,
    api_key: Option<String>,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
    haruspex_user_id: Option<String>,
    metadata: Option<String>,
}

impl From<UserRow> for User {
    fn from(row: UserRow) -> Self {
        User {
            id: row.id,
            username: row.username,
            role: UserRole::from(row.role),
            api_key: row.api_key,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            haruspex_user_id: row.haruspex_user_id,
            metadata: row.metadata,
        }
    }
}

/// open haruspex's identity store, the same way every other haruspex-
/// backed store in this crate reports a connection failure.
async fn identity_store() -> AuthResult<haruspex::sqlite::SqliteIdentityStore> {
    let pool = database::connect_haruspex().await?;
    Ok(haruspex::sqlite::SqliteIdentityStore::new(pool))
}

/// haruspex's device rows don't track a separate creation timestamp -
/// `last_seen_at` is the closest available value, and is exact for a
/// freshly-added device (it only drifts from the true creation time once
/// the device is touched again).
fn device_to_peer_node(device: haruspex::identity::DeviceNode, user_id: &str) -> UserPeerNode {
    UserPeerNode {
        user_id: user_id.to_string(),
        node_id: device.node_id,
        instance_name: device.instance_name,
        metadata: None,
        created_at: device.last_seen_at,
        last_seen_at: Some(device.last_seen_at),
        deleted_at: device.deleted_at,
    }
}

/// Database row struct for invite_codez table
#[derive(Debug)]
struct InviteCodeRow {
    id: String,
    code: String,
    created_at: i64,
    used_at: Option<i64>,
    used_by_id: Option<String>,
    is_active: i64,
    code_type: String,
    link_for_user_id: Option<String>,
    link_expires_at: Option<i64>,
    grants_role: String,
}

impl From<InviteCodeRow> for InviteCode {
    fn from(row: InviteCodeRow) -> Self {
        InviteCode {
            id: row.id,
            code: row.code,
            created_at: row.created_at,
            used_at: row.used_at,
            used_by_id: row.used_by_id,
            is_active: row.is_active != 0,
            code_type: InviteCodeType::from(row.code_type),
            link_for_user_id: row.link_for_user_id,
            link_expires_at: row.link_expires_at,
            grants_role: UserRole::from(row.grants_role.as_str()),
        }
    }
}

/// Repository for user-related database operations
pub(crate) struct UserRepository;

impl UserRepository {
    /// Create a new user repository instance
    pub fn new() -> Self {
        Self
    }

    /// Create a new user account
    pub async fn create_user(&self, request: &CreateUserRequest) -> AuthResult<User> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();
        let role = request.role.unwrap_or_default().to_string();

        let row = sqlx::query_as!(
            UserRow,
            r#"
            INSERT INTO user_accountz (username, role, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4)
            RETURNING id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at, haruspex_user_id, metadata
            "#,
            request.username,
            role,
            now,
            now
        )
        .fetch_one(&pool)
        .await?;

        Ok(User::from(row))
    }

    /// Find a user by ID
    pub async fn find_user_by_id(&self, user_id: &str) -> AuthResult<Option<User>> {
        let pool = database::connect().await?;

        let user = sqlx::query_as!(
            UserRow,
            r#"
            SELECT id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at, haruspex_user_id, metadata
            FROM user_accountz
            WHERE id = ?1
            "#,
            user_id
        )
        .fetch_optional(&pool)
        .await?;

        Ok(user.map(User::from))
    }

    /// Find a user by username
    pub async fn find_user_by_username(&self, username: &str) -> AuthResult<Option<User>> {
        let pool = database::connect().await?;

        let user = sqlx::query_as!(
            UserRow,
            r#"
            SELECT id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at, haruspex_user_id, metadata
            FROM user_accountz
            WHERE username = ?1
            "#,
            username
        )
        .fetch_optional(&pool)
        .await?;

        Ok(user.map(User::from))
    }

    /// Find a user by API key
    pub async fn find_user_by_api_key(&self, api_key: &str) -> AuthResult<Option<User>> {
        let pool = database::connect().await?;

        let user = sqlx::query_as!(
            UserRow,
            r#"
            SELECT id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at, haruspex_user_id, metadata
            FROM user_accountz
            WHERE api_key = ?1 AND deleted_at IS NULL
            "#,
            api_key
        )
        .fetch_optional(&pool)
        .await?;

        Ok(user.map(User::from))
    }

    /// Find the first root user (oldest by created_at)
    pub async fn find_first_root_user(&self) -> AuthResult<Option<User>> {
        let pool = database::connect().await?;

        let user = sqlx::query_as!(
            UserRow,
            r#"
            SELECT id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at, haruspex_user_id, metadata
            FROM user_accountz
            WHERE role = 'root' AND deleted_at IS NULL
            ORDER BY created_at ASC
            LIMIT 1
            "#,
        )
        .fetch_optional(&pool)
        .await?;

        Ok(user.map(User::from))
    }

    /// Update a user account
    pub async fn update_user(
        &self,
        user_id: &str,
        request: &UpdateUserRequest,
    ) -> AuthResult<User> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();

        // Update role if provided
        if let Some(role) = &request.role {
            let role_string = role.to_string();
            sqlx::query!(
                r#"
                UPDATE user_accountz
                SET role = ?1, updated_at = ?2
                WHERE id = ?3
                "#,
                role_string,
                now,
                user_id
            )
            .execute(&pool)
            .await?;
        } else {
            // Just update the timestamp
            sqlx::query!(
                r#"
                UPDATE user_accountz
                SET updated_at = ?1
                WHERE id = ?2
                "#,
                now,
                user_id
            )
            .execute(&pool)
            .await?;
        }

        // Return the updated user
        self.find_user_by_id(user_id)
            .await?
            .ok_or(AuthError::UserNotFound)
    }

    /// update a user's username
    pub async fn update_username(&self, user_id: &str, username: &str) -> AuthResult<User> {
        let pool = database::connect().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        sqlx::query!(
            r#"
            UPDATE user_accountz
            SET username = ?1, updated_at = ?2
            WHERE id = ?3
            "#,
            username,
            now,
            user_id
        )
        .execute(&pool)
        .await?;
        self.find_user_by_id(user_id)
            .await?
            .ok_or(AuthError::UserNotFound)
    }

    /// Set or update a user's API key
    pub async fn set_api_key(&self, user_id: &str, api_key: &str) -> AuthResult<User> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();

        sqlx::query!(
            r#"
            UPDATE user_accountz
            SET api_key = ?1, updated_at = ?2
            WHERE id = ?3
            "#,
            api_key,
            now,
            user_id
        )
        .execute(&pool)
        .await?;

        // Return the updated user
        self.find_user_by_id(user_id)
            .await?
            .ok_or(AuthError::UserNotFound)
    }

    /// Soft delete a user account.
    ///
    /// also cascade-soft-deletes all of the user's currently-active devices.
    /// device state lives in haruspex's own database, so it can't share
    /// this transaction - the cascade runs as a best-effort follow-up once
    /// the user row itself is committed as deleted. (the legacy
    /// `user_peer_nodez` cascade below is kept for rows still tracked
    /// there from before this cutover; it's a no-op for anything added
    /// since.)
    pub async fn delete_user(&self, user_id: &str) -> AuthResult<()> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();
        let mut tx = pool.begin().await?;

        sqlx::query!(
            r#"
            UPDATE user_accountz
            SET deleted_at = ?1, updated_at = ?1
            WHERE id = ?2
            "#,
            now,
            user_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            r#"
            UPDATE user_peer_nodez
            SET deleted_at = ?1
            WHERE user_id = ?2 AND deleted_at IS NULL
            "#,
            now,
            user_id
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        let identities = identity_store().await?;
        let identity_id = haruspex_bridge::identity_id_for_existing_user(user_id);
        for device in identities.devices_for_identity(identity_id).await? {
            if device.deleted_at.is_none() {
                identities.remove_device(&device.node_id).await?;
            }
        }

        Ok(())
    }

    /// List users with pagination and filtering
    pub async fn list_users(&self, params: &UserQueryParams) -> AuthResult<Vec<User>> {
        let pool = database::connect().await?;

        // Use static query with SQL NULL handling for optional filters
        let username_pattern = params.username.as_ref().map(|u| format!("%{}%", u));
        let role_str = params.role.as_ref().map(|r| r.to_string());
        let include_deleted = params.include_deleted.unwrap_or(false);

        let rows = sqlx::query_as!(
            UserRow,
            r#"
            SELECT id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at, haruspex_user_id, metadata
            FROM user_accountz
            WHERE (?1 IS NULL OR username LIKE ?1)
              AND (?2 IS NULL OR role = ?2)
              AND (?3 = 1 OR deleted_at IS NULL)
            ORDER BY created_at DESC
            LIMIT COALESCE(?4, -1)
            OFFSET COALESCE(?5, 0)
            "#,
            username_pattern,
            role_str,
            include_deleted,
            params.limit,
            params.offset
        )
        .fetch_all(&pool)
        .await?;

        let users: Vec<User> = rows.into_iter().map(|row| row.into()).collect();

        Ok(users)
    }

    /// Create an invite code
    pub async fn create_invite_code(
        &self,
        code: &str,
        request: &CreateInviteCodeRequest,
    ) -> AuthResult<InviteCode> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();
        let code_type = request.code_type.unwrap_or_default().to_string();
        let expires_at = request
            .expires_hours
            .map(|hours| now + (hours as i64 * 3600));
        let grants_role = request.grants_role.unwrap_or(UserRole::Member).to_string();

        let row = sqlx::query_as!(
            InviteCodeRow,
            r#"
            INSERT INTO invite_codez (code, created_at, is_active, code_type, link_for_user_id, link_expires_at, grants_role)
            VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6)
            RETURNING id as "id!", code as "code!", created_at as "created_at!", used_at, used_by_id, is_active as "is_active!", code_type as "code_type!", link_for_user_id, link_expires_at, grants_role as "grants_role!"
            "#,
            code,
            now,
            code_type,
            request.link_for_user_id,
            expires_at,
            grants_role
        )
        .fetch_one(&pool)
        .await?;

        Ok(InviteCode::from(row))
    }

    /// Find an invite code by code string
    pub async fn find_invite_code(&self, code: &str) -> AuthResult<Option<InviteCode>> {
        let pool = database::connect().await?;

        let invite_code = sqlx::query_as!(
            InviteCodeRow,
            r#"
            SELECT id as "id!", code as "code!", created_at as "created_at!", used_at, used_by_id, is_active as "is_active!", code_type as "code_type!", link_for_user_id, link_expires_at, grants_role as "grants_role!"
            FROM invite_codez
            WHERE code = ?1
            "#,
            code
        )
        .fetch_optional(&pool)
        .await?;

        Ok(invite_code.map(InviteCode::from))
    }

    /// Mark an invite code as used
    pub async fn use_invite_code(&self, code: &str, used_by_id: &str) -> AuthResult<()> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();

        sqlx::query!(
            r#"
            UPDATE invite_codez
            SET used_at = ?1, used_by_id = ?2
            WHERE code = ?3
            "#,
            now,
            used_by_id,
            code
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// List invite codes with filtering
    pub async fn list_invite_codes(&self, active_only: bool) -> AuthResult<Vec<InviteCode>> {
        let pool = database::connect().await?;

        let rows = if active_only {
            sqlx::query_as!(
                InviteCodeRow,
                r#"
                SELECT id as "id!", code as "code!", created_at as "created_at!", used_at, used_by_id, is_active as "is_active!", code_type as "code_type!", link_for_user_id, link_expires_at, grants_role as "grants_role!"
                FROM invite_codez
                WHERE is_active = 1 AND used_at IS NULL
                ORDER BY created_at DESC
                "#
            ).fetch_all(&pool).await?
        } else {
            sqlx::query_as!(
                InviteCodeRow,
                r#"
                SELECT id as "id!", code as "code!", created_at as "created_at!", used_at, used_by_id, is_active as "is_active!", code_type as "code_type!", link_for_user_id, link_expires_at, grants_role as "grants_role!"
                FROM invite_codez
                ORDER BY created_at DESC
                "#
            ).fetch_all(&pool).await?
        };

        let invite_codes: Vec<InviteCode> = rows.into_iter().map(InviteCode::from).collect();

        Ok(invite_codes)
    }

    /// Deactivate an invite code
    pub async fn deactivate_invite_code(&self, code: &str) -> AuthResult<()> {
        let pool = database::connect().await?;

        sqlx::query!(
            r#"
            UPDATE invite_codez
            SET is_active = 0
            WHERE code = ?1
            "#,
            code
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// Deactivate an account-link invite code that belongs to a specific user.
    /// used for self-service revocation - only deactivates if link_for_user_id matches.
    pub async fn deactivate_own_invite_code(&self, code: &str, user_id: &str) -> AuthResult<bool> {
        let pool = database::connect().await?;
        let rows = sqlx::query!(
            r#"
            UPDATE invite_codez
            SET is_active = 0
            WHERE code = ?1 AND link_for_user_id = ?2 AND is_active = 1
            "#,
            code,
            user_id,
        )
        .execute(&pool)
        .await?
        .rows_affected();
        Ok(rows > 0)
    }

    /// List active account-link codes belonging to a specific user.
    pub async fn list_own_invite_codes(&self, user_id: &str) -> AuthResult<Vec<InviteCode>> {
        let pool = database::connect().await?;
        let rows = sqlx::query_as!(
            InviteCodeRow,
            r#"
            SELECT id as "id!", code as "code!", created_at as "created_at!", used_at, used_by_id, is_active as "is_active!", code_type as "code_type!", link_for_user_id, link_expires_at, grants_role as "grants_role!"
            FROM invite_codez
            WHERE link_for_user_id = ?1 AND is_active = 1 AND used_at IS NULL AND code_type = 'account_link'
            ORDER BY created_at DESC
            "#,
            user_id,
        )
        .fetch_all(&pool)
        .await?;
        Ok(rows.into_iter().map(InviteCode::from).collect())
    }

    /// Deactivate all active invite codes that haven't been used
    pub async fn deactivate_all_active_invites(&self) -> AuthResult<u64> {
        let pool = database::connect().await?;

        let rows_affected = sqlx::query!(
            r#"
            UPDATE invite_codez
            SET is_active = 0
            WHERE is_active = 1 AND used_by_id IS NULL
            "#
        )
        .execute(&pool)
        .await?
        .rows_affected();

        Ok(rows_affected)
    }

    /// Update the role granted by an invite code
    pub async fn update_invite_role(&self, code: &str, role: &UserRole) -> AuthResult<()> {
        let pool = database::connect().await?;

        let role_str = role.to_string();

        sqlx::query!(
            r#"
            UPDATE invite_codez
            SET grants_role = ?1
            WHERE code = ?2 AND is_active = 1 AND used_at IS NULL
            "#,
            role_str,
            code
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    // ========================================================================
    // Federation / P2P methods
    // ========================================================================

    /// Find a user by their haruspex (Supabase) user ID
    pub async fn find_user_by_haruspex_id(
        &self,
        haruspex_user_id: &str,
    ) -> AuthResult<Option<User>> {
        let pool = database::connect().await?;

        let user = sqlx::query_as!(
            UserRow,
            r#"
            SELECT id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at, haruspex_user_id, metadata
            FROM user_accountz
            WHERE haruspex_user_id = ?1 AND deleted_at IS NULL
            "#,
            haruspex_user_id
        )
        .fetch_optional(&pool)
        .await?;

        Ok(user.map(User::from))
    }

    /// Find a user by haruspex_user_id, including soft-deleted users
    pub async fn find_user_by_haruspex_id_include_deleted(
        &self,
        haruspex_user_id: &str,
    ) -> AuthResult<Option<User>> {
        let pool = database::connect().await?;

        let user = sqlx::query_as!(
            UserRow,
            r#"
            SELECT id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at, haruspex_user_id, metadata
            FROM user_accountz
            WHERE haruspex_user_id = ?1
            "#,
            haruspex_user_id
        )
        .fetch_optional(&pool)
        .await?;

        Ok(user.map(User::from))
    }

    /// Restore a soft-deleted user (set deleted_at = NULL).
    ///
    /// also restores any legacy `user_peer_nodez` rows that were
    /// cascade-soft-deleted in the same operation as this user (matched by
    /// identical `deleted_at` timestamp) - kept for rows tracked there from
    /// before this cutover. devices tracked in haruspex are NOT
    /// auto-restored here: haruspex's `remove_device` stamps its own
    /// `deleted_at` internally rather than accepting one, so there's no
    /// reliable way to tell a device that was cascade-deleted alongside
    /// this user apart from one removed individually beforehand. restore
    /// those explicitly via `restore_peer_node` after restoring the user.
    pub async fn restore_user(&self, user_id: &str) -> AuthResult<User> {
        let pool = database::connect().await?;
        let mut tx = pool.begin().await?;

        // capture the existing deleted_at before clearing it so we can
        // restore peers that share its exact timestamp (cascade siblings).
        let prior: Option<i64> =
            sqlx::query_scalar!("SELECT deleted_at FROM user_accountz WHERE id = ?", user_id)
                .fetch_optional(&mut *tx)
                .await?
                .flatten();

        let now = OffsetDateTime::now_utc().unix_timestamp();
        sqlx::query!(
            r#"UPDATE user_accountz SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2"#,
            now,
            user_id
        )
        .execute(&mut *tx)
        .await?;

        if let Some(ts) = prior {
            sqlx::query!(
                r#"
                UPDATE user_peer_nodez
                SET deleted_at = NULL
                WHERE user_id = ?1 AND deleted_at = ?2
                "#,
                user_id,
                ts
            )
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        self.find_user_by_id(user_id)
            .await?
            .ok_or(AuthError::UserNotFound)
    }

    /// permanently delete a user account and all of its data ("delete forever").
    ///
    /// this bypasses soft-delete entirely. it cleans up FK references that
    /// don't have ON DELETE CASCADE in their schema (knock_requests,
    /// account_link_codes, feed_eventz, jobs) before deleting the
    /// user_accountz row. cascading FKs (invitez, user_preferences,
    /// listen_sessions, user_peer_nodez, user_favoritez, user_ratingz,
    /// haruspex_*) are handled automatically by sqlite.
    ///
    /// note: feed_eventz authored by this user (`created_by_user_id` is
    /// NOT NULL) are deleted outright, since the row cannot exist without
    /// an author. nullable references (`processed_by`, `updated_by_user_id`,
    /// `used_by_id`, `link_for_user_id`, `jobs.user_id`) are NULLed out
    /// to preserve the historical row.
    pub async fn hard_delete_user(&self, user_id: &str) -> AuthResult<()> {
        let pool = database::connect().await?;
        let mut tx = pool.begin().await?;

        // null out nullable FKs to preserve history rows
        sqlx::query!(
            "UPDATE media_eventz SET user_id = NULL WHERE user_id = ?",
            user_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "UPDATE music_play_eventz SET user_id = NULL WHERE user_id = ?",
            user_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "UPDATE knock_requestz SET processed_by = NULL WHERE processed_by = ?",
            user_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "UPDATE invite_codez SET used_by_id = NULL WHERE used_by_id = ?",
            user_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "UPDATE invite_codez SET link_for_user_id = NULL WHERE link_for_user_id = ?",
            user_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "UPDATE feed_eventz SET updated_by_user_id = NULL WHERE updated_by_user_id = ?",
            user_id
        )
        .execute(&mut *tx)
        .await?;

        // delete rows whose required FK points at this user
        sqlx::query!(
            "DELETE FROM feed_eventz WHERE created_by_user_id = ?",
            user_id
        )
        .execute(&mut *tx)
        .await?;

        // finally drop the user; ON DELETE CASCADE handles the rest
        sqlx::query!("DELETE FROM user_accountz WHERE id = ?", user_id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        // haruspex owns its own database, so the identity + everything
        // hanging off it (devices, credentials, api keys) isn't reachable
        // through grimoire's own foreign keys - purge it directly.
        // `IdentityStore` has no hard-delete-identity method, so this
        // reaches past the trait the same way the peer-node hard-delete
        // stopgaps below do; haruspex's own cascading FKs (`device_nodez`,
        // `credentialz`, `api_keyz` all reference `identityz(id) ON DELETE
        // CASCADE`) take care of the rest in one statement.
        let haruspex_pool = database::connect_haruspex().await?;
        let identity_id = haruspex_bridge::identity_id_for_existing_user(user_id).to_string();
        sqlx::query("DELETE FROM identityz WHERE id = ?1")
            .bind(&identity_id)
            .execute(&haruspex_pool)
            .await?;

        Ok(())
    }

    /// Find a user by their iroh peer node_id.
    ///
    /// resolves through haruspex's device/identity store rather than a
    /// local join: the node id must map to an active (non-soft-deleted)
    /// device, whose identity must be linked to an active grimoire user.
    pub async fn find_user_by_node_id(&self, node_id: &str) -> AuthResult<Option<User>> {
        let identities = identity_store().await?;

        let device = match identities.resolve_device(node_id).await? {
            Some(d) if d.deleted_at.is_none() => d,
            _ => return Ok(None),
        };

        let grimoire_user_id =
            match haruspex_bridge::grimoire_user_id_for_identity(&identities, device.identity_id)
                .await?
            {
                Some(id) => id,
                None => return Ok(None),
            };

        match self.find_user_by_id(&grimoire_user_id).await? {
            Some(user) if user.deleted_at.is_none() => Ok(Some(user)),
            _ => Ok(None),
        }
    }

    /// Create a user with haruspex identity (for federation sync)
    pub async fn create_federated_user(
        &self,
        username: &str,
        haruspex_user_id: &str,
        role: UserRole,
        avatar_url: Option<&str>,
    ) -> AuthResult<User> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();
        let role_str = role.to_string();
        let metadata = avatar_url.map(|url| format!(r#"{{"avatar_url":"{}"}}"#, url));

        let row = sqlx::query_as!(
            UserRow,
            r#"
            INSERT INTO user_accountz (username, role, haruspex_user_id, metadata, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            RETURNING id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at, haruspex_user_id, metadata
            "#,
            username,
            role_str,
            haruspex_user_id,
            metadata,
            now,
            now
        )
        .fetch_one(&pool)
        .await?;

        Ok(User::from(row))
    }

    /// Update a federated user's profile (username and avatar)
    pub async fn update_federated_user_profile(
        &self,
        user_id: &str,
        username: &str,
        avatar_url: Option<&str>,
    ) -> AuthResult<User> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();
        // use json_patch to merge avatar_url into existing metadata
        let metadata_patch = avatar_url
            .map(|url| format!(r#"{{"avatar_url":"{}"}}"#, url))
            .unwrap_or_else(|| "{}".to_string());

        let row = sqlx::query_as!(
            UserRow,
            r#"
            UPDATE user_accountz
            SET username = ?1, metadata = json_patch(COALESCE(metadata, '{}'), ?2), updated_at = ?3
            WHERE id = ?4
            RETURNING id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at, haruspex_user_id, metadata
            "#,
            username,
            metadata_patch,
            now,
            user_id
        )
        .fetch_one(&pool)
        .await?;

        Ok(User::from(row))
    }

    /// Update a user's haruspex_user_id
    pub async fn set_haruspex_user_id(
        &self,
        user_id: &str,
        haruspex_user_id: &str,
    ) -> AuthResult<()> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();

        sqlx::query!(
            r#"
            UPDATE user_accountz
            SET haruspex_user_id = ?1, updated_at = ?2
            WHERE id = ?3
            "#,
            haruspex_user_id,
            now,
            user_id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// Add or update a peer node_id for a user.
    ///
    /// device state lives in haruspex's own database, keyed by identity id
    /// rather than grimoire's user id - `haruspex_bridge` translates
    /// between the two, creating the haruspex identity on first use if one
    /// doesn't exist yet.
    pub async fn upsert_peer_node(
        &self,
        user_id: &str,
        node_id: &str,
        instance_name: Option<&str>,
    ) -> AuthResult<UserPeerNode> {
        let user = self
            .find_user_by_id(user_id)
            .await?
            .ok_or(AuthError::UserNotFound)?;

        let identities = identity_store().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let identity_id =
            haruspex_bridge::ensure_identity_for_user(&identities, &user.id, &user.username, now)
                .await?;

        let device = identities
            .add_device(haruspex::identity::DeviceNode {
                identity_id,
                node_id: node_id.to_string(),
                instance_name: instance_name.map(str::to_string),
                last_seen_at: now,
                deleted_at: None,
            })
            .await?;

        Ok(device_to_peer_node(device, user_id))
    }

    /// Get peer nodes for a user.
    ///
    /// `include_deleted = true` returns soft-deleted rows alongside
    /// active ones (used by the admin ui's "show deleted" toggle).
    pub async fn get_user_peer_nodes(
        &self,
        user_id: &str,
        include_deleted: bool,
    ) -> AuthResult<Vec<UserPeerNode>> {
        let identities = identity_store().await?;
        let identity_id = haruspex_bridge::identity_id_for_existing_user(user_id);
        let devices = identities.devices_for_identity(identity_id).await?;

        Ok(devices
            .into_iter()
            .filter(|d| include_deleted || d.deleted_at.is_none())
            .map(|d| device_to_peer_node(d, user_id))
            .collect())
    }

    /// Soft-delete a peer node (sets `deleted_at`).
    ///
    /// the node id stays reserved (haruspex's global unique index on
    /// `device_nodez.node_id` covers soft-deleted rows too). use
    /// `restore_peer_node` to bring it back, or `hard_delete_peer_node`
    /// for permanent removal (currently only available via cli).
    ///
    /// a no-op if `node_id` isn't currently registered to `user_id` -
    /// matches the prior behavior of scoping the update to `(user_id,
    /// node_id)` so a mismatched owner silently does nothing.
    pub async fn remove_peer_node(&self, user_id: &str, node_id: &str) -> AuthResult<()> {
        let identities = identity_store().await?;
        let identity_id = haruspex_bridge::identity_id_for_existing_user(user_id);

        if let Some(device) = identities.resolve_device(node_id).await? {
            if device.identity_id == identity_id {
                identities.remove_device(node_id).await?;
            }
        }

        Ok(())
    }

    /// Restore a soft-deleted peer node (clears `deleted_at`), preserving
    /// its existing `instance_name`/`last_seen_at`. a no-op if `node_id`
    /// isn't currently registered to `user_id`.
    pub async fn restore_peer_node(&self, user_id: &str, node_id: &str) -> AuthResult<()> {
        let identities = identity_store().await?;
        let identity_id = haruspex_bridge::identity_id_for_existing_user(user_id);

        if let Some(device) = identities.resolve_device(node_id).await? {
            if device.identity_id == identity_id {
                identities
                    .add_device(haruspex::identity::DeviceNode {
                        identity_id,
                        node_id: node_id.to_string(),
                        instance_name: None,
                        last_seen_at: device.last_seen_at,
                        deleted_at: None,
                    })
                    .await?;
            }
        }

        Ok(())
    }

    /// Permanently delete a peer node row (hard DELETE).
    ///
    /// reserved for cleanup tooling — the normal admin ui uses
    /// `remove_peer_node` (soft) so the node_id stays reserved and the
    /// row remains visible behind the "show deleted" toggle.
    ///
    /// `IdentityStore` has no hard-delete-device method (only the soft
    /// `remove_device`), so this reaches past the trait and deletes the
    /// row directly out of haruspex's own `device_nodez` table - a
    /// stopgap until haruspex grows a real hard-delete operation (the
    /// same kind of gap as `CredentialStore`'s missing rename method from
    /// the webauthn cutover).
    pub async fn hard_delete_peer_node(&self, user_id: &str, node_id: &str) -> AuthResult<()> {
        let pool = database::connect_haruspex().await?;
        let identity_id = haruspex_bridge::identity_id_for_existing_user(user_id).to_string();

        sqlx::query("DELETE FROM device_nodez WHERE identity_id = ?1 AND node_id = ?2")
            .bind(&identity_id)
            .bind(node_id)
            .execute(&pool)
            .await?;

        Ok(())
    }

    /// Permanently delete every peer-node row for the given node id,
    /// regardless of user ownership. returns rows deleted.
    ///
    /// same trait-gap stopgap as `hard_delete_peer_node`.
    pub async fn hard_delete_peer_node_by_node_id(&self, node_id: &str) -> AuthResult<u64> {
        let pool = database::connect_haruspex().await?;

        let result = sqlx::query("DELETE FROM device_nodez WHERE node_id = ?1")
            .bind(node_id)
            .execute(&pool)
            .await?;

        Ok(result.rows_affected())
    }

    /// Move a peer-node mapping to a different user and clear any
    /// soft-delete marker on that peer row.
    ///
    /// `IdentityStore::add_device` enforces the opposite of what a
    /// reassign needs - it refuses to move a node id onto a different
    /// identity - so this deliberately bypasses the trait and updates
    /// haruspex's own `device_nodez` row directly, the same stopgap
    /// pattern as `hard_delete_peer_node`. ensures the target user has a
    /// haruspex identity first, since the row's foreign key requires one.
    pub async fn reassign_peer_node_user(&self, node_id: &str, user_id: &str) -> AuthResult<()> {
        let user = self
            .find_user_by_id(user_id)
            .await?
            .ok_or(AuthError::UserNotFound)?;

        let identities = identity_store().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let identity_id =
            haruspex_bridge::ensure_identity_for_user(&identities, &user.id, &user.username, now)
                .await?;

        let pool = database::connect_haruspex().await?;
        let result = sqlx::query(
            "UPDATE device_nodez SET identity_id = ?1, deleted_at = NULL WHERE node_id = ?2",
        )
        .bind(identity_id.to_string())
        .bind(node_id)
        .execute(&pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AuthError::UserNotFound);
        }

        Ok(())
    }

    /// Update last_seen_at for a peer node (for tracking active connections).
    /// no-op for soft-deleted rows.
    pub async fn touch_peer_node(&self, node_id: &str) -> AuthResult<()> {
        let identities = identity_store().await?;

        if let Some(device) = identities.resolve_device(node_id).await? {
            if device.deleted_at.is_none() {
                let now = OffsetDateTime::now_utc().unix_timestamp();
                identities.touch_device(node_id, now).await?;
            }
        }

        Ok(())
    }

    /// Get all peer nodes across all users with username info.
    ///
    /// `include_deleted = true` includes soft-deleted peer rows AND
    /// peer rows whose owning user has been soft-deleted (cascade or
    /// orphan). active peers under active users are always included.
    ///
    /// `IdentityStore` only exposes devices scoped to one identity at a
    /// time, so this composes the listing by walking every grimoire user
    /// and resolving their devices in turn, rather than a single join -
    /// fine for an admin listing, not a hot path.
    pub async fn get_all_peer_nodes(
        &self,
        include_deleted: bool,
    ) -> AuthResult<Vec<PeerNodeWithUser>> {
        let identities = identity_store().await?;
        let users = self
            .list_users(&UserQueryParams {
                include_deleted: Some(true),
                ..Default::default()
            })
            .await?;

        let mut result = Vec::new();
        for user in users {
            let identity_id = haruspex_bridge::identity_id_for_existing_user(&user.id);
            for device in identities.devices_for_identity(identity_id).await? {
                let active = device.deleted_at.is_none() && user.deleted_at.is_none();
                if !include_deleted && !active {
                    continue;
                }
                result.push(PeerNodeWithUser {
                    user_id: user.id.clone(),
                    node_id: device.node_id,
                    instance_name: device.instance_name,
                    created_at: device.last_seen_at,
                    last_seen_at: Some(device.last_seen_at),
                    username: user.username.clone(),
                    role: user.role.to_string(),
                    deleted_at: device.deleted_at,
                    user_deleted_at: user.deleted_at,
                });
            }
        }

        result.sort_by_key(|p| std::cmp::Reverse(p.created_at));
        Ok(result)
    }

    /// Check if any active peer nodes exist (efficient existence check).
    /// soft-deleted peer rows and peers under soft-deleted users do not
    /// count.
    pub async fn has_peer_nodes(&self) -> AuthResult<bool> {
        let identities = identity_store().await?;
        let users = self.list_users(&UserQueryParams::default()).await?;

        for user in users {
            let identity_id = haruspex_bridge::identity_id_for_existing_user(&user.id);
            let devices = identities.devices_for_identity(identity_id).await?;
            if devices.iter().any(|d| d.deleted_at.is_none()) {
                return Ok(true);
            }
        }

        Ok(false)
    }
}

impl Default for UserRepository {
    fn default() -> Self {
        Self::new()
    }
}

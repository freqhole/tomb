//! User repository for database operations
//!
//! This module handles all database interactions for the user system,
//! including users, invite codes, favorites, ratings, and sessions.

use crate::database;
use crate::users::models::*;
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

/// Database row struct for user_peer_nodez table
#[derive(Debug)]
struct UserPeerNodeRow {
    user_id: String,
    node_id: String,
    instance_name: Option<String>,
    metadata: Option<String>,
    created_at: i64,
    last_seen_at: Option<i64>,
    deleted_at: Option<i64>,
}

impl From<UserPeerNodeRow> for UserPeerNode {
    fn from(row: UserPeerNodeRow) -> Self {
        UserPeerNode {
            user_id: row.user_id,
            node_id: row.node_id,
            instance_name: row.instance_name,
            metadata: row.metadata,
            created_at: row.created_at,
            last_seen_at: row.last_seen_at,
            deleted_at: row.deleted_at,
        }
    }
}

/// Database row struct for peer nodes joined with user info
#[derive(Debug)]
struct PeerNodeWithUserRow {
    user_id: String,
    node_id: String,
    instance_name: Option<String>,
    created_at: i64,
    last_seen_at: Option<i64>,
    username: String,
    role: String,
    deleted_at: Option<i64>,
    user_deleted_at: Option<i64>,
}

impl From<PeerNodeWithUserRow> for PeerNodeWithUser {
    fn from(row: PeerNodeWithUserRow) -> Self {
        PeerNodeWithUser {
            user_id: row.user_id,
            node_id: row.node_id,
            instance_name: row.instance_name,
            created_at: row.created_at,
            last_seen_at: row.last_seen_at,
            username: row.username,
            role: row.role,
            deleted_at: row.deleted_at,
            user_deleted_at: row.user_deleted_at,
        }
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
    /// also cascade-soft-deletes all of the user's currently-active peer
    /// nodes (`user_peer_nodez`) within the same transaction, stamping
    /// them with the same `deleted_at` timestamp. peers that were already
    /// soft-deleted at a different timestamp (e.g. removed individually
    /// before the user delete) are left untouched, so a subsequent
    /// `restore_user` can selectively restore only the peers that were
    /// cascade-deleted with the user.
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
    /// also restores any peer nodes that were cascade-soft-deleted in the
    /// same operation as this user (matched by identical `deleted_at`
    /// timestamp). peers individually soft-deleted at a different time
    /// stay deleted and must be restored individually.
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
        Ok(())
    }

    /// Find a user by their iroh peer node_id
    pub async fn find_user_by_node_id(&self, node_id: &str) -> AuthResult<Option<User>> {
        let pool = database::connect().await?;

        let user = sqlx::query_as!(
            UserRow,
            r#"
            SELECT u.id as "id!", u.username as "username!", u.role as "role!", u.api_key, u.created_at as "created_at!", u.updated_at as "updated_at!", u.deleted_at, u.haruspex_user_id, u.metadata
            FROM user_accountz u
            INNER JOIN user_peer_nodez p ON u.id = p.user_id
            WHERE p.node_id = ?1
              AND u.deleted_at IS NULL
              AND p.deleted_at IS NULL
            "#,
            node_id
        )
        .fetch_optional(&pool)
        .await?;

        Ok(user.map(User::from))
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

    /// Add or update a peer node_id for a user
    pub async fn upsert_peer_node(
        &self,
        user_id: &str,
        node_id: &str,
        instance_name: Option<&str>,
    ) -> AuthResult<UserPeerNode> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();

        let row = sqlx::query_as!(
            UserPeerNodeRow,
            r#"
            INSERT INTO user_peer_nodez (user_id, node_id, instance_name, created_at, last_seen_at)
            VALUES (?1, ?2, ?3, ?4, ?4)
            ON CONFLICT (user_id, node_id) DO UPDATE SET
                instance_name = COALESCE(?3, instance_name),
                last_seen_at = ?4
            RETURNING user_id as "user_id!", node_id as "node_id!", instance_name, metadata, created_at as "created_at!", last_seen_at, deleted_at
            "#,
            user_id,
            node_id,
            instance_name,
            now
        )
        .fetch_one(&pool)
        .await?;

        Ok(UserPeerNode::from(row))
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
        let pool = database::connect().await?;

        let rows = sqlx::query_as!(
            UserPeerNodeRow,
            r#"
            SELECT user_id as "user_id!", node_id as "node_id!", instance_name, metadata, created_at as "created_at!", last_seen_at, deleted_at
            FROM user_peer_nodez
            WHERE user_id = ?1
              AND (?2 OR deleted_at IS NULL)
            ORDER BY last_seen_at DESC NULLS LAST
            "#,
            user_id,
            include_deleted
        )
        .fetch_all(&pool)
        .await?;

        Ok(rows.into_iter().map(UserPeerNode::from).collect())
    }

    /// Soft-delete a peer node (sets `deleted_at`).
    ///
    /// the row stays in the table so its node_id is still reserved (the
    /// global UNIQUE index includes deleted rows). use
    /// `restore_peer_node` to bring it back, or `hard_delete_peer_node`
    /// for permanent removal (currently only available via cli).
    pub async fn remove_peer_node(&self, user_id: &str, node_id: &str) -> AuthResult<()> {
        let pool = database::connect().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();

        sqlx::query!(
            r#"
            UPDATE user_peer_nodez
            SET deleted_at = ?1
            WHERE user_id = ?2 AND node_id = ?3 AND deleted_at IS NULL
            "#,
            now,
            user_id,
            node_id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// Restore a soft-deleted peer node (clears `deleted_at`).
    pub async fn restore_peer_node(&self, user_id: &str, node_id: &str) -> AuthResult<()> {
        let pool = database::connect().await?;

        sqlx::query!(
            r#"
            UPDATE user_peer_nodez
            SET deleted_at = NULL
            WHERE user_id = ?1 AND node_id = ?2
            "#,
            user_id,
            node_id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// Permanently delete a peer node row (hard DELETE).
    ///
    /// reserved for cleanup tooling — the normal admin ui uses
    /// `remove_peer_node` (soft) so the node_id stays reserved and the
    /// row remains visible behind the "show deleted" toggle.
    pub async fn hard_delete_peer_node(&self, user_id: &str, node_id: &str) -> AuthResult<()> {
        let pool = database::connect().await?;

        sqlx::query!(
            r#"
            DELETE FROM user_peer_nodez
            WHERE user_id = ?1 AND node_id = ?2
            "#,
            user_id,
            node_id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// Update last_seen_at for a peer node (for tracking active connections).
    /// no-op for soft-deleted rows.
    pub async fn touch_peer_node(&self, node_id: &str) -> AuthResult<()> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();

        sqlx::query!(
            r#"
            UPDATE user_peer_nodez
            SET last_seen_at = ?1
            WHERE node_id = ?2 AND deleted_at IS NULL
            "#,
            now,
            node_id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// Get all peer nodes across all users with username info.
    ///
    /// `include_deleted = true` includes soft-deleted peer rows AND
    /// peer rows whose owning user has been soft-deleted (cascade or
    /// orphan). active peers under active users are always included.
    pub async fn get_all_peer_nodes(
        &self,
        include_deleted: bool,
    ) -> AuthResult<Vec<PeerNodeWithUser>> {
        let pool = database::connect().await?;

        let rows = sqlx::query_as!(
            PeerNodeWithUserRow,
            r#"
            SELECT 
                p.user_id as "user_id!",
                p.node_id as "node_id!",
                p.instance_name,
                p.created_at as "created_at!",
                p.last_seen_at,
                u.username as "username!",
                u.role as "role!",
                p.deleted_at,
                u.deleted_at as "user_deleted_at"
            FROM user_peer_nodez p
            INNER JOIN user_accountz u ON p.user_id = u.id
            WHERE (?1 OR (u.deleted_at IS NULL AND p.deleted_at IS NULL))
            ORDER BY p.created_at DESC
            "#,
            include_deleted
        )
        .fetch_all(&pool)
        .await?;

        Ok(rows.into_iter().map(PeerNodeWithUser::from).collect())
    }

    /// Check if any active peer nodes exist (efficient existence check).
    /// soft-deleted peer rows and peers under soft-deleted users do not
    /// count.
    pub async fn has_peer_nodes(&self) -> AuthResult<bool> {
        let pool = database::connect().await?;

        let result: (i32,) = sqlx::query_as(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM user_peer_nodez p
                INNER JOIN user_accountz u ON p.user_id = u.id
                WHERE u.deleted_at IS NULL AND p.deleted_at IS NULL
            ) as has_peers
            "#,
        )
        .fetch_one(&pool)
        .await?;

        Ok(result.0 != 0)
    }
}

impl Default for UserRepository {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_repository_creation() {
        let _ = UserRepository::new();
        // Basic smoke test that repository can be created
        assert!(true);
    }
}

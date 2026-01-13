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
            RETURNING id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at
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
            SELECT id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at
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
            SELECT id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at
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
            SELECT id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at
            FROM user_accountz
            WHERE api_key = ?1 AND deleted_at IS NULL
            "#,
            api_key
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

    /// Soft delete a user account
    pub async fn delete_user(&self, user_id: &str) -> AuthResult<()> {
        let pool = database::connect().await?;

        let now = OffsetDateTime::now_utc().unix_timestamp();

        sqlx::query!(
            r#"
            UPDATE user_accountz
            SET deleted_at = ?1, updated_at = ?1
            WHERE id = ?2
            "#,
            now,
            user_id
        )
        .execute(&pool)
        .await?;

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
            SELECT id as "id!", username as "username!", role as "role!", api_key, created_at as "created_at!", updated_at as "updated_at!", deleted_at
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

        let row = sqlx::query_as!(
            InviteCodeRow,
            r#"
            INSERT INTO invite_codez (code, created_at, is_active, code_type, link_for_user_id, link_expires_at)
            VALUES (?1, ?2, 1, ?3, ?4, ?5)
            RETURNING id as "id!", code as "code!", created_at as "created_at!", used_at, used_by_id, is_active as "is_active!", code_type as "code_type!", link_for_user_id, link_expires_at
            "#,
            code,
            now,
            code_type,
            request.link_for_user_id,
            expires_at
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
            SELECT id as "id!", code as "code!", created_at as "created_at!", used_at, used_by_id, is_active as "is_active!", code_type as "code_type!", link_for_user_id, link_expires_at
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
                SELECT id as "id!", code as "code!", created_at as "created_at!", used_at, used_by_id, is_active as "is_active!", code_type as "code_type!", link_for_user_id, link_expires_at
                FROM invite_codez
                WHERE is_active = 1 AND used_at IS NULL
                ORDER BY created_at DESC
                "#
            ).fetch_all(&pool).await?
        } else {
            sqlx::query_as!(
                InviteCodeRow,
                r#"
                SELECT id as "id!", code as "code!", created_at as "created_at!", used_at, used_by_id, is_active as "is_active!", code_type as "code_type!", link_for_user_id, link_expires_at
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

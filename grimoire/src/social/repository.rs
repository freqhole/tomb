//! social repository — database operations for peer identity + social relationships
//!
//! operates on `peer_friendz`, `friend_requestz`, `friend_groupz` tables,
//! and profile/alias columns on `user_accountz` and `user_peer_nodez`.

use super::models::*;
use crate::database;
use crate::users::models::AuthResult;
use time::OffsetDateTime;

// -- row structs for sqlx query results --

#[derive(Debug)]
struct PeerFriendRow {
    id: String,
    user_id: String,
    friend_user_id: String,
    group_name: String,
    created_at: i64,
}

impl From<PeerFriendRow> for PeerFriend {
    fn from(row: PeerFriendRow) -> Self {
        PeerFriend {
            id: row.id,
            user_id: row.user_id,
            friend_user_id: row.friend_user_id,
            group_name: row.group_name,
            created_at: row.created_at,
        }
    }
}

#[derive(Debug)]
struct FriendRequestRow {
    id: String,
    user_id: String,
    remote_user_id: String,
    direction: String,
    status: String,
    created_at: i64,
    updated_at: i64,
    remote_username: String,
    remote_alias: String,
    remote_node_id: Option<String>,
    remote_display_name: Option<String>,
}

impl From<FriendRequestRow> for FriendRequest {
    fn from(row: FriendRequestRow) -> Self {
        FriendRequest {
            id: row.id,
            user_id: row.user_id,
            remote_user_id: row.remote_user_id,
            direction: row.direction,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at,
            remote_username: row.remote_username,
            remote_alias: row.remote_alias,
            remote_node_id: row.remote_node_id,
            remote_display_name: row.remote_display_name,
        }
    }
}

#[derive(Debug)]
struct FriendGroupRow {
    id: String,
    user_id: String,
    name: String,
    color: i64,
}

impl From<FriendGroupRow> for FriendGroup {
    fn from(row: FriendGroupRow) -> Self {
        FriendGroup {
            id: row.id,
            user_id: row.user_id,
            name: row.name,
            color: row.color,
        }
    }
}

#[derive(Debug)]
struct UserProfileRow {
    id: String,
    username: String,
    alias: String,
    bio: String,
    avatar_url: String,
    accent_color: i64,
}

#[derive(Debug)]
struct PeerNodeProfileRow {
    node_id: String,
    display_name: String,
    bio: String,
    avatar_url: String,
    accent_color: i64,
    instance_name: Option<String>,
    last_seen_at: Option<i64>,
    created_at: i64,
}

impl From<PeerNodeProfileRow> for PeerNodeProfile {
    fn from(row: PeerNodeProfileRow) -> Self {
        PeerNodeProfile {
            node_id: row.node_id,
            display_name: row.display_name,
            bio: row.bio,
            avatar_url: row.avatar_url,
            accent_color: row.accent_color,
            instance_name: row.instance_name,
            last_seen_at: row.last_seen_at,
            created_at: row.created_at,
        }
    }
}

/// row for the denormalized friend detail query (without node_ids, those are fetched separately)
#[derive(Debug)]
struct PeerFriendDetailRow {
    id: String,
    group_name: String,
    created_at: i64,
    friend_user_id: String,
    username: String,
    alias: String,
    bio: String,
    avatar_url: String,
    accent_color: i64,
}

// -- repository --

pub struct SocialRepository;

impl SocialRepository {
    pub fn new() -> Self {
        Self
    }

    // -- profile operations (user_accountz) --

    /// get a user's identity-level profile
    pub async fn get_profile(&self, user_id: &str) -> AuthResult<UserProfile> {
        let pool = database::connect().await?;

        let row = sqlx::query_as!(
            UserProfileRow,
            r#"
            SELECT id as "id!", username as "username!", alias as "alias!",
                   bio as "bio!", avatar_url as "avatar_url!", accent_color as "accent_color!"
            FROM user_accountz
            WHERE id = ?1 AND deleted_at IS NULL
            "#,
            user_id
        )
        .fetch_one(&pool)
        .await?;

        Ok(UserProfile {
            user_id: row.id,
            username: row.username,
            alias: row.alias,
            bio: row.bio,
            avatar_url: row.avatar_url,
            accent_color: row.accent_color,
            node_id: String::new(), // populated at runtime by caller
        })
    }

    /// update identity-level profile fields on user_accountz.
    /// only updates fields that are Some.
    pub async fn update_profile(
        &self,
        user_id: &str,
        req: &UpdateProfileRequest,
    ) -> AuthResult<()> {
        let pool = database::connect().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();

        // build SET clauses dynamically — only update provided fields
        // using COALESCE pattern: SET col = COALESCE(?param, col)
        sqlx::query!(
            r#"
            UPDATE user_accountz
            SET username = COALESCE(?1, username),
                alias = COALESCE(?2, alias),
                bio = COALESCE(?3, bio),
                avatar_url = COALESCE(?4, avatar_url),
                accent_color = COALESCE(?5, accent_color),
                updated_at = ?6
            WHERE id = ?7 AND deleted_at IS NULL
            "#,
            req.username,
            req.alias,
            req.bio,
            req.avatar_url,
            req.accent_color,
            now,
            user_id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// read social settings from user_accountz.metadata JSON
    pub async fn get_social_settings(&self, user_id: &str) -> AuthResult<SocialSettings> {
        let pool = database::connect().await?;

        let row: (Option<String>,) = sqlx::query_as(
            r#"SELECT metadata FROM user_accountz WHERE id = ?1 AND deleted_at IS NULL"#,
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await?;

        let settings = row
            .0
            .as_deref()
            .and_then(|m| serde_json::from_str::<SocialSettings>(m).ok())
            .unwrap_or_default();

        Ok(settings)
    }

    /// merge social settings into user_accountz.metadata JSON
    pub async fn update_social_settings(
        &self,
        user_id: &str,
        settings: &SocialSettings,
    ) -> AuthResult<()> {
        let pool = database::connect().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();

        let patch = serde_json::to_string(settings)
            .map_err(crate::users::models::AuthError::Serialization)?;

        sqlx::query!(
            r#"
            UPDATE user_accountz
            SET metadata = json_patch(COALESCE(metadata, '{}'), ?1),
                updated_at = ?2
            WHERE id = ?3 AND deleted_at IS NULL
            "#,
            patch,
            now,
            user_id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// update alias on a user_accountz row (used to label a friend's identity)
    pub async fn update_user_alias(&self, user_id: &str, alias: &str) -> AuthResult<()> {
        let pool = database::connect().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();

        sqlx::query!(
            r#"
            UPDATE user_accountz
            SET alias = ?1, updated_at = ?2
            WHERE id = ?3 AND deleted_at IS NULL
            "#,
            alias,
            now,
            user_id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    // -- per-node profile operations (user_peer_nodez) --

    /// update a specific node's self-reported profile fields
    pub async fn update_node_profile(
        &self,
        node_id: &str,
        req: &UpdateNodeProfileRequest,
    ) -> AuthResult<()> {
        let pool = database::connect().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();

        sqlx::query!(
            r#"
            UPDATE user_peer_nodez
            SET display_name = COALESCE(?1, display_name),
                bio = COALESCE(?2, bio),
                avatar_url = COALESCE(?3, avatar_url),
                accent_color = COALESCE(?4, accent_color),
                last_seen_at = ?5
            WHERE node_id = ?6
            "#,
            req.display_name,
            req.bio,
            req.avatar_url,
            req.accent_color,
            now,
            node_id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// get per-node profile for a specific node
    pub async fn get_node_profile(&self, node_id: &str) -> AuthResult<Option<PeerNodeProfile>> {
        let pool = database::connect().await?;

        let row = sqlx::query_as!(
            PeerNodeProfileRow,
            r#"
            SELECT node_id as "node_id!", display_name as "display_name!",
                   bio as "bio!", avatar_url as "avatar_url!", accent_color as "accent_color!",
                   instance_name, last_seen_at, created_at as "created_at!"
            FROM user_peer_nodez
            WHERE node_id = ?1
            "#,
            node_id
        )
        .fetch_optional(&pool)
        .await?;

        Ok(row.map(PeerNodeProfile::from))
    }

    /// get all node profiles for a user, ordered by most recently seen
    pub async fn get_node_profiles_for_user(
        &self,
        user_id: &str,
    ) -> AuthResult<Vec<PeerNodeProfile>> {
        let pool = database::connect().await?;

        let rows = sqlx::query_as!(
            PeerNodeProfileRow,
            r#"
            SELECT node_id as "node_id!", display_name as "display_name!",
                   bio as "bio!", avatar_url as "avatar_url!", accent_color as "accent_color!",
                   instance_name, last_seen_at, created_at as "created_at!"
            FROM user_peer_nodez
            WHERE user_id = ?1
            ORDER BY last_seen_at DESC NULLS LAST
            "#,
            user_id
        )
        .fetch_all(&pool)
        .await?;

        Ok(rows.into_iter().map(PeerNodeProfile::from).collect())
    }

    // -- friend operations (peer_friendz) --

    /// list all friends for a user, with denormalized identity + per-node profiles.
    /// this is the main read path for the friends list UI.
    pub async fn list_friends(&self, user_id: &str) -> AuthResult<Vec<PeerFriendDetail>> {
        let pool = database::connect().await?;

        // step 1: get friend rows joined with user_accountz
        let friend_rows = sqlx::query_as!(
            PeerFriendDetailRow,
            r#"
            SELECT
                pf.id as "id!",
                pf.group_name as "group_name!",
                pf.created_at as "created_at!",
                u.id as "friend_user_id!",
                u.username as "username!",
                u.alias as "alias!",
                u.bio as "bio!",
                u.avatar_url as "avatar_url!",
                u.accent_color as "accent_color!"
            FROM peer_friendz pf
            INNER JOIN user_accountz u ON pf.friend_user_id = u.id
            WHERE pf.user_id = ?1 AND u.deleted_at IS NULL
            ORDER BY pf.created_at DESC
            "#,
            user_id
        )
        .fetch_all(&pool)
        .await?;

        // step 2: for each friend, fetch their node profiles
        let mut friends = Vec::with_capacity(friend_rows.len());
        for row in friend_rows {
            let node_ids = self.get_node_profiles_for_user(&row.friend_user_id).await?;
            friends.push(PeerFriendDetail {
                id: row.id,
                group_name: row.group_name,
                created_at: row.created_at,
                friend_user_id: row.friend_user_id,
                username: row.username,
                alias: row.alias,
                bio: row.bio,
                avatar_url: row.avatar_url,
                accent_color: row.accent_color,
                node_ids,
            });
        }

        Ok(friends)
    }

    /// add a friend relationship
    pub async fn add_friend(
        &self,
        user_id: &str,
        friend_user_id: &str,
        group_name: Option<&str>,
    ) -> AuthResult<PeerFriend> {
        let pool = database::connect().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        let group = group_name.unwrap_or("");

        let row = sqlx::query_as!(
            PeerFriendRow,
            r#"
            INSERT INTO peer_friendz (user_id, friend_user_id, group_name, created_at)
            VALUES (?1, ?2, ?3, ?4)
            RETURNING id as "id!", user_id as "user_id!", friend_user_id as "friend_user_id!",
                      group_name as "group_name!", created_at as "created_at!"
            "#,
            user_id,
            friend_user_id,
            group,
            now
        )
        .fetch_one(&pool)
        .await?;

        Ok(PeerFriend::from(row))
    }

    /// update group assignment on a friendship
    pub async fn update_friend(&self, id: &str, group_name: Option<&str>) -> AuthResult<()> {
        let pool = database::connect().await?;

        sqlx::query!(
            r#"
            UPDATE peer_friendz
            SET group_name = COALESCE(?1, group_name)
            WHERE id = ?2
            "#,
            group_name,
            id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// remove a friend relationship
    pub async fn remove_friend(&self, id: &str) -> AuthResult<()> {
        let pool = database::connect().await?;

        sqlx::query!(r#"DELETE FROM peer_friendz WHERE id = ?1"#, id)
            .execute(&pool)
            .await?;

        Ok(())
    }

    /// check if a friendship exists between two users
    pub async fn is_friend(&self, user_id: &str, friend_user_id: &str) -> AuthResult<bool> {
        let pool = database::connect().await?;

        let result: (i32,) = sqlx::query_as(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM peer_friendz
                WHERE user_id = ?1 AND friend_user_id = ?2
            ) as is_friend
            "#,
        )
        .bind(user_id)
        .bind(friend_user_id)
        .fetch_one(&pool)
        .await?;

        Ok(result.0 != 0)
    }

    // -- friend request operations (friend_requestz) --

    /// list friend requests with denormalized remote user info
    pub async fn list_requests(
        &self,
        user_id: &str,
        direction: Option<&str>,
        status: Option<&str>,
    ) -> AuthResult<Vec<FriendRequest>> {
        let pool = database::connect().await?;

        // use a flexible query that filters by direction/status if provided
        let rows = sqlx::query_as!(
            FriendRequestRow,
            r#"
            SELECT
                fr.id as "id!",
                fr.user_id as "user_id!",
                fr.remote_user_id as "remote_user_id!",
                fr.direction as "direction!",
                fr.status as "status!",
                fr.created_at as "created_at!",
                fr.updated_at as "updated_at!",
                u.username as "remote_username!",
                u.alias as "remote_alias!",
                (SELECT p.node_id FROM user_peer_nodez p WHERE p.user_id = u.id ORDER BY p.last_seen_at DESC NULLS LAST LIMIT 1) as remote_node_id,
                (SELECT p.display_name FROM user_peer_nodez p WHERE p.user_id = u.id ORDER BY p.last_seen_at DESC NULLS LAST LIMIT 1) as remote_display_name
            FROM friend_requestz fr
            INNER JOIN user_accountz u ON fr.remote_user_id = u.id
            WHERE fr.user_id = ?1
              AND (?2 IS NULL OR fr.direction = ?2)
              AND (?3 IS NULL OR fr.status = ?3)
            ORDER BY fr.created_at DESC
            "#,
            user_id,
            direction,
            status
        )
        .fetch_all(&pool)
        .await?;

        Ok(rows.into_iter().map(FriendRequest::from).collect())
    }

    /// create a friend request
    pub async fn create_request(
        &self,
        user_id: &str,
        remote_user_id: &str,
        direction: &str,
    ) -> AuthResult<FriendRequest> {
        let pool = database::connect().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();

        // insert the request
        sqlx::query!(
            r#"
            INSERT INTO friend_requestz (user_id, remote_user_id, direction, status, created_at, updated_at)
            VALUES (?1, ?2, ?3, 'pending', ?4, ?4)
            "#,
            user_id,
            remote_user_id,
            direction,
            now
        )
        .execute(&pool)
        .await?;

        // fetch back with denormalized info
        let requests = self.list_requests(user_id, Some(direction), None).await?;
        requests
            .into_iter()
            .find(|r| r.remote_user_id == remote_user_id)
            .ok_or_else(|| {
                crate::users::models::AuthError::Database(sqlx::Error::RowNotFound.to_string())
            })
    }

    /// update friend request status
    pub async fn update_request_status(&self, id: &str, status: &str) -> AuthResult<()> {
        let pool = database::connect().await?;
        let now = OffsetDateTime::now_utc().unix_timestamp();

        sqlx::query!(
            r#"
            UPDATE friend_requestz
            SET status = ?1, updated_at = ?2
            WHERE id = ?3
            "#,
            status,
            now,
            id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// find an existing request between two users in a given direction
    pub async fn find_request(
        &self,
        user_id: &str,
        remote_user_id: &str,
        direction: &str,
    ) -> AuthResult<Option<FriendRequest>> {
        let pool = database::connect().await?;

        let row = sqlx::query_as!(
            FriendRequestRow,
            r#"
            SELECT
                fr.id as "id!",
                fr.user_id as "user_id!",
                fr.remote_user_id as "remote_user_id!",
                fr.direction as "direction!",
                fr.status as "status!",
                fr.created_at as "created_at!",
                fr.updated_at as "updated_at!",
                u.username as "remote_username!",
                u.alias as "remote_alias!",
                (SELECT p.node_id FROM user_peer_nodez p WHERE p.user_id = u.id ORDER BY p.last_seen_at DESC NULLS LAST LIMIT 1) as remote_node_id,
                (SELECT p.display_name FROM user_peer_nodez p WHERE p.user_id = u.id ORDER BY p.last_seen_at DESC NULLS LAST LIMIT 1) as remote_display_name
            FROM friend_requestz fr
            INNER JOIN user_accountz u ON fr.remote_user_id = u.id
            WHERE fr.user_id = ?1 AND fr.remote_user_id = ?2 AND fr.direction = ?3
            "#,
            user_id,
            remote_user_id,
            direction
        )
        .fetch_optional(&pool)
        .await?;

        Ok(row.map(FriendRequest::from))
    }

    /// delete a friend request by id (used for clearing completed outbound requests)
    pub async fn delete_request(&self, id: &str) -> AuthResult<()> {
        let pool = database::connect().await?;

        sqlx::query!(r#"DELETE FROM friend_requestz WHERE id = ?1"#, id)
            .execute(&pool)
            .await?;

        Ok(())
    }

    // -- friend group operations (friend_groupz) --

    /// list all friend groups for a user
    pub async fn list_groups(&self, user_id: &str) -> AuthResult<Vec<FriendGroup>> {
        let pool = database::connect().await?;

        let rows = sqlx::query_as!(
            FriendGroupRow,
            r#"
            SELECT id as "id!", user_id as "user_id!", name as "name!", color as "color!"
            FROM friend_groupz
            WHERE user_id = ?1
            ORDER BY name ASC
            "#,
            user_id
        )
        .fetch_all(&pool)
        .await?;

        Ok(rows.into_iter().map(FriendGroup::from).collect())
    }

    /// create or update a friend group
    pub async fn upsert_group(
        &self,
        user_id: &str,
        name: &str,
        color: i64,
    ) -> AuthResult<FriendGroup> {
        let pool = database::connect().await?;

        let row = sqlx::query_as!(
            FriendGroupRow,
            r#"
            INSERT INTO friend_groupz (user_id, name, color)
            VALUES (?1, ?2, ?3)
            ON CONFLICT (user_id, name) DO UPDATE SET color = ?3
            RETURNING id as "id!", user_id as "user_id!", name as "name!", color as "color!"
            "#,
            user_id,
            name,
            color
        )
        .fetch_one(&pool)
        .await?;

        Ok(FriendGroup::from(row))
    }

    /// delete a friend group (does not unassign friends — their group_name becomes orphaned)
    pub async fn delete_group(&self, user_id: &str, name: &str) -> AuthResult<()> {
        let pool = database::connect().await?;

        sqlx::query!(
            r#"DELETE FROM friend_groupz WHERE user_id = ?1 AND name = ?2"#,
            user_id,
            name
        )
        .execute(&pool)
        .await?;

        Ok(())
    }
}

impl Default for SocialRepository {
    fn default() -> Self {
        Self::new()
    }
}

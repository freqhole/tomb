//! social service — higher-level operations for peer identity + social relationships
//!
//! composes repository calls for multi-step flows like accepting friend requests,
//! resolving node_ids to users, and building full social state snapshots.

use super::models::*;
use super::repository::SocialRepository;
use crate::database;
use crate::users::models::{AuthError, AuthResult, UserRole};

pub struct SocialService {
    repo: SocialRepository,
}

impl SocialService {
    pub fn new() -> Self {
        Self {
            repo: SocialRepository::new(),
        }
    }

    // -- the key shared function --

    /// resolve a node_id to a user, creating the user if necessary.
    ///
    /// this is the single code path for "i have a node_id, give me a user_id."
    /// used by friend requests, knock acceptance, and federation resolution.
    ///
    /// if the node_id already exists in user_peer_nodez, returns the owning user.
    /// if not, creates a new user_accountz entry (with configured default role)
    /// and links the node_id to it.
    pub async fn resolve_or_create_user_for_node(
        &self,
        node_id: &str,
        display_name: Option<&str>,
    ) -> AuthResult<ResolvedUser> {
        let user_repo = crate::users::repository::UserRepository::new();

        // check if this node_id is already known
        if let Some(user) = user_repo.find_user_by_node_id(node_id).await? {
            return Ok(ResolvedUser {
                user_id: user.id,
                username: user.username,
                created: false,
            });
        }

        // create a new user for this node
        let username = generate_username_from_node(node_id, display_name);

        // use the default role from federation config, falling back to viewer
        let default_role = if crate::config::is_config_initialized() {
            let config = crate::config::get_config();
            config
                .federation
                .as_ref()
                .map(|f| UserRole::from(f.default_role.as_str()))
                .unwrap_or(UserRole::Viewer)
        } else {
            UserRole::Viewer
        };

        let create_req = crate::users::CreateUserRequest {
            username: username.clone(),
            role: Some(default_role),
            invite_code: None,
        };

        let user = user_repo.create_user(&create_req).await?;

        // set alias to the original display name if provided
        if let Some(name) = display_name {
            if !name.is_empty() {
                self.repo.update_user_alias(&user.id, name).await?;
            }
        }

        // link the node_id to the new user
        user_repo.upsert_peer_node(&user.id, node_id, None).await?;

        // update the node's display_name if provided
        if let Some(name) = display_name {
            if !name.is_empty() {
                self.repo
                    .update_node_profile(
                        node_id,
                        &UpdateNodeProfileRequest {
                            display_name: Some(name.to_string()),
                            ..Default::default()
                        },
                    )
                    .await?;
            }
        }

        Ok(ResolvedUser {
            user_id: user.id,
            username,
            created: true,
        })
    }

    // -- friend request flows --

    /// accept a friend request: validates, updates status, creates peer_friendz row
    pub async fn accept_friend_request(
        &self,
        request_id: &str,
        user_id: &str,
    ) -> AuthResult<PeerFriend> {
        // find the request by listing and filtering (ensures it belongs to this user)
        let requests = self
            .repo
            .list_requests(user_id, Some("inbound"), None)
            .await?;
        let request = requests
            .iter()
            .find(|r| r.id == request_id)
            .ok_or(AuthError::UserNotFound)?;

        if request.status != "pending" {
            return Err(AuthError::InsufficientPermissions);
        }

        // update request status
        self.repo
            .update_request_status(request_id, "accepted-pending-ack")
            .await?;

        // create the friendship
        let friend = self
            .repo
            .add_friend(user_id, &request.remote_user_id, None)
            .await?;

        Ok(friend)
    }

    /// reject a friend request
    pub async fn reject_friend_request(&self, request_id: &str, user_id: &str) -> AuthResult<()> {
        let requests = self
            .repo
            .list_requests(user_id, Some("inbound"), None)
            .await?;
        let request = requests
            .iter()
            .find(|r| r.id == request_id)
            .ok_or(AuthError::UserNotFound)?;

        if request.status != "pending" {
            return Err(AuthError::InsufficientPermissions);
        }

        self.repo
            .update_request_status(request_id, "rejected")
            .await
    }

    /// handle the ack for a 2-phase friend accept (accepted-pending-ack -> accepted)
    pub async fn handle_friend_accept_ack(&self, request_id: &str) -> AuthResult<()> {
        self.repo
            .update_request_status(request_id, "accepted")
            .await
    }

    /// update a remote node's self-reported profile (called on profile-response)
    pub async fn update_remote_node_profile(
        &self,
        node_id: &str,
        display_name: &str,
        bio: &str,
        avatar_url: &str,
        accent_color: i64,
    ) -> AuthResult<()> {
        self.repo
            .update_node_profile(
                node_id,
                &UpdateNodeProfileRequest {
                    display_name: Some(display_name.to_string()),
                    bio: Some(bio.to_string()),
                    avatar_url: Some(avatar_url.to_string()),
                    accent_color: Some(accent_color),
                },
            )
            .await
    }

    /// reassign a node_id from one user to another (admin merge operation)
    pub async fn merge_node_into_user(
        &self,
        node_id: &str,
        target_user_id: &str,
    ) -> AuthResult<()> {
        let pool = database::connect().await?;
        let now = time::OffsetDateTime::now_utc().unix_timestamp();

        // update the node's user_id to the target user
        sqlx::query!(
            r#"
            UPDATE user_peer_nodez
            SET user_id = ?1, last_seen_at = ?2
            WHERE node_id = ?3
            "#,
            target_user_id,
            now,
            node_id
        )
        .execute(&pool)
        .await?;

        Ok(())
    }

    // -- snapshot --

    /// build the full social state snapshot for UI initialization
    pub async fn get_social_snapshot(
        &self,
        user_id: &str,
        local_node_id: &str,
    ) -> AuthResult<SocialSnapshot> {
        let profile = {
            let mut p = self.repo.get_profile(user_id).await?;
            p.node_id = local_node_id.to_string();
            p
        };

        let friends = self.repo.list_friends(user_id).await?;
        let groups = self.repo.list_groups(user_id).await?;

        let pending_requests = self
            .repo
            .list_requests(user_id, Some("inbound"), Some("pending"))
            .await?;
        let outbound_requests = self
            .repo
            .list_requests(user_id, Some("outbound"), None)
            .await?;

        let settings = self.repo.get_social_settings(user_id).await?;

        Ok(SocialSnapshot {
            profile,
            friends,
            groups,
            pending_requests,
            outbound_requests,
            settings,
        })
    }
}

impl Default for SocialService {
    fn default() -> Self {
        Self::new()
    }
}

/// result of resolving a node_id to a user
#[derive(Debug, Clone)]
pub struct ResolvedUser {
    pub user_id: String,
    pub username: String,
    /// true if a new user_accountz entry was created
    pub created: bool,
}

/// generate a system username from a node_id and optional display_name.
/// strips invalid chars from display_name, falls back to peer_<node_prefix>.
fn generate_username_from_node(node_id: &str, display_name: Option<&str>) -> String {
    if let Some(name) = display_name {
        // strip to alphanumeric + underscore + hyphen, lowercase
        let sanitized: String = name
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
            .collect::<String>()
            .to_lowercase();

        if sanitized.len() >= 2 {
            return sanitized;
        }
    }

    // fallback: peer_ + first 8 chars of node_id
    let prefix = if node_id.len() >= 8 {
        &node_id[..8]
    } else {
        node_id
    };
    format!("peer_{}", prefix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_username_from_node() {
        // display name with valid chars
        assert_eq!(
            generate_username_from_node("abc123", Some("Alice")),
            "alice"
        );

        // display name with emoji and special chars gets stripped
        assert_eq!(
            generate_username_from_node("abc123", Some("edward 😩")),
            "edward"
        );

        // display name too short after stripping
        assert_eq!(
            generate_username_from_node("abc12345def", Some("🎸")),
            "peer_abc12345"
        );

        // no display name
        assert_eq!(
            generate_username_from_node("abc12345def67890", None),
            "peer_abc12345"
        );

        // empty display name
        assert_eq!(
            generate_username_from_node("abc12345", Some("")),
            "peer_abc12345"
        );
    }
}

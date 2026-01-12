//! User management CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::users::{
    CreateInviteCodeRequest, CreateUserRequest, InviteCodeInfoResponse, InviteCodeType,
    InviteCodesGeneratedResponse, UpdateUserRequest, User, UserCreatedResponse, UserInfoResponse,
    UserListResponse, UserQueryParams, UserRole, UserService,
};
use grimoire::wordlist::{initialize_wordlist, is_initialized, ManagementWordlistConfig};

#[derive(Subcommand)]
pub enum UserAction {
    /// Create a new user
    Create {
        #[command(flatten)]
        request: CreateUserRequest,
        /// Bootstrap mode (skip invite code check for first admin)
        #[arg(long)]
        bootstrap: bool,
    },
    /// List users
    List {
        /// Filter by role
        #[arg(long)]
        role: Option<String>,
        /// Include deleted users
        #[arg(long)]
        include_deleted: bool,
        /// Maximum number of results
        #[arg(long, default_value = "50")]
        limit: i64,
        /// Offset for pagination
        #[arg(long, default_value = "0")]
        offset: i64,
    },
    /// Update user
    Update {
        /// User ID
        #[arg(long)]
        user_id: String,
        /// New role
        #[arg(long)]
        role: Option<String>,
    },
    /// Delete user
    Delete {
        /// User ID
        #[arg(long)]
        user_id: String,
    },
    /// Generate invite codes
    GenerateInvites {
        /// Number of codes to generate
        #[arg(long, default_value = "1")]
        count: usize,
        /// Number of words per code
        #[arg(long, default_value = "3")]
        word_count: usize,
        /// Code type (wordlist, random, etc)
        #[arg(long)]
        code_type: Option<String>,
        /// Expiration time in hours
        #[arg(long)]
        expires_hours: Option<i64>,
    },
    /// List invite codes
    ListInvites {
        /// Show only active codes
        #[arg(long)]
        active_only: bool,
    },
    /// Deactivate an invite code
    DeactivateInvite {
        /// Invite code
        code: String,
    },
}

/// Create a CLI admin user for authorization (used internally)
fn cli_admin_user() -> User {
    User {
        id: "cli-admin".to_string(),
        username: "cli".to_string(),
        role: UserRole::Admin,
        api_key: None,
        created_at: 0,
        updated_at: 0,
        deleted_at: None,
    }
}

/// Parse role string to UserRole
fn parse_role(role_str: &str) -> UserRole {
    match role_str.to_lowercase().as_str() {
        "admin" => UserRole::Admin,
        _ => UserRole::Member,
    }
}

/// Convert any error to GrimoireError with context

/// Handle user commands
pub async fn handle_command(action: UserAction) -> CommandOutput<serde_json::Value> {
    let service = UserService::new();

    match action {
        UserAction::Create {
            mut request,
            bootstrap,
        } => {
            // Bootstrap mode: clear invite_code and ensure admin role
            if bootstrap {
                if request.role != Some(UserRole::Admin) {
                    return CommandOutput::failure(
                        "bootstrap flag can only be used with --role admin",
                        vec![],
                        (),
                    );
                }
                request.invite_code = None;
            }

            let response = service.register_user(&request).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(user) = response.data else {
                return CommandOutput::failure("No user data returned", vec![], ());
            };

            let username = user.username.clone();
            let data = UserCreatedResponse {
                id: user.id,
                username: user.username,
                role: format!("{}", user.role),
                created_at: user.created_at,
            };

            let message = format!("User created: {}", username);
            CommandOutput::success(message, data)
        }
        UserAction::List {
            role,
            include_deleted,
            limit,
            offset,
        } => {
            let user_role = role.as_deref().map(parse_role);

            let params = UserQueryParams {
                username: None,
                role: user_role,
                include_deleted: Some(include_deleted),
                limit: Some(limit as u32),
                offset: Some(offset as u32),
            };

            let admin_user = cli_admin_user();

            let response = service.list_users(&params, &admin_user).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(users) = response.data else {
                return CommandOutput::failure("No users data returned", vec![], ());
            };

            let user_infos: Vec<UserInfoResponse> = users
                .iter()
                .map(|u| UserInfoResponse {
                    id: u.id.clone(),
                    username: u.username.clone(),
                    role: format!("{}", u.role),
                    deleted: u.is_deleted(),
                })
                .collect();

            let data = UserListResponse {
                total: user_infos.len(),
                users: user_infos,
            };

            let message = format!(
                "Found {} user{}",
                data.total,
                if data.total == 1 { "" } else { "s" }
            );
            CommandOutput::success(message, data)
        }
        UserAction::Update { user_id, role } => {
            let user_role = role.as_deref().map(parse_role);

            let request = UpdateUserRequest { role: user_role };

            let admin_user = cli_admin_user();

            let response = service.update_user(&user_id, &request, &admin_user).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(user) = response.data else {
                return CommandOutput::failure("No user data returned", vec![], ());
            };

            let username = user.username.clone();
            let data = UserCreatedResponse {
                id: user.id,
                username: user.username,
                role: format!("{}", user.role),
                created_at: user.updated_at,
            };

            let message = format!("User updated: {}", username);
            CommandOutput::success(message, data)
        }
        UserAction::Delete { user_id } => {
            let admin_user = cli_admin_user();

            let response = service.delete_user(&user_id, &admin_user).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let message = format!("User deleted: {}", user_id);
            CommandOutput::success(message, ())
        }
        UserAction::GenerateInvites {
            count,
            word_count,
            code_type,
            expires_hours,
        } => {
            // If wordlist not initialized, initialize with default config (uses grimoire config path)
            if !is_initialized() {
                let config = ManagementWordlistConfig::default();
                let response = initialize_wordlist(&config);
                if !response.success {
                    return CommandOutput::failure(response.message, response.errors, ());
                }
            }

            let invite_type = code_type
                .map(|ct| match ct.to_lowercase().as_str() {
                    "account-link" => InviteCodeType::AccountLink,
                    _ => InviteCodeType::Invite,
                })
                .unwrap_or_default();

            let request = CreateInviteCodeRequest {
                code_type: Some(invite_type),
                link_for_user_id: None,
                expires_hours: expires_hours.map(|h| h as u32),
            };

            let admin_user = cli_admin_user();

            let response = service
                .generate_invite_codes(&request, count as u32, word_count, &admin_user)
                .await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(codes) = response.data else {
                return CommandOutput::failure("No invite codes data returned", vec![], ());
            };

            let code_infos: Vec<InviteCodeInfoResponse> = codes
                .iter()
                .map(|c| InviteCodeInfoResponse {
                    code: c.code.clone(),
                    expires_at: c.link_expires_at,
                })
                .collect();

            let data = InviteCodesGeneratedResponse {
                count: code_infos.len(),
                codes: code_infos,
            };

            let message = format!(
                "Generated {} invite code{}",
                data.count,
                if data.count == 1 { "" } else { "s" }
            );
            CommandOutput::success(message, data)
        }
        UserAction::ListInvites { active_only } => {
            let admin_user = cli_admin_user();

            let response = service.list_invite_codes(active_only, &admin_user).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(codes) = response.data else {
                return CommandOutput::failure("No invite codes data returned", vec![], ());
            };

            let message = format!(
                "Found {} invite code{}",
                codes.len(),
                if codes.len() == 1 { "" } else { "s" }
            );
            CommandOutput::success(message, codes)
        }
        UserAction::DeactivateInvite { code } => {
            let admin_user = cli_admin_user();

            let response = service.deactivate_invite_code(&code, &admin_user).await;
            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let message = format!("Invite code deactivated: {}", code);
            CommandOutput::success(message, ())
        }
    }
}

//! User management CLI commands

use crate::cli::output::{CommandOutput, OutputFormat};
use crate::error::{GrimoireError, GrimoireResult};
use crate::users::{
    CreateInviteCodeRequest, CreateUserRequest, UpdateUserRequest, User, UserQueryParams,
    UserRepository, UserRole, UserService,
};
use clap::Subcommand;
use serde::Serialize;

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

#[derive(Debug, Clone, Serialize)]
pub struct UserCreated {
    pub id: String,
    pub username: String,
    pub role: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserList {
    pub users: Vec<UserInfo>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserInfo {
    pub id: String,
    pub username: String,
    pub role: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct InviteCodesGenerated {
    pub codes: Vec<InviteCodeInfo>,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct InviteCodeInfo {
    pub code: String,
    pub expires_at: Option<i64>,
}

/// Create a CLI admin user for authorization (used internally)
fn cli_admin_user() -> User {
    User {
        id: "cli-admin".to_string(),
        username: "cli".to_string(),
        role: UserRole::Admin,
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
fn to_grimoire_error(context: &str, e: impl std::fmt::Display) -> GrimoireError {
    GrimoireError::ProcessingFailed {
        message: format!("{}: {}", context, e),
    }
}

/// Handle user commands
pub async fn handle_command(action: UserAction, format: OutputFormat) -> GrimoireResult<()> {
    let service = UserService::new();

    match action {
        UserAction::Create {
            mut request,
            bootstrap,
        } => {
            // Bootstrap mode: clear invite_code and ensure admin role
            if bootstrap {
                if request.role != Some(UserRole::Admin) {
                    return Err(GrimoireError::ProcessingFailed {
                        message: "bootstrap flag can only be used with --role admin".to_string(),
                    });
                }
                request.invite_code = None;
            }

            // Use bootstrap user creation for first admin, regular registration otherwise
            let user = if bootstrap {
                let repository = UserRepository::new();
                repository
                    .create_user(&request)
                    .await
                    .map_err(|e| to_grimoire_error("Failed to create user", e))?
            } else {
                service
                    .register_user(&request)
                    .await
                    .map_err(|e| to_grimoire_error("Failed to register user", e))?
            };

            let data = UserCreated {
                id: user.id,
                username: user.username,
                role: format!("{}", user.role),
                created_at: user.created_at,
            };

            let message = format!("User created: {}", data.username);
            let output = CommandOutput::success(message, data);
            print!("{}", output.format(format));
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

            let users = service
                .list_users(&params, &admin_user)
                .await
                .map_err(|e| to_grimoire_error("Failed to list users", e))?;

            let user_infos: Vec<UserInfo> = users
                .iter()
                .map(|u| UserInfo {
                    id: u.id.clone(),
                    username: u.username.clone(),
                    role: format!("{}", u.role),
                    deleted: u.is_deleted(),
                })
                .collect();

            let data = UserList {
                total: user_infos.len(),
                users: user_infos,
            };

            let message = format!(
                "Found {} user{}",
                data.total,
                if data.total == 1 { "" } else { "s" }
            );
            let output = CommandOutput::success(message, data);
            print!("{}", output.format(format));
        }
        UserAction::Update { user_id, role } => {
            let user_role = role.as_deref().map(parse_role);

            let request = UpdateUserRequest { role: user_role };

            let admin_user = cli_admin_user();

            let user = service
                .update_user(&user_id, &request, &admin_user)
                .await
                .map_err(|e| to_grimoire_error("Failed to update user", e))?;

            let data = UserCreated {
                id: user.id,
                username: user.username,
                role: format!("{}", user.role),
                created_at: user.updated_at,
            };

            let message = format!("User updated: {}", data.username);
            let output = CommandOutput::success(message, data);
            print!("{}", output.format(format));
        }
        UserAction::Delete { user_id } => {
            let admin_user = cli_admin_user();

            service
                .delete_user(&user_id, &admin_user)
                .await
                .map_err(|e| to_grimoire_error("Failed to delete user", e))?;

            let message = format!("User deleted: {}", user_id);
            let output = CommandOutput::success(message, ());
            print!("{}", output.format(format));
        }
        UserAction::GenerateInvites {
            count,
            word_count,
            code_type,
            expires_hours,
        } => {
            if !crate::wordlist::is_initialized() {
                let config = crate::wordlist::ManagementWordlistConfig::default();
                crate::wordlist::initialize_wordlist(&config)
                    .map_err(|e| to_grimoire_error("Failed to initialize wordlist", e))?;
            }

            let invite_type = code_type
                .map(|ct| match ct.to_lowercase().as_str() {
                    "account-link" => crate::users::InviteCodeType::AccountLink,
                    _ => crate::users::InviteCodeType::Invite,
                })
                .unwrap_or_default();

            let request = CreateInviteCodeRequest {
                code_type: Some(invite_type),
                link_for_user_id: None,
                expires_hours: expires_hours.map(|h| h as u32),
            };

            let admin_user = cli_admin_user();

            let codes = service
                .generate_invite_codes(&request, count as u32, word_count, &admin_user)
                .await
                .map_err(|e| to_grimoire_error("Failed to generate invite codes", e))?;

            let code_infos: Vec<InviteCodeInfo> = codes
                .iter()
                .map(|c| InviteCodeInfo {
                    code: c.code.clone(),
                    expires_at: c.link_expires_at,
                })
                .collect();

            let data = InviteCodesGenerated {
                count: code_infos.len(),
                codes: code_infos,
            };

            let message = format!(
                "Generated {} invite code{}",
                data.count,
                if data.count == 1 { "" } else { "s" }
            );
            let output = CommandOutput::success(message, data);
            print!("{}", output.format(format));
        }
        UserAction::ListInvites { active_only } => {
            let admin_user = cli_admin_user();

            let codes = service
                .list_invite_codes(active_only, &admin_user)
                .await
                .map_err(|e| to_grimoire_error("Failed to list invite codes", e))?;

            let message = format!(
                "Found {} invite code{}",
                codes.len(),
                if codes.len() == 1 { "" } else { "s" }
            );
            let output = CommandOutput::success(message, codes);
            print!("{}", output.format(format));
        }
        UserAction::DeactivateInvite { code } => {
            let admin_user = cli_admin_user();

            service
                .deactivate_invite_code(&code, &admin_user)
                .await
                .map_err(|e| to_grimoire_error("Failed to deactivate invite code", e))?;

            let message = format!("Invite code deactivated: {}", code);
            let output = CommandOutput::success(message, ());
            print!("{}", output.format(format));
        }
    }

    Ok(())
}

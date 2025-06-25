//! Users module
//!
//! This module handles all user and authentication-related CLI commands including:
//! - User creation and management
//! - Invite code generation and management
//! - Role management
//! - User statistics

use clap::Subcommand;
use grimoire::{AuthService, InviteGenerationConfig};

use grimoire::{DatabaseConnection, UserRole};

#[derive(Subcommand, Clone)]
pub enum UserCommands {
    /// Generate a new invite code
    GenerateInvite {
        /// Number of invite codes to generate
        #[arg(short, long)]
        count: Option<u32>,
        /// Length of the invite code (only for random codes)
        #[arg(short, long)]
        length: Option<usize>,
        /// Custom invite code(s) to create (comma-separated)
        #[arg(long)]
        custom: Option<String>,
        /// Use random characters instead of words (default: use words)
        #[arg(long)]
        random: bool,
        /// Number of words for word-based codes (default: 3)
        #[arg(long, default_value = "3")]
        words: usize,
    },
    /// List all invite codes
    ListInvites {
        /// Show only active invite codes
        #[arg(short, long)]
        active_only: bool,
    },
    /// Show invite code statistics
    Stats,
    /// Create an admin user
    CreateAdmin {
        /// Username for the admin
        username: String,
        /// Invite code to use (optional)
        #[arg(short, long)]
        invite_code: Option<String>,
    },
    /// List all users
    ListUsers,
    /// Update a user's role
    UpdateUserRole {
        /// Username to update
        username: String,
        /// New role (admin or member)
        #[arg(value_parser = parse_role)]
        role: UserRole,
    },
    /// Generate account link code for existing user
    GenerateAccountLink {
        /// Username to generate account link code for
        username: String,
        /// Account link code length (default: 16)
        #[arg(short, long, default_value = "16")]
        length: usize,
        /// Account link code expiry in hours (default: 24)
        #[arg(short, long, default_value = "24")]
        expires_hours: u32,
    },
}

fn parse_role(s: &str) -> Result<UserRole, String> {
    match s.to_lowercase().as_str() {
        "admin" => Ok(UserRole::Admin),
        "member" => Ok(UserRole::Member),
        _ => Err(format!(
            "Invalid role: {}. Valid roles are: admin, member",
            s
        )),
    }
}

impl UserCommands {
    pub async fn handle(
        &self,
        db: &DatabaseConnection,
        default_count: u32,
        default_length: usize,
    ) -> Result<(), Box<dyn std::error::Error>> {
        match self {
            UserCommands::GenerateInvite {
                count,
                length,
                custom,
                random,
                words,
            } => {
                Self::generate_invite(
                    db,
                    *count,
                    *length,
                    custom.as_deref(),
                    default_count,
                    default_length,
                    *random,
                    *words,
                )
                .await
            }
            UserCommands::ListInvites { active_only } => Self::list_invites(db, *active_only).await,
            UserCommands::Stats => Self::show_stats(db).await,
            UserCommands::CreateAdmin {
                username,
                invite_code,
            } => Self::create_admin(db, username, invite_code.as_deref()).await,
            UserCommands::ListUsers => Self::list_users(db).await,
            UserCommands::UpdateUserRole { username, role } => {
                Self::update_user_role(db, username, *role).await
            }
            UserCommands::GenerateAccountLink {
                username,
                length,
                expires_hours,
            } => Self::generate_account_link_code(db, username, *length, *expires_hours).await,
        }
    }

    async fn generate_invite(
        db: &DatabaseConnection,
        count: Option<u32>,
        length: Option<usize>,
        custom: Option<&str>,
        default_count: u32,
        default_length: usize,
        use_random: bool,
        word_count: usize,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let auth_service = AuthService::new(db);

        // Build configuration
        let config = if let Some(custom_codes) = custom {
            let codes: Vec<String> = custom_codes
                .split(',')
                .map(|s| s.trim().to_string())
                .collect();

            println!("Creating {} custom invite code(s)...", codes.len());
            println!();

            InviteGenerationConfig {
                count: 0, // Not used for custom codes
                length: default_length,
                custom_codes: Some(codes),
                use_random,
                word_count,
            }
        } else {
            let actual_count = count.unwrap_or(default_count);
            let actual_length = length.unwrap_or(default_length);

            if use_random {
                println!(
                    "Generating {} random invite code(s) of length {}...",
                    actual_count, actual_length
                );
            } else {
                println!(
                    "Generating {} word-based invite code(s) with {} words each...",
                    actual_count, word_count
                );
            }
            println!();

            InviteGenerationConfig {
                count: actual_count,
                length: actual_length,
                custom_codes: None,
                use_random,
                word_count,
            }
        };

        match auth_service.generate_invite_codes(config).await {
            Ok(result) => {
                // Display progress for each generated code
                for (i, code) in result.codes.iter().enumerate() {
                    println!("Generated invite code {}: {}", i + 1, code.code);
                }

                if result.failed > 0 {
                    println!();
                    println!("⚠️  {} codes failed to generate", result.failed);
                }

                println!();
                println!("✓ Done! Generated {} invite code(s).", result.succeeded);
            }
            Err(e) => {
                eprintln!("❌ Failed to generate invite codes: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn list_invites(
        db: &DatabaseConnection,
        active_only: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let auth_service = AuthService::new(db);
        let invite_codes = auth_service.list_invite_codes(active_only).await?;

        if invite_codes.is_empty() {
            if active_only {
                println!("No active invite codes found.");
            } else {
                println!("No invite codes found.");
            }
            return Ok(());
        }

        println!("Invite Codes:");
        println!(
            "{:<20} {:<12} {:<20} {:<20}",
            "Code", "Status", "Created", "Used By"
        );
        println!("{}", "-".repeat(80));

        for code in invite_codes {
            let status = if code.used_at.is_some() {
                "Used"
            } else {
                "Active"
            };
            let used_by = code
                .used_by_user_id
                .map(|id| id.to_string())
                .unwrap_or_else(|| "-".to_string());
            println!(
                "{:<20} {:<12} {:<20} {:<20}",
                code.code,
                status,
                code.created_at
                    .format(&time::format_description::well_known::Iso8601::DEFAULT)
                    .unwrap_or_else(|_| "Invalid date".to_string()),
                used_by
            );
        }

        Ok(())
    }

    async fn show_stats(db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        let auth_service = AuthService::new(db);
        let stats = auth_service.get_auth_stats().await?;

        println!("{}", stats);

        Ok(())
    }

    async fn create_admin(
        db: &DatabaseConnection,
        username: &str,
        invite_code: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let auth_service = AuthService::new(db);

        match auth_service.create_admin_user(username, invite_code).await {
            Ok(user) => {
                println!("✓ Created admin user: {}", user.username);
                println!("  User ID: {}", user.id);
                println!("  Role: {:?}", user.role);
                if let Some(code) = &user.invite_code_used {
                    println!("  Used invite code: {}", code);
                }
            }
            Err(e) => {
                eprintln!("❌ Failed to create admin user: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn list_users(db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        let auth_service = AuthService::new(db);
        let users = auth_service.list_users().await?;

        if users.is_empty() {
            println!("No users found.");
            return Ok(());
        }

        println!("Users:");
        println!(
            "{:<36} {:<20} {:<10} {:<20} {:<15}",
            "ID", "Username", "Role", "Created", "Invite Used"
        );
        println!("{}", "-".repeat(110));

        for user in users {
            let invite_used = user.invite_code_used.unwrap_or_else(|| "-".to_string());
            println!(
                "{:<36} {:<20} {:<10} {:<20} {:<15}",
                user.id,
                user.username,
                format!("{:?}", user.role),
                user.created_at
                    .format(&time::format_description::well_known::Iso8601::DEFAULT)
                    .unwrap_or_else(|_| "Invalid date".to_string()),
                invite_used
            );
        }

        Ok(())
    }

    async fn update_user_role(
        db: &DatabaseConnection,
        username: &str,
        new_role: UserRole,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let auth_service = AuthService::new(db);

        match auth_service.update_user_role(username, new_role).await {
            Ok((_user, old_role)) => {
                if old_role == new_role {
                    println!("User '{}' already has role: {:?}", username, new_role);
                } else {
                    println!(
                        "✓ Updated user '{}' role from {:?} to {:?}",
                        username, old_role, new_role
                    );
                }
            }
            Err(e) => {
                eprintln!("❌ Failed to update user role: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn generate_account_link_code(
        db: &DatabaseConnection,
        username: &str,
        length: usize,
        expires_hours: u32,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let auth_service = AuthService::new(db);

        match auth_service
            .generate_account_link_code(username, Some(length), Some(expires_hours))
            .await
        {
            Ok(result) => {
                println!("{}", result);
            }
            Err(e) => {
                eprintln!("❌ Failed to generate account link code: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }
}

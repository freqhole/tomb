//! Users module
//!
//! This module handles all user and authentication-related CLI commands including:
//! - User creation and management
//! - Invite code generation and management
//! - Role management
//! - User statistics

use clap::Subcommand;
use client_rust::AuthService;
use rand::distributions::Alphanumeric;
use rand::{thread_rng, Rng};
use server::auth::{AuthRepository, UserRole};
use server::database::DatabaseConnection;
use server::wordlist;

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
        let auth_repo = AuthRepository::new(db);

        // Handle custom codes if provided
        if let Some(custom_codes) = custom {
            let codes: Vec<&str> = custom_codes.split(',').map(|s| s.trim()).collect();
            println!("Creating {} custom invite code(s)...", codes.len());
            println!();

            for (i, code) in codes.iter().enumerate() {
                if code.is_empty() {
                    eprintln!("Skipping empty code at position {}", i + 1);
                    continue;
                }

                // Validate code length
                if let Err(validation_error) = Self::validate_code_length(code.len()) {
                    eprintln!(
                        "Invalid custom invite code '{}': {}",
                        code, validation_error
                    );
                    continue;
                }

                match auth_repo.create_invite_code(code).await {
                    Ok(invite_code) => {
                        println!(
                            "Created custom invite code {}/{}: {}",
                            i + 1,
                            codes.len(),
                            invite_code.code
                        );
                    }
                    Err(e) => {
                        eprintln!("Failed to create custom invite code '{}': {}", code, e);
                    }
                }
            }

            println!();
            println!("Done! Created {} custom invite code(s).", codes.len());
            return Ok(());
        }

        // Handle generated codes
        let count = count.unwrap_or(default_count);

        if use_random {
            // Generate random character codes
            let length = length.unwrap_or(default_length);

            // Validate length before generating
            if let Err(validation_error) = Self::validate_code_length(length) {
                return Err(format!("Invalid code length {}: {}", length, validation_error).into());
            }

            println!(
                "Generating {} random invite code(s) of length {}...",
                count, length
            );
            println!();

            for i in 1..=count {
                let code = Self::generate_code(length);

                match auth_repo.create_invite_code(&code).await {
                    Ok(invite_code) => {
                        println!(
                            "Generated invite code {}/{}: {}",
                            i, count, invite_code.code
                        );
                    }
                    Err(e) => {
                        eprintln!("Failed to generate invite code {}/{}: {}", i, count, e);
                    }
                }
            }
        } else {
            // Generate word-based codes
            if !wordlist::is_initialized() {
                // Try to initialize wordlist
                let wordlist_config = wordlist::WordlistConfig::default();
                if let Err(e) = wordlist::initialize_wordlist(&wordlist_config) {
                    eprintln!(
                        "❌ Wordlist not initialized: {}. Run: cargo run --bin cli wordlist generate",
                        e
                    );
                    return Err("Wordlist not available".into());
                }
            }

            // Validate word count
            if word_count < 2 || word_count > 6 {
                return Err("Word count must be between 2 and 6".into());
            }

            println!(
                "Generating {} word-based invite code(s) with {} words each...",
                count, word_count
            );
            println!();

            for i in 1..=count {
                let code = match wordlist::generate_word_code(word_count) {
                    Ok(code) => code,
                    Err(e) => {
                        eprintln!("Failed to generate word code {}/{}: {}", i, count, e);
                        continue;
                    }
                };

                match auth_repo.create_invite_code(&code).await {
                    Ok(invite_code) => {
                        println!(
                            "Generated invite code {}/{}: {}",
                            i, count, invite_code.code
                        );
                    }
                    Err(e) => {
                        eprintln!("Failed to create invite code {}/{}: {}", i, count, e);
                    }
                }
            }
        }

        println!();
        println!("Done! Generated {} invite code(s).", count);
        Ok(())
    }

    async fn list_invites(
        db: &DatabaseConnection,
        active_only: bool,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let auth_repo = AuthRepository::new(db);
        let invite_codes = auth_repo.list_invite_codes().await?;

        let filtered_codes: Vec<_> = if active_only {
            invite_codes
                .into_iter()
                .filter(|code| !code.used_at.is_some())
                .collect()
        } else {
            invite_codes
        };

        if filtered_codes.is_empty() {
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

        for code in filtered_codes {
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
        let auth_repo = AuthRepository::new(db);
        let invite_codes = auth_repo.list_invite_codes().await?;
        let users = auth_repo.list_users().await?;

        let active_codes = invite_codes.iter().filter(|c| c.used_at.is_none()).count();
        let used_codes = invite_codes.len() - active_codes;

        let admin_count = users.iter().filter(|u| u.role == UserRole::Admin).count();
        let member_count = users.len() - admin_count;

        println!("📊 Statistics");
        println!();
        println!("Invite Codes:");
        println!("  Total: {}", invite_codes.len());
        println!("  Active: {}", active_codes);
        println!("  Used: {}", used_codes);
        println!();
        println!("Users:");
        println!("  Total: {}", users.len());
        println!("  Admins: {}", admin_count);
        println!("  Members: {}", member_count);

        Ok(())
    }

    async fn create_admin(
        db: &DatabaseConnection,
        username: &str,
        invite_code: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let auth_repo = AuthRepository::new(db);

        // Check if user already exists
        if let Ok(Some(_)) = auth_repo.get_user_by_username(username).await {
            return Err(format!("User '{}' already exists", username).into());
        }

        match auth_repo
            .create_user_with_role(username, invite_code, UserRole::Admin)
            .await
        {
            Ok(user) => {
                println!("✓ Created admin user: {}", user.username);
                println!("  User ID: {}", user.id);
                println!("  Role: {:?}", user.role);
                if let Some(code) = &user.invite_code_used {
                    println!("  Used invite code: {}", code);
                }
            }
            Err(e) => {
                eprintln!("Failed to create admin user: {}", e);
                return Err(e.into());
            }
        }

        Ok(())
    }

    async fn list_users(db: &DatabaseConnection) -> Result<(), Box<dyn std::error::Error>> {
        let auth_repo = AuthRepository::new(db);
        let users = auth_repo.list_users().await?;

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
        let auth_repo = AuthRepository::new(db);

        // Check if user exists
        let user = match auth_repo.get_user_by_username(username).await? {
            Some(user) => user,
            None => {
                return Err(format!("User '{}' not found", username).into());
            }
        };

        if user.role == new_role {
            println!("User '{}' already has role: {:?}", username, new_role);
            return Ok(());
        }

        match auth_repo.update_user_role(user.id, new_role).await {
            Ok(_) => {
                println!(
                    "✓ Updated user '{}' role from {:?} to {:?}",
                    username, user.role, new_role
                );
            }
            Err(e) => {
                eprintln!("Failed to update user role: {}", e);
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

    /// Validate invite code length constraints
    fn validate_code_length(length: usize) -> Result<(), String> {
        const MIN_LENGTH: usize = 8;
        const MAX_LENGTH: usize = 128;

        if length < MIN_LENGTH {
            return Err(format!(
                "Code length must be at least {} characters (got {})",
                MIN_LENGTH, length
            ));
        }

        if length > MAX_LENGTH {
            return Err(format!(
                "Code length must be at most {} characters (got {})",
                MAX_LENGTH, length
            ));
        }

        Ok(())
    }

    /// Generate a random alphanumeric code of specified length
    fn generate_code(length: usize) -> String {
        thread_rng()
            .sample_iter(&Alphanumeric)
            .take(length)
            .map(char::from)
            .collect::<String>()
            .to_uppercase()
    }
}

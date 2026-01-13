//! Setup command for initial freqhole configuration

use anyhow::{Context, Result};
use clap::Args;
use grimoire::users::{CreateUserRequest, UserRole, UserService};
use grimoire::wordlist::{initialize_wordlist, ManagementWordlistConfig};
use std::path::PathBuf;

#[derive(Args)]
pub struct SetupArgs {
    /// Config file location
    #[arg(long, short = 'c', default_value = "assets/config/config.jsonc")]
    pub config: PathBuf,

    /// Root username to create
    #[arg(long, default_value = "root")]
    pub root_username: String,

    /// Force recreation of root user even if one exists
    #[arg(long)]
    pub force: bool,
}

pub async fn run(args: SetupArgs) -> Result<()> {
    println!("FREQHOLE SETUP");
    println!();

    // 1. validate config exists
    println!("checking configuration...");
    if !args.config.exists() {
        anyhow::bail!(
            "config file not found: {}\nrun 'cargo run --bin cli config init' to create one",
            args.config.display()
        );
    }
    println!("   config file exists: {}", args.config.display());

    // load config to initialize grimoire
    grimoire::config::init_config(Some(args.config.clone()))
        .context("failed to initialize config")?;

    // 2. initialize grimoire (connects to database and runs migrations)
    println!("initializing database...");
    grimoire::init()
        .await
        .context("failed to initialize database")?;
    println!("   database initialized and migrations applied");

    // 3. validate wordlist exists
    println!("checking wordlist...");
    let wordlist_config = ManagementWordlistConfig::default();
    let wordlist_result = initialize_wordlist(&wordlist_config);
    if wordlist_result.is_success() {
        println!("   wordlist loaded successfully");
    } else {
        println!("   WARNING: wordlist load failed");
        if let Some(errors) = wordlist_result.errors.first() {
            println!("   {}", errors.detail);
        }
        println!("   wordlist is used for generating invite codes");
    }

    println!();
    println!("setting up root user...");

    // 4. check if root user already exists
    let service = UserService::new();

    // check for any root users
    let existing_root = service
        .list_users(
            &grimoire::users::UserQueryParams {
                role: Some(UserRole::Root),
                include_deleted: Some(false),
                ..Default::default()
            },
            &grimoire::users::User {
                id: "setup".to_string(),
                username: "setup".to_string(),
                role: UserRole::Root,
                api_key: None,
                created_at: 0,
                updated_at: 0,
                deleted_at: None,
            },
        )
        .await;

    if let Some(root_users) = existing_root.data {
        if !root_users.is_empty() && !args.force {
            println!("   root user already exists");
            println!();
            println!("existing root users:");
            for user in &root_users {
                println!("  - {} (id: {})", user.username, user.id);
            }
            println!();
            println!("use --force to create another root user");
            return Ok(());
        }
    }

    // 5. create root user
    println!("   creating root user '{}'...", args.root_username);

    let create_request = CreateUserRequest {
        username: args.root_username.clone(),
        role: Some(UserRole::Root),
        invite_code: None,
    };

    let user_response = service.register_user(&create_request).await;

    if !user_response.is_success() {
        anyhow::bail!(
            "failed to create root user: {}",
            user_response
                .errors
                .first()
                .map(|e| e.detail.clone())
                .unwrap_or_else(|| "unknown error".to_string())
        );
    }

    let user = user_response
        .data
        .context("no user data returned after creation")?;

    println!("   root user created");
    println!();
    println!("user details:");
    println!("   username: {}", user.username);
    println!("   user id:  {}", user.id);
    println!("   role:     {}", user.role);

    // 6. generate api key for root user
    println!();
    println!("generating api key...");

    // TODO: implement api key generation in grimoire
    // for now, just note that it needs to be done
    println!("   WARNING: api key generation not yet implemented");
    println!("   you can add an api key to the database manually:");
    println!(
        "   UPDATE user_accountz SET api_key = 'your-random-key-here' WHERE id = '{}'",
        user.id
    );

    // 7. generate one invite code
    println!();
    println!("generating invite code...");

    let invite_response = service
        .generate_invite_codes(
            &grimoire::users::CreateInviteCodeRequest {
                code_type: Some(grimoire::users::InviteCodeType::Invite),
                link_for_user_id: None,
                expires_hours: None,
            },
            1,
            3, // 3-word code
            &user,
        )
        .await;

    if !invite_response.is_success() {
        println!("   WARNING: failed to generate invite code");
    } else if let Some(codes) = invite_response.data {
        if let Some(code) = codes.first() {
            println!("   invite code generated");
            println!();
            println!("INVITE CODE:");
            println!();
            println!("   {}", code.code);
            println!();
            println!("   share this code with users to allow registration");
        }
    }

    println!();
    println!("setup complete!");
    println!();
    println!("(start the server: cargo run --bin server)");
    println!();

    Ok(())
}

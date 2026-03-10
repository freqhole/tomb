//! interactive setup wizard for initial freqhole configuration

use anyhow::Result;
use clap::Args;
use dialoguer::{Confirm, Input, Select};
use grimoire::set_config_values;
use grimoire::setup::{
    check_dependencies, extract_spume_to, get_defaults, get_local_defaults, has_embedded_spume,
    ScanDir, SetupConfig, SetupService,
};
use std::path::PathBuf;

#[derive(Args)]
pub struct SetupArgs {
    /// skip interactive prompts and use defaults (for scripted installs)
    #[arg(long)]
    pub non_interactive: bool,

    /// config file location (default: freqhole-config.toml in current dir)
    #[arg(long, short = 'c')]
    pub config: Option<PathBuf>,

    /// data directory
    #[arg(long)]
    pub data_dir: Option<PathBuf>,

    /// use local directory (./data) instead of ~/freqhole
    #[arg(long)]
    pub local: bool,

    /// server name
    #[arg(long)]
    pub server_name: Option<String>,

    /// server port
    #[arg(long)]
    pub server_port: Option<u16>,

    /// server icon image path
    #[arg(long)]
    pub image_path: Option<String>,

    /// root username to create
    #[arg(long)]
    pub username: Option<String>,

    /// generate API key for root user
    #[arg(long)]
    pub generate_api_key: bool,

    /// generate invite code for new user registration
    #[arg(long)]
    pub generate_invite_code: bool,

    /// directories to scan for music (can be specified multiple times)
    #[arg(long = "scan", value_name = "PATH")]
    pub scan_dirs: Vec<PathBuf>,

    /// allowed origins for CORS/WebAuthn ("none", "any", or URL like http://localhost:5173)
    #[arg(long)]
    pub allowed_origins: Option<String>,

    /// force setup even if config already exists
    #[arg(long)]
    pub force: bool,
}

pub async fn run(args: SetupArgs) -> Result<()> {
    println!();
    println!("  freqhole setup wizard");
    println!("  =====================");
    println!();

    // step 1: check dependencies
    println!("checking dependencies...");
    let deps = check_dependencies();

    if deps.has_ffmpeg() {
        println!(
            "  ✓ ffmpeg found: {}",
            deps.ffmpeg_path.as_ref().unwrap().display()
        );
    } else {
        println!("  ✗ ffmpeg not found");
        println!();
        println!("  ffmpeg is required for audio processing.");
        println!("  install it with:");
        println!("    macOS:  brew install ffmpeg");
        println!("    debian: sudo apt install ffmpeg");
        println!("    arch:   sudo pacman -S ffmpeg");
        println!();

        if args.non_interactive {
            anyhow::bail!("ffmpeg not found - cannot continue");
        }

        let retry = Confirm::new()
            .with_prompt("retry after installing ffmpeg?")
            .default(true)
            .interact()?;

        if retry {
            println!("please install ffmpeg and run setup again.");
            return Ok(());
        } else {
            anyhow::bail!("ffmpeg is required - setup cancelled");
        }
    }

    if deps.has_ytdlp() {
        println!(
            "  ✓ yt-dlp found: {}",
            deps.ytdlp_path.as_ref().unwrap().display()
        );
    } else {
        println!("  ✗ yt-dlp not found (optional)");
        println!();
        println!("  yt-dlp enables downloading music from URLs.");
        println!("  install it with:");
        println!("    macOS:  brew install yt-dlp");
        println!("    pip:    pip install yt-dlp");
        println!();
        println!("  continuing without yt-dlp - url downloads will be disabled.");
    }

    println!();

    // step 2: get defaults based on --local flag or prompt
    let defaults = if args.local {
        get_local_defaults()
    } else if args.non_interactive {
        get_defaults()
    } else {
        // ask user which defaults to use
        let options = &[
            format!("home directory ({})", get_defaults().data_dir.display()),
            format!(
                "local directory ({})",
                get_local_defaults().data_dir.display()
            ),
        ];
        let selection = Select::new()
            .with_prompt("where should freqhole store data?")
            .items(options)
            .default(0)
            .interact()?;

        if selection == 1 {
            get_local_defaults()
        } else {
            get_defaults()
        }
    };

    let config_path = if let Some(p) = args.config {
        p
    } else if args.non_interactive {
        PathBuf::from("freqhole-config.toml")
    } else {
        Input::new()
            .with_prompt("config file path")
            .default("freqhole-config.toml".to_string())
            .interact_text()
            .map(PathBuf::from)?
    };

    // check if config already exists
    if config_path.exists() && !args.force {
        println!("config file already exists: {}", config_path.display());
        println!("use --force to overwrite");
        return Ok(());
    }

    let data_dir = if let Some(d) = args.data_dir {
        d
    } else if args.non_interactive {
        defaults.data_dir.clone()
    } else {
        Input::new()
            .with_prompt("data directory")
            .default(defaults.data_dir.display().to_string())
            .interact_text()
            .map(PathBuf::from)?
    };

    let server_name = if let Some(n) = args.server_name {
        n
    } else if args.non_interactive {
        defaults.server_name.clone()
    } else {
        Input::new()
            .with_prompt("server name")
            .default(defaults.server_name.clone())
            .interact_text()?
    };

    let server_port = if let Some(p) = args.server_port {
        p
    } else if args.non_interactive {
        defaults.server_port
    } else {
        Input::new()
            .with_prompt("server port")
            .default(defaults.server_port)
            .interact_text()?
    };

    let image_path = if let Some(p) = args.image_path {
        Some(p)
    } else if args.non_interactive {
        None
    } else {
        let input: String = Input::new()
            .with_prompt("server icon image path (optional, press enter to skip)")
            .default(String::new())
            .allow_empty(true)
            .interact_text()?;
        if input.is_empty() {
            None
        } else {
            Some(input)
        }
    };

    let username = if let Some(u) = args.username {
        u
    } else if args.non_interactive {
        defaults.username.clone()
    } else {
        Input::new()
            .with_prompt("root username")
            .default(defaults.username.clone())
            .interact_text()?
    };

    let generate_api_key = if args.non_interactive {
        args.generate_api_key
    } else {
        Confirm::new()
            .with_prompt("generate API key for root user?")
            .default(false)
            .interact()?
    };

    let generate_invite_code = if args.non_interactive {
        args.generate_invite_code
    } else {
        Confirm::new()
            .with_prompt("generate invite code for new user registration?")
            .default(true)
            .interact()?
    };

    // allowed origins for CORS and WebAuthn
    // this determines which browser origins can access the server
    let allowed_origins: Option<Vec<String>> = if let Some(ref origins) = args.allowed_origins {
        // from CLI arg
        match origins.as_str() {
            "none" => Some(Vec::new()),
            "any" => Some(vec!["any".to_string()]),
            url => Some(vec![url.to_string()]),
        }
    } else if args.non_interactive {
        // non-interactive defaults to none (same-origin only)
        Some(Vec::new())
    } else {
        // interactive prompt
        println!();
        println!("  allowed origins configuration");
        println!("  -----------------------------");
        println!("  this controls which browser origins can access yr server via CORS.");
        println!("  also used for passkey (WebAuthn) authentication.");
        println!();
        println!("  options:");
        println!("    none - same-origin only (works if UI served from this server)");
        println!("    any  - allow any origin (convenient but less secure)");
        println!("    URL  - specific origin like http://localhost:5173");
        println!();

        let options = &[
            "none (same-origin only)".to_string(),
            "any (allow any origin)".to_string(),
            format!("http://localhost:{} (same as server)", server_port),
            "custom URL...".to_string(),
        ];
        let selection = Select::new()
            .with_prompt("allowed origins")
            .items(options)
            .default(2) // default to same port as server
            .interact()?;

        match selection {
            0 => Some(Vec::new()),                                        // none
            1 => Some(vec!["any".to_string()]),                           // any
            2 => Some(vec![format!("http://localhost:{}", server_port)]), // server port
            _ => {
                // custom URL
                let url: String = Input::new()
                    .with_prompt("enter origin URL")
                    .default("http://localhost:5173".to_string())
                    .interact_text()?;
                Some(vec![url])
            }
        }
    };

    // collect initial scan directories
    let initial_scan_dirs: Vec<ScanDir> = args
        .scan_dirs
        .iter()
        .map(|p| ScanDir {
            path: p.display().to_string(),
            tags: Vec::new(),
        })
        .collect();

    println!();
    println!("running setup...");
    println!();

    // use SetupService to run everything
    let setup_config = SetupConfig {
        config_path: config_path.clone(),
        data_dir: data_dir.clone(),
        server_name: server_name.clone(),
        server_port,
        image_path,
        admin_username: Some(username.clone()), // user-provided username becomes admin
        generate_api_key,
        generate_invite_code,
        ytdlp_available: deps.has_ytdlp(),
        fetch_music_dir: None, // defaults to data_dir/fetch
        initial_scan_dirs,
        allowed_origins,
    };

    let service = SetupService::new();
    let result = service.run_setup(setup_config).await;

    if result.success {
        println!("  ✓ config created: {}", result.config_path);
        println!("  ✓ database initialized");
        println!(
            "  ✓ system root user '{}' created",
            result.root_username.as_deref().unwrap_or("freqroot")
        );
        if let Some(admin_name) = &result.admin_username {
            println!("  ✓ admin user '{}' created", admin_name);
        }

        if let Some(api_key) = &result.api_key {
            println!();
            println!("  API KEY: {}", api_key);
            println!();
            println!("  save this key securely - it won't be shown again!");
        }

        if let Some(invite_code) = &result.invite_code {
            println!();
            println!("  INVITE CODE: {}", invite_code);
            println!();
            println!("  share this code with users to allow registration");
        }

        if result.scan_jobs_created > 0 {
            println!("  ✓ {} scan jobs queued", result.scan_jobs_created);
        }

        // extract embedded spume client if available
        if has_embedded_spume() {
            let spume_dir = data_dir.join("spume");
            match extract_spume_to(&spume_dir) {
                Ok(extract_result) => {
                    println!(
                        "  ✓ spume client extracted ({} files)",
                        extract_result.files_extracted
                    );
                    // update config to enable static file serving
                    if let Err(e) = set_config_values(
                        &config_path,
                        &[
                            ("server.static_files.enabled", true.into()),
                            (
                                "server.static_files.directory",
                                spume_dir.display().to_string().into(),
                            ),
                        ],
                    ) {
                        println!("  ! failed to update static_files config: {}", e);
                    } else {
                        println!("  ✓ static file serving enabled");
                    }
                }
                Err(e) => {
                    println!("  ! failed to extract spume client: {}", e);
                }
            }
        }

        // report non-fatal errors (like wordlist issues)
        for error in &result.errors {
            println!("  ! {}", error);
        }

        println!();
        println!("setup complete!");
        println!();
        println!("start the server with:");
        println!("  freqhole server start -c {}", config_path.display());
        println!();
    } else {
        println!("setup failed:");
        for error in &result.errors {
            println!("  ✗ {}", error);
        }
        anyhow::bail!("setup failed");
    }

    Ok(())
}

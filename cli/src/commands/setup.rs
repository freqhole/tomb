//! Setup command for initial freqhole configuration

use anyhow::Result;
use clap::Args;
use std::path::PathBuf;

#[derive(Args)]
pub struct SetupArgs {
    /// Config file location
    #[arg(long, default_value = "config.jsonc")]
    pub config: PathBuf,

    /// Data directory
    #[arg(long, default_value = "data")]
    pub data_dir: PathBuf,

    /// Music directory
    #[arg(long)]
    pub music_dir: Option<PathBuf>,

    /// Generate wordlist
    #[arg(long, default_value = "true")]
    pub generate_wordlist: bool,
}

pub async fn run(args: SetupArgs) -> Result<()> {
    println!("FREQHOLE setup");
    println!();
    println!("Config file: {:?}", args.config);
    println!("Data directory: {:?}", args.data_dir);

    if let Some(music_dir) = args.music_dir {
        println!("Music directory: {:?}", music_dir);
    }

    if args.generate_wordlist {
        println!("Wordlist generation: enabled");
    }

    println!();
    println!("TODO(sorry): Implement setup steps:");
    println!("  1. Create config file");
    println!("  2. Initialize database");
    println!("  3. Generate wordlist");
    println!("  4. Set up directories");
    println!();

    Ok(())
}

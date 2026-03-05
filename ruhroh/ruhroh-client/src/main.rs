//! ruhroh-client: peer client for iroh federation prototype
//!
//! uses iroh 0.96 API for p2p QUIC connections

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

mod blobs;
mod central;
mod chat;
mod commands;
mod config;
mod handler;
mod haruspex;
mod protocol;

#[derive(Parser, Debug)]
#[command(name = "ruhroh-client")]
#[command(about = "Peer client for ruhroh federation prototype")]
struct Args {
    /// Data directory for storing identity and config
    #[arg(short, long, default_value = "ruhroh-data")]
    data_dir: PathBuf,

    /// Central server URL
    #[arg(short, long, default_value = "http://localhost:3000")]
    central_url: String,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Register with central server using invite code
    Register {
        /// Invite code from admin
        invite_code: String,
        /// Display name for this client
        display_name: String,
    },

    /// Show current identity info
    Info,

    /// List available groups
    Groups,

    /// Join a group
    Join {
        /// Group ID to join
        group_id: String,
    },

    /// List peers in your groups
    Peers,

    /// Send a message to a peer (by their endpoint ID)
    Send {
        /// Peer's endpoint ID (public key)
        endpoint_id: String,
        /// Message to send
        message: String,
    },

    /// Start server mode (listen for incoming connections)
    Listen,

    /// Interactive chat mode (listen + send)
    Chat,

    /// Get songs from a peer's freqhole server
    Songs {
        /// Peer name (e.g., "bob")
        peer: String,
        /// Max number of songs to fetch
        #[arg(short, long, default_value = "5")]
        limit: u32,
    },

    /// Get playlists from a peer's freqhole server
    Playlists {
        /// Peer name (e.g., "bob")
        peer: String,
        /// Max number of playlists to fetch
        #[arg(short, long, default_value = "5")]
        limit: u32,
    },

    /// Share a file via iroh-blobs (generate ticket)
    Share {
        /// Path to the file to share
        file: PathBuf,
    },

    /// Fetch a file from a peer using a blob ticket
    Fetch {
        /// Blob ticket string
        ticket: String,
        /// Output file path
        #[arg(short, long)]
        output: PathBuf,
    },

    /// Test connecting to a peer using ONLY their node_id (validates relay discovery)
    ConnectTest {
        /// Peer name to connect to
        peer: String,
        /// Skip using endpoint_addr even if available (force node_id-only)
        #[arg(long, default_value = "true")]
        node_id_only: bool,
    },

    /// Interactive sync with haruspex (Supabase) - prompts for credentials
    HaruspexSync {
        /// Supabase URL (default: local dev)
        #[arg(long, default_value = "http://127.0.0.1:54321")]
        supabase_url: String,
        /// Supabase anon key
        #[arg(long, default_value = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH")]
        anon_key: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("ruhroh_client=info".parse()?)
                .add_directive("iroh=error".parse()?)
                .add_directive("iroh_quinn_udp=off".parse()?)
                .add_directive("iroh_quinn_proto=off".parse()?),
        )
        .init();

    let args = Args::parse();

    // ensure data directory exists
    std::fs::create_dir_all(&args.data_dir)?;

    match args.command {
        Command::Register {
            invite_code,
            display_name,
        } => {
            commands::register(&args.data_dir, &args.central_url, &invite_code, &display_name)
                .await?;
        }
        Command::Info => {
            commands::show_info(&args.data_dir).await?;
        }
        Command::Groups => {
            commands::list_groups(&args.data_dir, &args.central_url).await?;
        }
        Command::Join { group_id } => {
            commands::join_group(&args.data_dir, &args.central_url, &group_id).await?;
        }
        Command::Peers => {
            commands::list_peers(&args.data_dir, &args.central_url).await?;
        }
        Command::Send {
            endpoint_id,
            message,
        } => {
            commands::send_message(&args.data_dir, &endpoint_id, &message).await?;
        }
        Command::Listen => {
            chat::start_listen(&args.data_dir).await?;
        }
        Command::Chat => {
            chat::start_chat(&args.data_dir, &args.central_url).await?;
        }
        Command::Songs { peer, limit } => {
            chat::fetch_songs(&args.data_dir, &args.central_url, &peer, limit).await?;
        }
        Command::Playlists { peer, limit } => {
            chat::fetch_playlists(&args.data_dir, &args.central_url, &peer, limit).await?;
        }
        Command::Share { file } => {
            blobs::share_file(&args.data_dir, &file).await?;
        }
        Command::Fetch { ticket, output } => {
            blobs::fetch_blob(&args.data_dir, &ticket, &output).await?;
        }
        Command::ConnectTest { peer, node_id_only } => {
            commands::connect_test(&args.data_dir, &args.central_url, &peer, node_id_only).await?;
        }
        Command::HaruspexSync {
            supabase_url,
            anon_key,
        } => {
            let result = haruspex::interactive_sync(&supabase_url, &anon_key).await?;
            println!("sync complete:");
            println!("  {} member(s) collected", result.members.len());
            println!("  {} peer(s) with node_ids", result.peers.len());
            println!();
            println!("note: to sync these users to freqhole, use the freqhole CLI:");
            println!("  freqhole federation sync");
        }
    }

    Ok(())
}

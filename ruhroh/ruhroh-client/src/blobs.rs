//! blob sharing and fetching via iroh-blobs

use anyhow::{Context, Result};
use iroh::protocol::Router;
use iroh::Endpoint;
use iroh_blobs::{store, ticket::BlobTicket, BlobsProtocol};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tracing::info;

use crate::config::load_or_generate_key;

/// Share a file via iroh-blobs, returns a ticket that others can use to fetch
pub async fn share_file(data_dir: &PathBuf, file_path: &PathBuf) -> Result<()> {
    let secret_key = load_or_generate_key(data_dir).await?;

    // Verify file exists
    if !file_path.exists() {
        anyhow::bail!("File not found: {:?}", file_path);
    }

    let file_name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let file_size = tokio::fs::metadata(file_path).await?.len();

    println!("Sharing file: {} ({} bytes)", file_name, file_size);

    // Create blob store
    let blob_dir = data_dir.join("blobs");
    std::fs::create_dir_all(&blob_dir)?;
    let store = store::fs::FsStore::load(&blob_dir)
        .await
        .context("failed to load blob store")?;

    // Add file to store
    println!("Adding file to blob store...");
    let tag = store
        .add_path(file_path)
        .await
        .context("failed to add file to store")?;

    println!("File hash: {}", tag.hash);

    // Create endpoint and wait for relay connection
    let endpoint = Endpoint::builder()
        .secret_key(secret_key)
        .alpns(vec![iroh_blobs::ALPN.to_vec()])
        .bind()
        .await?;

    // Wait for the endpoint to connect to relay
    endpoint.online().await;
    let addr = endpoint.addr();

    // Create blob protocol handler
    let blobs = BlobsProtocol::new(store.as_ref(), None);

    // Build router to serve blobs
    let router = Router::builder(endpoint)
        .accept(iroh_blobs::ALPN, blobs)
        .spawn();

    // Create ticket
    let ticket = BlobTicket::new(addr, tag.hash, tag.format);

    println!("\n=== BLOB TICKET ===");
    println!("{}", ticket);
    println!("===================\n");
    println!("Share this ticket with others to let them fetch the file.");
    println!("Keep this process running until they finish downloading.");
    println!("Press Ctrl+C to stop sharing.\n");

    // Wait for shutdown
    tokio::signal::ctrl_c().await?;

    println!("\nShutting down...");
    router.shutdown().await?;

    Ok(())
}

/// Fetch a blob from a peer using a ticket
pub async fn fetch_blob(
    data_dir: &PathBuf,
    ticket_str: &str,
    output_path: &PathBuf,
) -> Result<()> {
    let secret_key = load_or_generate_key(data_dir).await?;

    // Parse ticket
    let ticket: BlobTicket = ticket_str.parse().context("invalid blob ticket")?;

    println!("Fetching blob: {}", ticket.hash());
    println!("From: {}", ticket.addr().id);

    // Create blob store
    let blob_dir = data_dir.join("blobs");
    std::fs::create_dir_all(&blob_dir)?;
    let store = store::fs::FsStore::load(&blob_dir)
        .await
        .context("failed to load blob store")?;

    // Create endpoint
    let endpoint = Endpoint::builder().secret_key(secret_key).bind().await?;

    // Connect to peer
    println!("Connecting to peer...");
    let addr = ticket.addr().clone();
    let conn = endpoint
        .connect(addr, iroh_blobs::ALPN)
        .await
        .context("failed to connect to peer")?;

    // Download using Remote API
    println!("Downloading...");
    let remote = store.remote();
    let stats = remote
        .fetch(conn, ticket.hash_and_format())
        .await
        .context("failed to fetch blob")?;

    println!(
        "Downloaded {} bytes in {:?}",
        stats.payload_bytes_read, stats.elapsed
    );

    // Export to file
    println!("Exporting to {:?}...", output_path);
    store
        .export(ticket.hash(), output_path)
        .await
        .context("failed to export blob")?;

    println!("Done! File saved to {:?}", output_path);

    // Clean shutdown
    store.shutdown().await?;
    endpoint.close().await;

    Ok(())
}

/// Inner share function for interactive mode - returns ticket and keeps serving
pub async fn share_file_inner(data_dir: &PathBuf, file_path: &PathBuf) -> Result<String> {
    let secret_key = load_or_generate_key(&data_dir).await?;

    // Create blob store
    let blob_dir = data_dir.join("blobs");
    std::fs::create_dir_all(&blob_dir)?;
    let store = store::fs::FsStore::load(&blob_dir)
        .await
        .context("failed to load blob store")?;

    // Add file to store
    let tag = store
        .add_path(file_path)
        .await
        .context("failed to add file to store")?;

    // Create endpoint
    let endpoint = Endpoint::builder()
        .secret_key(secret_key)
        .alpns(vec![iroh_blobs::ALPN.to_vec()])
        .bind()
        .await?;

    endpoint.online().await;
    let addr = endpoint.addr();

    // Create blob protocol handler
    let blobs = BlobsProtocol::new(store.as_ref(), None);

    // Build router to serve blobs
    let router = Router::builder(endpoint)
        .accept(iroh_blobs::ALPN, blobs)
        .spawn();

    // Create ticket
    let ticket = BlobTicket::new(addr, tag.hash, tag.format);
    let ticket_str = ticket.to_string();

    // Spawn background task to keep serving (will be dropped when chat exits)
    tokio::spawn(async move {
        // Keep router alive until shutdown
        let _ = tokio::signal::ctrl_c().await;
        let _ = router.shutdown().await;
    });

    Ok(ticket_str)
}

/// Inner fetch function for interactive mode
pub async fn fetch_file_inner(
    data_dir: &PathBuf,
    ticket_str: &str,
    output_path: &PathBuf,
) -> Result<()> {
    fetch_blob(data_dir, ticket_str, output_path).await
}

/// Global flag to track if grimoire config is initialized
static GRIMOIRE_INITIALIZED: AtomicBool = AtomicBool::new(false);

/// Initialize grimoire config if not already done
fn ensure_grimoire_init(_data_dir: &PathBuf) -> Result<()> {
    if !GRIMOIRE_INITIALIZED.load(Ordering::Relaxed) {
        let config_path = PathBuf::from("../freqhole-config.toml");
        grimoire::init_config(Some(config_path))
            .context("failed to init grimoire config - is freqhole-config.toml present in tomb/?")?;
        GRIMOIRE_INITIALIZED.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Serve a blob request by looking up in freqhole's grimoire database
pub async fn serve_blob_request(data_dir: &PathBuf, blob_id: &str) -> Result<String> {
    ensure_grimoire_init(data_dir)?;

    // Look up blob in grimoire
    let blob = grimoire::media_blobz::get_media_blob(blob_id)
        .await
        .context("blob not found")?;

    let local_path = blob.local_path.context("blob has no local_path")?;

    let file_path = PathBuf::from(&local_path);
    if !file_path.exists() {
        anyhow::bail!("blob file not found at {}", local_path);
    }

    info!("Serving blob {} from {}", blob_id, local_path);

    // Use share_file_inner to create ticket (starts background server)
    let ticket = share_file_inner(data_dir, &file_path).await?;

    Ok(ticket)
}

/// Blob data source - either a file path or raw bytes (for db-stored blobs)
pub enum BlobSource {
    /// File on disk (audio files)
    File(PathBuf),
    /// Raw bytes from database (images, waveforms)
    Data(Vec<u8>),
}

/// Get blob info for streaming (returns source, size, content_type)
/// Handles both file-based blobs (audio) and database blobs (images)
pub async fn get_blob_for_streaming(
    data_dir: &PathBuf,
    blob_id: &str,
) -> Result<(BlobSource, u64, String)> {
    ensure_grimoire_init(data_dir)?;

    // Look up blob in grimoire
    let blob = grimoire::media_blobz::get_media_blob(blob_id)
        .await
        .context("blob not found")?;

    let content_type = blob.mime.unwrap_or_else(|| "application/octet-stream".to_string());

    // Check if blob has a local file path (audio files)
    if let Some(local_path) = &blob.local_path {
        let file_path = PathBuf::from(local_path);
        if file_path.exists() {
            let metadata = tokio::fs::metadata(&file_path).await?;
            let size = metadata.len();
            return Ok((BlobSource::File(file_path), size, content_type));
        }
    }

    // No local_path or file doesn't exist - try blob_data database (images, waveforms)
    let response = grimoire::blob_data::get_blob_data(blob_id).await;
    if let Some(data) = response.data {
        let size = data.len() as u64;
        return Ok((BlobSource::Data(data), size, content_type));
    }

    anyhow::bail!("blob {} has no local_path and no data in blob_data database", blob_id)
}

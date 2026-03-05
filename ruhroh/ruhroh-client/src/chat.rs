//! interactive chat mode and proxy functions

use anyhow::{Context, Result};
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, PublicKey};
use std::path::PathBuf;

use crate::blobs::{fetch_file_inner, share_file_inner};
use crate::central::{CentralClient, PeerInfo};
use crate::config::{load_config, load_or_generate_key};
use crate::handler::RuhrohHandler;
use crate::protocol::{RuhrohMessage, RUHROH_ALPN};

/// Pretty print freqhole API response
pub fn print_freqhole_response(cmd: &str, body: &str) {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(items) = json
            .get("data")
            .and_then(|d| d.get("items"))
            .and_then(|i| i.as_array())
        {
            if cmd == "songs" {
                println!("\nFound {} songs:\n", items.len());
                for item in items {
                    let title = item
                        .get("song")
                        .and_then(|s| s.get("title"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("?");
                    let artist = item
                        .get("artist")
                        .and_then(|a| a.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("?");
                    let album = item
                        .get("album")
                        .and_then(|a| a.get("title"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("?");
                    let duration = item
                        .get("song")
                        .and_then(|s| s.get("duration"))
                        .and_then(|d| d.as_u64())
                        .unwrap_or(0);
                    let mins = duration / 60000;
                    let secs = (duration % 60000) / 1000;
                    println!(
                        "  \x1b[36m{}\x1b[0m - {} [{}] ({}:{:02})",
                        artist, title, album, mins, secs
                    );
                }
            } else if cmd == "playlists" {
                println!("\nFound {} playlists:\n", items.len());
                for item in items {
                    let title = item
                        .get("title")
                        .and_then(|t| t.as_str())
                        .unwrap_or("Untitled");
                    let count = item
                        .get("song_count")
                        .and_then(|c| c.as_u64())
                        .unwrap_or(0);
                    println!("  \x1b[36m{}\x1b[0m ({} songs)", title, count);
                }
            }
            println!("");
        } else {
            // Fallback: print raw JSON
            println!(
                "{}",
                serde_json::to_string_pretty(&json).unwrap_or_else(|_| body.to_string())
            );
        }
    } else {
        println!("{}", body);
    }
}

/// Start listening for incoming connections
pub async fn start_listen(data_dir: &PathBuf) -> Result<()> {
    let secret_key = load_or_generate_key(data_dir).await?;
    let config = load_config(data_dir)?.context("Not registered. Run 'register' first.")?;

    let endpoint_id = secret_key.public();
    println!("Starting listener...");
    println!("  Endpoint ID: {}", endpoint_id);
    println!("  Display name: {}", config.display_name);

    // Build endpoint with our secret key and ALPN for accepting
    let endpoint = Endpoint::builder()
        .secret_key(secret_key)
        .alpns(vec![RUHROH_ALPN.to_vec()])
        .bind()
        .await?;

    // Wait for relay connection and print full address
    endpoint.online().await;
    let addr = endpoint.addr();
    let addr_json = serde_json::to_string(&addr)?;
    println!("\n  Full address (paste into browser client):");
    println!("  {}\n", addr_json);
    println!("Press Ctrl+C to stop.");

    // Create protocol handler
    let handler = RuhrohHandler::new(data_dir.clone());

    // Build router to handle incoming connections
    let router = Router::builder(endpoint)
        .accept(RUHROH_ALPN, handler)
        .spawn();

    // Wait for shutdown signal
    tokio::signal::ctrl_c().await?;

    println!("\nShutting down...");
    router.shutdown().await?;

    Ok(())
}

/// Interactive chat mode - listen for messages and send interactively
pub async fn start_chat(data_dir: &PathBuf, central_url: &str) -> Result<()> {
    let secret_key = load_or_generate_key(data_dir).await?;
    let config = load_config(data_dir)?.context("Not registered. Run 'register' first.")?;

    let endpoint_id = secret_key.public();
    println!("Starting chat...");
    println!("  Endpoint ID: {}", endpoint_id);
    println!("  Display name: {}", config.display_name);

    // Fetch peers
    let client = CentralClient::new(central_url).with_auth(&config.api_key);
    let peers: Vec<PeerInfo> = client.list_peers().await?;

    if peers.is_empty() {
        println!("\nNo peers found. Join a group with other members first.");
        return Ok(());
    }

    println!("\nPeers available:");
    for (i, p) in peers.iter().enumerate() {
        println!("  [{}] {} ({})", i + 1, p.display_name, &p.endpoint_id[..16]);
    }

    // Build endpoint
    let endpoint = Endpoint::builder()
        .secret_key(secret_key)
        .alpns(vec![RUHROH_ALPN.to_vec()])
        .bind()
        .await?;

    // Wait for relay and print full address
    endpoint.online().await;
    let addr = endpoint.addr();
    let addr_json = serde_json::to_string(&addr)?;
    println!("\n  Full address (paste into browser client):");
    println!("  {}\n", addr_json);

    // Start listening in background
    let handler = RuhrohHandler::new(data_dir.clone());
    let router = Router::builder(endpoint.clone())
        .accept(RUHROH_ALPN, handler)
        .spawn();

    println!("\nCommands:");
    println!("  <number> <message>  - send chat message to peer");
    println!("  songs <number>      - get songs from peer's freqhole");
    println!("  playlists <number>  - get playlists from peer's freqhole");
    println!("  get-blob <number> <blob_id> <output> - fetch blob from peer's freqhole");
    println!("  share <path>        - share a file, get ticket");
    println!("  fetch <ticket> <output> - fetch a file from ticket");
    println!("  quit                - exit chat");
    println!("");

    // Interactive loop
    let stdin = std::io::stdin();
    let mut input = String::new();

    loop {
        input.clear();
        print!("> ");
        use std::io::Write;
        std::io::stdout().flush()?;

        if stdin.read_line(&mut input).is_err() {
            break;
        }

        let input_str = input.trim();
        if input_str.is_empty() {
            continue;
        }

        if input_str == "quit" || input_str == "q" {
            break;
        }

        // Parse commands
        let parts: Vec<&str> = input_str.splitn(2, ' ').collect();

        // Handle special commands
        if parts[0] == "songs" || parts[0] == "playlists" {
            handle_freqhole_command(&endpoint, &peers, parts[0], parts.get(1).copied()).await;
            continue;
        }

        // Share command: share <path>
        if parts[0] == "share" {
            if parts.len() < 2 {
                println!("Usage: share <file_path>");
                continue;
            }
            let file_path = PathBuf::from(parts[1]);
            let abs_path = if file_path.is_absolute() {
                file_path
            } else {
                std::env::current_dir()?.join(file_path)
            };

            if !abs_path.exists() {
                println!("File not found: {}", abs_path.display());
                continue;
            }

            println!("Sharing {}...", abs_path.display());
            match share_file_inner(&data_dir, &abs_path).await {
                Ok(ticket) => {
                    println!("\nTicket: {}", ticket);
                    println!("\nOthers can fetch with: fetch {} <output_file>", ticket);
                }
                Err(e) => println!("Failed to share: {}", e),
            }
            continue;
        }

        // Fetch command: fetch <ticket> <output>
        if parts[0] == "fetch" {
            let args: Vec<&str> = input_str.splitn(3, ' ').collect();
            if args.len() < 3 {
                println!("Usage: fetch <ticket> <output_path>");
                continue;
            }
            let ticket_str = args[1];
            let output_path = PathBuf::from(args[2]);
            let abs_output = if output_path.is_absolute() {
                output_path
            } else {
                std::env::current_dir()?.join(output_path)
            };

            println!("Fetching to {}...", abs_output.display());
            match fetch_file_inner(&data_dir, ticket_str, &abs_output).await {
                Ok(_) => println!("Downloaded successfully!"),
                Err(e) => println!("Failed to fetch: {}", e),
            }
            continue;
        }

        // Get-blob command: get-blob <peer_number> <blob_id> <output>
        if parts[0] == "get-blob" {
            let args: Vec<&str> = input_str.splitn(4, ' ').collect();
            if args.len() < 4 {
                println!("Usage: get-blob <peer_number> <blob_id> <output_path>");
                continue;
            }

            let peer_idx: usize = match args[1].parse::<usize>() {
                Ok(n) if n >= 1 && n <= peers.len() => n - 1,
                _ => {
                    println!("Invalid peer number. Use 1-{}", peers.len());
                    continue;
                }
            };

            let blob_id = args[2];
            let output_path = PathBuf::from(args[3]);
            let abs_output = if output_path.is_absolute() {
                output_path
            } else {
                std::env::current_dir()?.join(output_path)
            };

            handle_get_blob(&endpoint, &peers, peer_idx, blob_id, &abs_output, data_dir).await;
            continue;
        }

        // Regular chat message: <number> <message>
        if parts.len() < 2 {
            println!("Usage: <peer_number> <message>");
            continue;
        }

        let peer_idx: usize = match parts[0].parse::<usize>() {
            Ok(n) if n >= 1 && n <= peers.len() => n - 1,
            _ => {
                println!("Invalid peer number. Use 1-{}", peers.len());
                continue;
            }
        };

        let peer = &peers[peer_idx];
        let message = parts[1];

        // Parse target endpoint address
        let addr = match parse_peer_addr(peer) {
            Ok(a) => a,
            Err(e) => {
                println!("{}", e);
                continue;
            }
        };

        // Connect and send
        match endpoint.connect(addr, RUHROH_ALPN).await {
            Ok(conn) => {
                let (mut send_stream, _recv_stream) = conn.open_bi().await?;
                let msg = RuhrohMessage::Chat {
                    from: config.display_name.clone(),
                    text: message.to_string(),
                };
                let msg_bytes = serde_json::to_vec(&msg)?;
                send_stream.write_all(&msg_bytes).await?;
                send_stream.finish()?;
                // Give time for the stream data to be transmitted
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                println!("  -> sent to {}", peer.display_name);
            }
            Err(e) => {
                println!("  Failed to connect to {}: {}", peer.display_name, e);
            }
        }
    }

    println!("\nShutting down...");
    router.shutdown().await?;

    Ok(())
}

/// Parse peer address from PeerInfo
///
/// Always uses node_id-only (no IP addresses, no stored endpoint_addr).
/// This forces iroh to use relay discovery, which is the approach we want
/// for haruspex - we only store node_id (public key), not addresses.
fn parse_peer_addr(peer: &PeerInfo) -> Result<EndpointAddr, String> {
    // ALWAYS use node_id only - this validates that relay discovery works
    // and we don't need to store/share IP addresses
    let target_id: PublicKey = peer
        .endpoint_id
        .parse()
        .map_err(|_| "Invalid endpoint ID for peer".to_string())?;
    Ok(EndpointAddr::from_parts(target_id, []))
}

/// Handle songs/playlists commands
async fn handle_freqhole_command(
    endpoint: &Endpoint,
    peers: &[PeerInfo],
    cmd: &str,
    peer_arg: Option<&str>,
) {
    let peer_idx: usize = if let Some(arg) = peer_arg {
        match arg.parse::<usize>() {
            Ok(n) if n >= 1 && n <= peers.len() => n - 1,
            _ => {
                println!("Invalid peer number. Use 1-{}", peers.len());
                return;
            }
        }
    } else {
        println!("Usage: {} <peer_number>", cmd);
        return;
    };

    let peer = &peers[peer_idx];
    let addr = match parse_peer_addr(peer) {
        Ok(a) => a,
        Err(e) => {
            println!("{}", e);
            return;
        }
    };

    let (path, label) = if cmd == "songs" {
        ("/api/songs/query", "songs")
    } else {
        ("/api/music/playlists/list", "playlists")
    };

    println!("Fetching {} from {}...", label, peer.display_name);

    match endpoint.connect(addr, RUHROH_ALPN).await {
        Ok(conn) => {
            let (mut send_stream, mut recv_stream) = match conn.open_bi().await {
                Ok(s) => s,
                Err(e) => {
                    println!("Failed to open stream: {}", e);
                    return;
                }
            };

            let body = serde_json::json!({"q": null, "limit": 10, "offset": null});
            let request = RuhrohMessage::ProxyRequest {
                id: 1,
                method: "POST".to_string(),
                path: path.to_string(),
                body: Some(body.to_string()),
            };
            let request_bytes = serde_json::to_vec(&request).unwrap();

            if let Err(e) = send_stream.write_all(&request_bytes).await {
                println!("Failed to send request: {}", e);
                return;
            }
            let _ = send_stream.finish();

            match recv_stream.read_to_end(1024 * 1024).await {
                Ok(response_bytes) => {
                    if let Ok(RuhrohMessage::ProxyResponse { status, body, .. }) =
                        serde_json::from_slice(&response_bytes)
                    {
                        if status >= 400 {
                            println!("Error {}: {}", status, body);
                        } else {
                            print_freqhole_response(cmd, &body);
                        }
                    } else {
                        println!("Invalid response");
                    }
                }
                Err(e) => println!("Failed to read response: {}", e),
            }
        }
        Err(e) => {
            println!("Failed to connect to {}: {}", peer.display_name, e);
        }
    }
}

/// Handle get-blob command
async fn handle_get_blob(
    endpoint: &Endpoint,
    peers: &[PeerInfo],
    peer_idx: usize,
    blob_id: &str,
    output_path: &PathBuf,
    data_dir: &PathBuf,
) {
    let peer = &peers[peer_idx];
    let addr = match parse_peer_addr(peer) {
        Ok(a) => a,
        Err(e) => {
            println!("{}", e);
            return;
        }
    };

    println!("Requesting blob {} from {}...", blob_id, peer.display_name);

    match endpoint.connect(addr, RUHROH_ALPN).await {
        Ok(conn) => {
            let (mut send_stream, mut recv_stream) = match conn.open_bi().await {
                Ok(s) => s,
                Err(e) => {
                    println!("Failed to open stream: {}", e);
                    return;
                }
            };

            let request = RuhrohMessage::BlobRequest {
                id: 1,
                blob_id: blob_id.to_string(),
            };
            let request_bytes = serde_json::to_vec(&request).unwrap();

            if let Err(e) = send_stream.write_all(&request_bytes).await {
                println!("Failed to send request: {}", e);
                return;
            }
            let _ = send_stream.finish();

            match recv_stream.read_to_end(1024 * 1024).await {
                Ok(response_bytes) => {
                    match serde_json::from_slice::<RuhrohMessage>(&response_bytes) {
                        Ok(RuhrohMessage::BlobResponse {
                            ticket: Some(ticket),
                            ..
                        }) => {
                            println!("Got ticket, fetching blob...");
                            match fetch_file_inner(&data_dir, &ticket, output_path).await {
                                Ok(_) => println!("Downloaded to {}!", output_path.display()),
                                Err(e) => println!("Failed to fetch blob: {}", e),
                            }
                        }
                        Ok(RuhrohMessage::BlobResponse {
                            error: Some(e), ..
                        }) => {
                            println!("Error: {}", e);
                        }
                        _ => println!("Invalid response"),
                    }
                }
                Err(e) => println!("Failed to read response: {}", e),
            }
        }
        Err(e) => {
            println!("Failed to connect to {}: {}", peer.display_name, e);
        }
    }
}

/// Make a proxy request to a peer and return the response
pub async fn proxy_request(
    data_dir: &PathBuf,
    central_url: &str,
    peer_name: &str,
    method: &str,
    path: &str,
    body: Option<String>,
) -> Result<String> {
    let secret_key = load_or_generate_key(data_dir).await?;
    let config = load_config(data_dir)?.context("Not registered. Run 'register' first.")?;

    // Get peers from central server
    let client = CentralClient::new(central_url).with_auth(&config.api_key);
    let peers = client.list_peers().await?;

    // Find peer by name
    let peer = peers
        .iter()
        .find(|p| p.display_name.to_lowercase() == peer_name.to_lowercase())
        .context(format!("Peer '{}' not found", peer_name))?;

    // Parse endpoint address
    let addr: EndpointAddr = if !peer.endpoint_addr.is_empty() {
        serde_json::from_str(&peer.endpoint_addr)?
    } else {
        let target_id: PublicKey = peer.endpoint_id.parse().context("Invalid endpoint ID")?;
        EndpointAddr::from_parts(target_id, [])
    };

    // Build endpoint
    let endpoint = Endpoint::builder().secret_key(secret_key).bind().await?;

    // Connect to peer
    println!("Connecting to {}...", peer.display_name);
    let conn = endpoint.connect(addr, RUHROH_ALPN).await?;

    // Open bidirectional stream
    let (mut send_stream, mut recv_stream) = conn.open_bi().await?;

    // Send proxy request
    let request = RuhrohMessage::ProxyRequest {
        id: 1,
        method: method.to_string(),
        path: path.to_string(),
        body,
    };
    let request_bytes = serde_json::to_vec(&request)?;
    send_stream.write_all(&request_bytes).await?;
    send_stream.finish()?;

    // Read response
    let response_bytes = recv_stream.read_to_end(1024 * 1024).await?;
    let response: RuhrohMessage = serde_json::from_slice(&response_bytes)?;

    match response {
        RuhrohMessage::ProxyResponse { status, body, .. } => {
            if status >= 400 {
                anyhow::bail!("HTTP {}: {}", status, body);
            }
            Ok(body)
        }
        _ => anyhow::bail!("Unexpected response type"),
    }
}

/// Fetch songs from a peer's freqhole server
pub async fn fetch_songs(
    data_dir: &PathBuf,
    central_url: &str,
    peer_name: &str,
    limit: u32,
) -> Result<()> {
    let body = serde_json::json!({
        "q": null,
        "limit": limit,
        "offset": null
    });

    println!("Fetching songs from {}...\n", peer_name);
    let response = proxy_request(
        data_dir,
        central_url,
        peer_name,
        "POST",
        "/api/songs/query",
        Some(body.to_string()),
    )
    .await?;

    // Pretty print the response
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response) {
        if let Some(songs) = json.get("items").and_then(|i| i.as_array()) {
            println!("Found {} songs:\n", songs.len());
            for song in songs {
                let title = song
                    .get("title")
                    .and_then(|t| t.as_str())
                    .unwrap_or("Unknown");
                let artist = song
                    .get("artist_name")
                    .and_then(|a| a.as_str())
                    .unwrap_or("Unknown");
                let album = song
                    .get("album_title")
                    .and_then(|a| a.as_str())
                    .unwrap_or("Unknown");
                println!("  {} - {} ({})", artist, title, album);
            }
        } else {
            println!("{}", serde_json::to_string_pretty(&json)?);
        }
    } else {
        println!("{}", response);
    }

    Ok(())
}

/// Fetch playlists from a peer's freqhole server
pub async fn fetch_playlists(
    data_dir: &PathBuf,
    central_url: &str,
    peer_name: &str,
    limit: u32,
) -> Result<()> {
    let body = serde_json::json!({
        "q": null,
        "limit": limit,
        "offset": null
    });

    println!("Fetching playlists from {}...\n", peer_name);
    let response = proxy_request(
        data_dir,
        central_url,
        peer_name,
        "POST",
        "/api/music/playlists/list",
        Some(body.to_string()),
    )
    .await?;

    // Pretty print the response
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response) {
        if let Some(playlists) = json.get("items").and_then(|i| i.as_array()) {
            println!("Found {} playlists:\n", playlists.len());
            for playlist in playlists {
                let name = playlist
                    .get("title")
                    .and_then(|t| t.as_str())
                    .unwrap_or("Untitled");
                let count = playlist
                    .get("song_count")
                    .and_then(|c| c.as_u64())
                    .unwrap_or(0);
                println!("  {} ({} songs)", name, count);
            }
        } else {
            println!("{}", serde_json::to_string_pretty(&json)?);
        }
    } else {
        println!("{}", response);
    }

    Ok(())
}

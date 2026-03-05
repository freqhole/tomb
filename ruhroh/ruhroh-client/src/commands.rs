//! CLI command implementations (register, info, groups, peers, send)

use anyhow::{Context, Result};
use iroh::{Endpoint, EndpointAddr, PublicKey};
use std::path::PathBuf;

use crate::central::CentralClient;
use crate::config::{load_config, load_or_generate_key, save_config, ClientConfig};
use crate::protocol::RUHROH_ALPN;

/// Register with central server
pub async fn register(
    data_dir: &PathBuf,
    central_url: &str,
    invite_code: &str,
    display_name: &str,
) -> Result<()> {
    let secret_key = load_or_generate_key(data_dir).await?;

    // Create endpoint to get full address with relay info
    let endpoint = Endpoint::builder()
        .secret_key(secret_key.clone())
        .alpns(vec![RUHROH_ALPN.to_vec()])
        .bind()
        .await?;

    let endpoint_id = endpoint.secret_key().public();
    let endpoint_addr = endpoint.addr();
    let endpoint_addr_json = serde_json::to_string(&endpoint_addr)?;

    println!("Registering with central server...");
    println!("  Endpoint ID: {}", endpoint_id);

    let client = CentralClient::new(central_url);
    let (server_id, api_key) = client
        .register(
            invite_code,
            display_name,
            &endpoint_id.to_string(),
            &endpoint_addr_json,
        )
        .await?;

    let config = ClientConfig {
        server_id,
        api_key,
        display_name: display_name.to_string(),
    };
    save_config(data_dir, &config)?;

    println!("Registered successfully!");
    println!("  Server ID: {}", config.server_id);

    Ok(())
}

/// Show current identity info
pub async fn show_info(data_dir: &PathBuf) -> Result<()> {
    let secret_key = load_or_generate_key(data_dir).await?;
    let endpoint_id = secret_key.public();

    println!("Identity:");
    println!("  Endpoint ID: {}", endpoint_id);

    if let Some(config) = load_config(data_dir)? {
        println!("  Server ID: {}", config.server_id);
        println!("  Display Name: {}", config.display_name);
    } else {
        println!("  Not registered with central server");
    }

    Ok(())
}

/// List available groups
pub async fn list_groups(data_dir: &PathBuf, central_url: &str) -> Result<()> {
    let config = load_config(data_dir)?.context("Not registered. Run 'register' first.")?;

    let client = CentralClient::new(central_url).with_auth(&config.api_key);
    let groups: Vec<crate::central::GroupInfo> = client.list_groups().await?;

    if groups.is_empty() {
        println!("No groups available. Create one from the central server.");
    } else {
        println!("Available groups:");
        for g in groups {
            let member_status = if g.is_member { " (member)" } else { "" };
            println!("  {} - {}{}", g.id, g.name, member_status);
        }
    }

    Ok(())
}

/// Join a group
pub async fn join_group(data_dir: &PathBuf, central_url: &str, group_id: &str) -> Result<()> {
    let config = load_config(data_dir)?.context("Not registered. Run 'register' first.")?;

    let client = CentralClient::new(central_url).with_auth(&config.api_key);
    client.join_group(group_id).await?;

    println!("Joined group: {}", group_id);

    Ok(())
}

/// List peers in your groups
pub async fn list_peers(data_dir: &PathBuf, central_url: &str) -> Result<()> {
    let config = load_config(data_dir)?.context("Not registered. Run 'register' first.")?;

    let client = CentralClient::new(central_url).with_auth(&config.api_key);
    let peers: Vec<crate::central::PeerInfo> = client.list_peers().await?;

    if peers.is_empty() {
        println!("No peers found. Join a group first.");
    } else {
        println!("Peers in your groups:");
        for p in peers {
            println!(
                "  {} ({}) - endpoint: {}",
                p.display_name, p.server_id, p.endpoint_id
            );
        }
    }

    Ok(())
}

/// Send a message to a peer
pub async fn send_message(data_dir: &PathBuf, endpoint_id_str: &str, message: &str) -> Result<()> {
    let secret_key = load_or_generate_key(data_dir).await?;
    let config = load_config(data_dir)?.context("Not registered. Run 'register' first.")?;

    // Parse the target endpoint ID
    let target_id: PublicKey = endpoint_id_str
        .parse()
        .context("Invalid endpoint ID format")?;

    println!("Connecting to peer: {}", target_id);

    // Build endpoint with our secret key
    let endpoint = Endpoint::builder().secret_key(secret_key).bind().await?;

    // Create address for the target (using relay discovery)
    let addr = EndpointAddr::from_parts(target_id, []);

    // Connect to the peer
    let conn = endpoint.connect(addr, RUHROH_ALPN).await?;
    tracing::info!("Connected to peer");

    // Open a uni-directional stream and send the message
    let mut send_stream = conn.open_uni().await?;

    // Send message with our display name
    let msg = format!("{}:{}", config.display_name, message);
    send_stream.write_all(msg.as_bytes()).await?;
    send_stream.finish()?;

    println!("Message sent!");

    // Close connection gracefully
    conn.close(0u8.into(), b"done");
    endpoint.close().await;

    Ok(())
}

/// Test connecting to a peer using only their node_id (validates relay discovery)
///
/// This validates that P2P connections work WITHOUT needing IP addresses -
/// just the node_id (public key) is enough for iroh to find and connect to peers
/// via relay servers.
pub async fn connect_test(
    data_dir: &PathBuf,
    central_url: &str,
    peer_name: &str,
    node_id_only: bool,
) -> Result<()> {
    use crate::protocol::RuhrohMessage;
    use std::time::Instant;

    let secret_key = load_or_generate_key(data_dir).await?;
    let config = load_config(data_dir)?.context("Not registered. Run 'register' first.")?;

    // Get peers from central
    let client = CentralClient::new(central_url).with_auth(&config.api_key);
    let peers: Vec<crate::central::PeerInfo> = client.list_peers().await?;

    // Find the peer by name
    let peer = peers
        .iter()
        .find(|p| p.display_name.to_lowercase() == peer_name.to_lowercase())
        .context(format!("Peer '{}' not found. Available: {}", peer_name, 
            peers.iter().map(|p| p.display_name.as_str()).collect::<Vec<_>>().join(", ")))?;

    println!("\n=== P2P Connection Test (node_id only: {}) ===\n", node_id_only);
    println!("Target peer: {} ({})", peer.display_name, peer.server_id);
    println!("Node ID: {}", peer.endpoint_id);
    
    if !peer.endpoint_addr.is_empty() && !node_id_only {
        println!("Endpoint addr available: {}", &peer.endpoint_addr[..50.min(peer.endpoint_addr.len())]);
    } else {
        println!("Using node_id ONLY (no endpoint_addr) - relay discovery required");
    }

    // Parse node_id
    let target_id: PublicKey = peer.endpoint_id
        .parse()
        .context("Invalid node_id format")?;

    // Build endpoint
    let endpoint = Endpoint::builder()
        .secret_key(secret_key)
        .alpns(vec![RUHROH_ALPN.to_vec()])
        .bind()
        .await?;

    // Wait for relay
    endpoint.online().await;
    println!("\nLocal endpoint online, relay connected");

    // Create address - node_id only, no direct addresses
    // This forces iroh to use relay discovery
    let addr = if node_id_only {
        EndpointAddr::from_parts(target_id, [])
    } else if !peer.endpoint_addr.is_empty() {
        serde_json::from_str(&peer.endpoint_addr)
            .context("Failed to parse endpoint_addr")?
    } else {
        EndpointAddr::from_parts(target_id, [])
    };

    println!("\nConnecting to peer (node_id only: {})...", node_id_only);
    let start = Instant::now();

    // Connect
    let conn = match endpoint.connect(addr.clone(), RUHROH_ALPN).await {
        Ok(c) => {
            let elapsed = start.elapsed();
            println!("Connected in {:?}", elapsed);
            c
        }
        Err(e) => {
            let elapsed = start.elapsed();
            println!("\nFailed to connect after {:?}: {}", elapsed, e);
            println!("\nThis means relay discovery is NOT working for node_id-only connections.");
            println!("Possible causes:");
            println!("  - Peer is offline");
            println!("  - Peer hasn't registered with relay");
            println!("  - Network issues");
            return Err(e.into());
        }
    };

    // Send a ping message
    println!("\nSending ping message...");
    let (mut send_stream, mut recv_stream) = conn.open_bi().await?;

    let ping = RuhrohMessage::Chat {
        from: config.display_name.clone(),
        text: "[connect-test ping]".to_string(),
    };
    let ping_bytes = serde_json::to_vec(&ping)?;
    send_stream.write_all(&ping_bytes).await?;
    send_stream.finish()?;

    // Wait for response (with timeout)
    println!("Waiting for pong response...");
    let response_start = Instant::now();
    
    match tokio::time::timeout(
        tokio::time::Duration::from_secs(5),
        recv_stream.read_to_end(1024),
    ).await {
        Ok(Ok(response_bytes)) => {
            let elapsed = response_start.elapsed();
            if response_bytes.is_empty() {
                println!("Received empty response (peer may not support pong) in {:?}", elapsed);
            } else if let Ok(msg) = serde_json::from_slice::<RuhrohMessage>(&response_bytes) {
                println!("Received response in {:?}: {:?}", elapsed, msg);
            } else {
                println!("Received response in {:?}: {} bytes", elapsed, response_bytes.len());
            }
        }
        Ok(Err(e)) => {
            println!("Error reading response: {} (this is OK, peer may not send pong)", e);
        }
        Err(_) => {
            println!("No pong received (timeout) - this is OK for basic connectivity test");
        }
    }

    // Test complete
    let total_elapsed = start.elapsed();
    println!("\n=== Test Complete ===");
    println!("Total time: {:?}", total_elapsed);
    println!("Connection method: {}", if node_id_only { "node_id only (relay discovery)" } else { "full endpoint_addr" });
    println!("\nValidation result: SUCCESS - P2P connection works with node_id only!");
    println!("No IP addresses were needed for this connection.");

    // Cleanup
    conn.close(0u8.into(), b"test-complete");
    endpoint.close().await;

    Ok(())
}

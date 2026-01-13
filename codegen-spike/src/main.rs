//! Codegen Spike - Prototype for API client generation
//!
//! This spike demonstrates:
//! - Route registry as single source of truth
//! - Axum server using route registry
//! - TypeScript client generation from routes
//! - Clear separation between server and codegen
//!
//! Run modes:
//! - `cargo run --bin server` - Start Axum server
//! - `cargo run --bin codegen` - Generate TypeScript client

mod codegen;
mod server;
mod types;

use server::routes;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Check if we're running as server or codegen
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(|s| s.as_str()).unwrap_or("help");

    match mode {
        "server" => run_server().await,
        "codegen" => run_codegen(),
        _ => {
            println!("Usage:");
            println!("  cargo run server   - Start Axum server");
            println!("  cargo run codegen  - Generate TypeScript client");
            Ok(())
        }
    }
}

async fn run_server() -> Result<(), Box<dyn std::error::Error>> {
    println!("Starting server on http://localhost:3000");

    let app = server::build_router();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .unwrap();

    println!("Server listening on http://localhost:3000");
    println!("\nTry:");
    println!("  curl http://localhost:3000/api/music/playlists/list \\");
    println!("    -X POST \\");
    println!("    -H 'Content-Type: application/json' \\");
    println!("    -d '{{\"limit\": 10}}'");
    println!();

    axum::serve(listener, app).await.unwrap();

    Ok(())
}

fn run_codegen() -> Result<(), Box<dyn std::error::Error>> {
    let definitions = routes::define_routes();
    codegen::generate_all(definitions)?;
    Ok(())
}

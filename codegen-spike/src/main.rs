//! Codegen spike - API client generation prototype

mod codegen;
mod server;
mod types;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let mode = args.get(1).map(|s| s.as_str()).unwrap_or("help");

    match mode {
        "server" => {
            let app = server::build_router();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await?;
            println!("Server running on http://localhost:3000");
            axum::serve(listener, app).await?;
            Ok(())
        }
        "codegen" => codegen::generate_all(),
        _ => {
            println!("Usage: cargo run [server|codegen]");
            Ok(())
        }
    }
}

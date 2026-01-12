use clap::Parser;
use cli::Cli;

#[tokio::main]
async fn main() {
    if std::env::var("RUST_LOG").is_err() {
        std::env::set_var("RUST_LOG", "INFO");
    }
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();
    if let Err(e) = cli.run().await {
        eprintln!("CLI error: {}", e);
        std::process::exit(1);
    }
}

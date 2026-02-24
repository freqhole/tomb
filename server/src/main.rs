//! server binary entry point

use clap::Parser;

/// freqhole server
#[derive(Parser, Debug)]
#[command(name = "freqhole-server")]
#[command(about = "freqhole music server")]
struct Args {
    /// path to configuration file
    #[arg(long, short = 'c', default_value = "assets/config/config.jsonc")]
    config: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    let options = server::ServerOptions {
        config_path: args.config.into(),
    };

    server::run_server(options).await
}

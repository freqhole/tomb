//! freqhole CLI entrypoint. all logic lives in the `cli` library
//! (`cli/src/lib.rs`); this thin shim exists only to provide the
//! tokio runtime + `fn main` symbol for the `rathole` binary.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    cli::run().await
}

//! Job queue management CLI commands

use clap::Subcommand;

#[derive(Subcommand)]
pub enum JobAction {
    /// List jobs in the queue
    List {
        /// Filter by session ID
        #[arg(long)]
        session_id: Option<String>,
        /// Maximum number of jobs to list
        #[arg(long, default_value = "20")]
        limit: usize,
    },
    /// Show job processing statistics
    Stats,
    /// Scan a directory for music files and create jobs
    Scan {
        /// Path to scan
        path: String,
        /// Scan directories recursively
        #[arg(long)]
        recursive: bool,
        /// Maximum recursion depth (only with --recursive)
        #[arg(long)]
        max_depth: Option<usize>,
    },
    /// Process a single file directly
    ProcessFile {
        /// Path to the file to process
        path: String,
    },
    /// Run the job processor
    RunProcessor {
        /// Maximum number of jobs to process (0 = unlimited)
        #[arg(long, default_value = "0")]
        max_jobs: usize,
        /// Process jobs once and exit (don't loop)
        #[arg(long)]
        once: bool,
    },
}

/// Handle job commands
pub async fn handle_command(action: JobAction) -> anyhow::Result<()> {
    match action {
        JobAction::List { session_id, limit } => {
            // TODO: Move implementation from cli.rs
            println!("List jobs: session_id={:?}, limit={}", session_id, limit);
            Ok(())
        }
        JobAction::Stats => {
            // TODO: Move implementation from cli.rs
            println!("Job stats");
            Ok(())
        }
        JobAction::Scan {
            path,
            recursive,
            max_depth,
        } => {
            // TODO: Move implementation from cli.rs
            println!(
                "Scan: path={}, recursive={}, max_depth={:?}",
                path, recursive, max_depth
            );
            Ok(())
        }
        JobAction::ProcessFile { path } => {
            // TODO: Move implementation from cli.rs
            println!("Process file: {}", path);
            Ok(())
        }
        JobAction::RunProcessor { max_jobs, once } => {
            // TODO: Move implementation from cli.rs
            println!("Run processor: max_jobs={}, once={}", max_jobs, once);
            Ok(())
        }
    }
}

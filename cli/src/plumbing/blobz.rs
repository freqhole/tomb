//! blake3 hash management CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::blobz::backfill_blake3_hashes;
use grimoire::media_blobz::count_blobs_needing_blake3;
use serde::Serialize;

#[derive(Serialize)]
struct Blake3Status {
    needing_blake3: i64,
    message: String,
}

#[derive(Serialize)]
struct Blake3BackfillResult {
    processed: i64,
    remaining: i64,
    batches: i64,
}

const BATCH_SIZE: i64 = 100;

#[derive(Subcommand)]
pub enum BlobzAction {
    /// Show status of blake3 hash computation
    Blake3Status,

    /// Backfill blake3 hashes for audio files that don't have them
    BackfillBlake3 {
        /// Maximum number of blobs to process (omit to process all)
        #[arg(long)]
        limit: Option<i64>,

        /// Show what would be processed without actually computing
        #[arg(long)]
        dry_run: bool,
    },
}

/// handle blobz commands
pub async fn handle_command(action: BlobzAction) -> CommandOutput<serde_json::Value> {
    match action {
        BlobzAction::Blake3Status => {
            match count_blobs_needing_blake3().await {
                Ok(count) => {
                    let status = Blake3Status {
                        needing_blake3: count,
                        message: if count == 0 {
                            "all audio blobs have blake3 hashes".to_string()
                        } else {
                            format!("{} audio blobs need blake3 hashes", count)
                        },
                    };
                    CommandOutput::success(
                        status.message.clone(),
                        serde_json::to_value(status).unwrap(),
                    )
                }
                Err(e) => CommandOutput::failure(format!("failed to check blake3 status: {}", e), vec![], ()),
            }
        }

        BlobzAction::BackfillBlake3 { limit, dry_run } => {
            if dry_run {
                match count_blobs_needing_blake3().await {
                    Ok(count) => {
                        let process_count = limit.map(|l| std::cmp::min(count, l)).unwrap_or(count);
                        let result = Blake3BackfillResult {
                            processed: 0,
                            remaining: count,
                            batches: 0,
                        };
                        CommandOutput::success(
                            format!(
                                "[dry run] would process {} blobs needing blake3",
                                process_count
                            ),
                            serde_json::to_value(result).unwrap(),
                        )
                    }
                    Err(e) => CommandOutput::failure(format!("failed to check blake3 status: {}", e), vec![], ()),
                }
            } else {
                // process in batches until done or limit reached
                let mut total_processed: i64 = 0;
                let mut batches: i64 = 0;
                let mut remaining: i64 = 0;

                loop {
                    // determine batch size for this iteration
                    let batch_limit = match limit {
                        Some(l) => {
                            let left = l - total_processed;
                            if left <= 0 {
                                break;
                            }
                            std::cmp::min(BATCH_SIZE, left)
                        }
                        None => BATCH_SIZE,
                    };

                    match backfill_blake3_hashes(batch_limit).await {
                        Ok((processed, rem)) => {
                            total_processed += processed;
                            remaining = rem;
                            batches += 1;

                            eprintln!("batch {}: processed {}, {} remaining", batches, processed, rem);

                            // stop if no progress (avoid infinite loop) or done
                            if processed == 0 || rem == 0 {
                                break;
                            }
                        }
                        Err(e) => {
                            return CommandOutput::failure(format!("backfill failed: {}", e), vec![], ());
                        }
                    }
                }

                let result = Blake3BackfillResult {
                    processed: total_processed,
                    remaining,
                    batches,
                };
                let message = format!(
                    "processed {} blobs in {} batches, {} remaining",
                    total_processed, batches, remaining
                );
                CommandOutput::success(message, serde_json::to_value(result).unwrap())
            }
        }
    }
}

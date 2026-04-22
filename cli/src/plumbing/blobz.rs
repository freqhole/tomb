//! blake3 hash management CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::blobz::backfill_blake3_hashes;
use grimoire::media_blobz::{
    count_blobs_needing_blake3, find_present_blake3s, find_present_sha256s,
};
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

#[derive(Serialize)]
struct HasBlobsResult {
    blake3s_present: Vec<String>,
    blake3s_missing: Vec<String>,
    sha256s_present: Vec<String>,
    sha256s_missing: Vec<String>,
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

    /// check which of the supplied content hashes already exist locally.
    /// mirrors the `POST /api/blobz/has` route used by send-to-remote.
    Has {
        /// blake3 hash (repeatable). hex string addressed by iroh-blobs.
        #[arg(long = "blake3", value_name = "HEX")]
        blake3: Vec<String>,
        /// sha256 hash (repeatable). hex string used as the dedupe key.
        #[arg(long = "sha256", value_name = "HEX")]
        sha256: Vec<String>,
    },
}

/// handle blobz commands
pub async fn handle_command(action: BlobzAction) -> CommandOutput<serde_json::Value> {
    match action {
        BlobzAction::Blake3Status => match count_blobs_needing_blake3().await {
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
            Err(e) => {
                CommandOutput::failure(format!("failed to check blake3 status: {}", e), vec![], ())
            }
        },

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
                    Err(e) => CommandOutput::failure(
                        format!("failed to check blake3 status: {}", e),
                        vec![],
                        (),
                    ),
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

                            eprintln!(
                                "batch {}: processed {}, {} remaining",
                                batches, processed, rem
                            );

                            // stop if no progress (avoid infinite loop) or done
                            if processed == 0 || rem == 0 {
                                break;
                            }
                        }
                        Err(e) => {
                            return CommandOutput::failure(
                                format!("backfill failed: {}", e),
                                vec![],
                                (),
                            );
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

        BlobzAction::Has { blake3, sha256 } => {
            let blake3s_present = match find_present_blake3s(&blake3).await {
                Ok(v) => v,
                Err(e) => {
                    return CommandOutput::failure(
                        format!("failed to query blake3 presence: {}", e),
                        vec![],
                        (),
                    );
                }
            };
            let sha256s_present = match find_present_sha256s(&sha256).await {
                Ok(v) => v,
                Err(e) => {
                    return CommandOutput::failure(
                        format!("failed to query sha256 presence: {}", e),
                        vec![],
                        (),
                    );
                }
            };
            let blake3_set: std::collections::HashSet<&str> =
                blake3s_present.iter().map(String::as_str).collect();
            let sha256_set: std::collections::HashSet<&str> =
                sha256s_present.iter().map(String::as_str).collect();
            let blake3s_missing: Vec<String> = blake3
                .iter()
                .filter(|h| !blake3_set.contains(h.as_str()))
                .cloned()
                .collect();
            let sha256s_missing: Vec<String> = sha256
                .iter()
                .filter(|h| !sha256_set.contains(h.as_str()))
                .cloned()
                .collect();

            let result = HasBlobsResult {
                blake3s_present,
                blake3s_missing,
                sha256s_present,
                sha256s_missing,
            };
            CommandOutput::success(
                format!(
                    "checked {} blake3 + {} sha256 hashes",
                    blake3.len(),
                    sha256.len()
                ),
                serde_json::to_value(result).unwrap(),
            )
        }
    }
}

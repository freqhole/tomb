//! pre-check fetch processor
//!
//! spawns yt-dlp with --flat-playlist and streams stdout line by line,
//! emitting stage events with a running count as items arrive. checks
//! db cancellation every 5 seconds and kills the process if cancelled.

use crate::config::get_config;
use crate::jobs::models::{Job, JobError, JobType};
use crate::jobs::{get_job, job_events};
use crate::music::fetch::{
    check_existing_content, ContentMetadata, PreCheckFetchParams, PreCheckFetchResponse,
};
use serde_json::Value;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tracing::{info, warn};

/// process a pre-check fetch job
pub async fn process_precheck_fetch_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing precheck fetch job: {}", job.id);

    let params: PreCheckFetchParams = match serde_json::from_str(&job.parameters) {
        Ok(p) => p,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("invalid parameters: {}", e),
            })
        }
    };

    let config = get_config();

    let fetch_config = config
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .ok_or_else(|| JobError::ProcessingFailedFinal {
            reason: "fetch_music not configured".to_string(),
            error_type: "fetch_not_configured".to_string(),
        })?;

    if !fetch_config.enabled {
        return Err(JobError::ProcessingFailedFinal {
            reason: "fetch_music is not enabled".to_string(),
            error_type: "fetch_not_enabled".to_string(),
        });
    }

    let precheck_cmd = fetch_config.precheck_command.as_ref().ok_or_else(|| {
        JobError::ProcessingFailedFinal {
            reason: "precheck_command not configured".to_string(),
            error_type: "fetch_precheck_command_not_configured".to_string(),
        }
    })?;

    let parts: Vec<&str> = precheck_cmd.split_whitespace().collect();
    if parts.is_empty() {
        return Err(JobError::ProcessingFailed {
            reason: "precheck_command is empty".to_string(),
        });
    }

    let (cmd, args) = parts.split_first().unwrap();

    job_events::emit_stage_from_job(job, "precheck_started", Some(&params.url));

    // spawn yt-dlp with --flat-playlist so each playlist entry is emitted
    // immediately as a single line rather than waiting for per-video page loads.
    // also inject --ignore-errors (unless already present) so a playlist
    // containing some private/removed videos doesn't abort the whole
    // precheck - the empty-check below already tolerates a non-zero exit
    // when some entries were extracted anyway, but this avoids yt-dlp
    // bailing out early before reaching later playlist entries.
    let mut command = Command::new(cmd);
    command.args(args);
    if !precheck_cmd.contains("--flat-playlist") {
        command.arg("--flat-playlist");
    }
    if !precheck_cmd.contains("--ignore-errors") && !precheck_cmd.contains(" -i ") {
        command.arg("--ignore-errors");
    }
    command
        .arg("--")
        .arg(&params.url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|e| JobError::ProcessingFailed {
        reason: format!("failed to spawn precheck command: {}", e),
    })?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    // drain stderr in a background task so its buffer never blocks stdout
    let stderr_task: tokio::task::JoinHandle<String> = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buf = String::new();
        let _ = reader.read_to_string(&mut buf).await;
        buf
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut metadata_list: Vec<ContentMetadata> = Vec::new();

    // poll db for cancellation every 5 seconds
    let mut cancel_check = tokio::time::interval(Duration::from_secs(5));
    cancel_check.tick().await; // skip the immediate first tick

    'read: loop {
        tokio::select! {
            biased; // prefer reading lines over the cancel timer
            line = lines.next_line() => {
                match line {
                    Ok(Some(l)) => {
                        let l = l.trim().to_string();
                        if l.is_empty() {
                            continue;
                        }
                        match ContentMetadata::from_json(&l) {
                            Ok(metadata) => {
                                metadata_list.push(metadata);
                                let n = metadata_list.len();
                                // emit progress on the first item and every 5 after
                                if n == 1 || n.is_multiple_of(5) {
                                    job_events::emit_stage_from_job(
                                        job,
                                        "precheck_progress",
                                        Some(&format!("found {} track(s)...", n)),
                                    );
                                }
                            }
                            Err(e) => warn!("precheck: skipped unparseable line: {}", e),
                        }
                    }
                    Ok(None) => break 'read, // stdout closed, process done
                    Err(e) => {
                        let _ = child.kill().await;
                        return Err(JobError::ProcessingFailed {
                            reason: format!("error reading precheck output: {}", e),
                        });
                    }
                }
            }
            _ = cancel_check.tick() => {
                // check if the job was marked cancelled via API while running
                if let Some(current) = get_job(&job.id).await.data {
                    if current.status == "Cancelled" {
                        info!("precheck job {} cancelled, killing process", job.id);
                        let _ = child.kill().await;
                        return Err(JobError::ProcessingFailed {
                            reason: "cancelled by user".to_string(),
                        });
                    }
                }
            }
        }
    }

    let exit_status = child.wait().await.map_err(|e| JobError::ProcessingFailed {
        reason: format!("failed to wait for precheck process: {}", e),
    })?;
    let stderr_output = stderr_task.await.unwrap_or_default();

    if !exit_status.success() && metadata_list.is_empty() {
        return Err(JobError::ProcessingFailed {
            reason: format!("precheck command failed: {}", stderr_output.trim()),
        });
    }

    let total_items = metadata_list.len();
    info!("precheck found {} item(s)", total_items);

    job_events::emit_stage_from_job(
        job,
        "precheck_complete",
        Some(&format!("{} item(s) found", total_items)),
    );

    // check for existing content so we can flag duplicates
    let existing = check_existing_content(&metadata_list).await;
    let duplicate_count = existing.len();
    let existing_ids: std::collections::HashSet<String> =
        existing.into_iter().map(|(k, _)| k).collect();

    for item in &mut metadata_list {
        if existing_ids.contains(&item.content_id) {
            item.is_duplicate = Some(true);
        }
    }

    if duplicate_count > 0 {
        job_events::emit(job_events::JobEvent::Stage {
            session_id: job.session_id.clone(),
            job_id: job.id.clone(),
            stage: "dedup".to_string(),
            message: Some(format!("{} item(s) already present", duplicate_count)),
            topic: JobType::PreCheckFetch,
            entity_ref: None,
            created_by: job.created_by.clone(),
        });
    }

    let playlist_title = metadata_list.first().and_then(|m| m.playlist_title.clone());
    let platform = metadata_list.first().map(|m| m.platform.clone());
    let total_duration_seconds: Option<i64> = {
        let sum: i64 = metadata_list
            .iter()
            .filter_map(|m| m.duration_seconds)
            .sum();
        if sum > 0 {
            Some(sum)
        } else {
            None
        }
    };

    let response = PreCheckFetchResponse {
        item_count: total_items,
        playlist_title,
        platform,
        total_duration_seconds,
        items: metadata_list,
        duplicate_count,
    };

    let result = serde_json::to_value(&response).map_err(|e| JobError::ProcessingFailed {
        reason: format!("failed to serialize precheck result: {}", e),
    })?;

    Ok(Some(result))
}

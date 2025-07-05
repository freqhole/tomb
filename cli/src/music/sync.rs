//! Scan session management and status tracking

use grimoire::music::MusicService;
use uuid::Uuid;

/// Handle scan session status command
pub async fn handle_status(
    service: &MusicService<'_>,
    active_only: bool,
    verbose: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let sessions = service.list_sessions(active_only).await?;

    if sessions.is_empty() {
        if active_only {
            println!("No active scan sessions found.");
        } else {
            println!("No scan sessions found.");
        }
        return Ok(());
    }

    println!("🎵 Music Scan Sessions:");
    println!();

    for session in sessions {
        println!(
            "📋 Session: {}",
            session.session_name.unwrap_or("Unnamed".to_string())
        );
        println!("   🆔 ID: {}", session.id);
        println!("   📁 Path: {}", session.base_path);
        println!("   📊 Status: {}", session.status);

        if let Some(total) = session.total_files {
            let percentage = if total > 0 {
                (session.processed_files as f32 / total as f32) * 100.0
            } else {
                0.0
            };
            println!(
                "   🎯 Progress: {}/{} ({:.1}%)",
                session.processed_files, total, percentage
            );
        } else {
            println!(
                "   🎯 Progress: {} files processed",
                session.processed_files
            );
        }

        if verbose {
            println!("   ➕ Songs added: {}", session.songs_added);
            println!("   🔄 Songs updated: {}", session.songs_updated);
            println!("   ⏭️  Songs skipped: {}", session.songs_skipped);
            println!("   ❌ Errors: {}", session.errors_encountered);
        }

        println!();
    }

    Ok(())
}

/// Handle scan session info command
pub async fn handle_info(
    service: &MusicService<'_>,
    session_id: Uuid,
) -> Result<(), Box<dyn std::error::Error>> {
    let stats = service.get_session_stats(session_id).await?;

    println!("🎵 Music Scan Session Details");
    println!();
    println!("🆔 Session ID: {}", session_id);
    println!("📁 Base Path: {}", stats.base_path);
    println!("📊 Status: {:?}", stats.status);

    if let Some(total) = stats.total_files {
        let percentage = if total > 0 {
            (stats.processed_files as f32 / total as f32) * 100.0
        } else {
            0.0
        };
        println!(
            "🎯 Progress: {}/{} ({:.1}%)",
            stats.processed_files, total, percentage
        );
    }

    if let Some(elapsed) = stats.elapsed_time_minutes {
        println!("⏱️  Elapsed Time: {} minutes", elapsed);
    }

    if let Some(remaining) = stats.estimated_remaining_minutes {
        println!("⏳ Estimated Remaining: {} minutes", remaining);
    }

    println!();
    println!("📈 Statistics:");
    println!("   ➕ Songs Added: {}", stats.songs_added);
    println!("   🔄 Songs Updated: {}", stats.songs_updated);
    println!("   ⏭️  Songs Skipped: {}", stats.songs_skipped);
    println!("   ❌ Errors: {}", stats.errors_encountered);

    println!();
    println!("💼 Job Queue Status:");
    println!("   ⏳ Pending Jobs: {}", stats.jobs_pending);
    println!("   🔄 In Progress: {}", stats.jobs_in_progress);
    println!("   ✅ Completed: {}", stats.jobs_completed);
    println!("   ❌ Failed: {}", stats.jobs_failed);

    Ok(())
}

/// Handle cancel scan session command
pub async fn handle_cancel(
    service: &MusicService<'_>,
    session_id: Uuid,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("🛑 Cancelling scan session: {}", session_id);

    let success = service.cancel_session(session_id).await?;

    if success {
        println!("✅ Session cancelled successfully");
    } else {
        println!("❌ Failed to cancel session (it may not exist or already be completed)");
    }

    Ok(())
}

/// Handle cleanup old sessions command
pub async fn handle_cleanup(
    service: &MusicService<'_>,
    days: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    println!("🧹 Cleaning up scan sessions older than {} days...", days);

    let result = service.cleanup_old_sessions(days).await?;

    println!("✅ Cleanup completed:");
    println!("   🗑️  Sessions deleted: {}", result.sessions_deleted);
    println!("   🗑️  Jobs deleted: {}", result.jobs_deleted);

    Ok(())
}

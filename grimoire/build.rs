//! build script for grimoire - creates SQL views before compile-time sqlx checks
//!
//! this runs before cargo compiles the crate, ensuring views exist in the database
//! when sqlx::query_as! macros do their compile-time verification.
//!
//! DATABASE_URL is set in .cargo/config.toml with relative = true

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

fn main() {
    // skip if SQLX_OFFLINE (CI/Docker) or no DATABASE_URL
    if std::env::var("SQLX_OFFLINE").is_ok() {
        return;
    }

    let Ok(url) = std::env::var("DATABASE_URL") else {
        return;
    };

    let db_path = url.strip_prefix("sqlite:").unwrap_or(&url);

    if !Path::new(db_path).exists() {
        return;
    }

    // create views in dependency order (artist first, then others that reference it)
    let views_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("migrations/views");

    for view_file in [
        "artist_query_view.sql",
        "album_query_view.sql",
        "genre_query_view.sql",
        "song_query_view.sql",
        "playlist_query_view.sql",
        "playlist_song_query_view.sql",
        "feed_query_view.sql",
    ] {
        let sql_path = views_dir.join(view_file);
        let Ok(sql) = std::fs::read_to_string(&sql_path) else {
            continue;
        };

        let Ok(mut child) = Command::new("sqlite3")
            .arg(db_path)
            .stdin(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        else {
            continue;
        };

        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(sql.as_bytes());
        }

        if let Ok(out) = child.wait_with_output() {
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr);
                println!("cargo:warning=view {}: {}", view_file, stderr.trim());
            }
        }
    }
}

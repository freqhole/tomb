//! build script for grimoire - creates SQL views before compile-time sqlx checks
//!
//! this runs before cargo compiles the crate, ensuring views exist in the database
//! when sqlx::query_as! macros do their compile-time verification.
//!
//! DATABASE_URL is computed here from CARGO_MANIFEST_DIR (always this crate's
//! own directory, regardless of the directory cargo is invoked from) and
//! published via `cargo:rustc-env` - so builds are correct no matter the
//! invocation cwd or which machine they run on, with no hardcoded absolute
//! path committed anywhere.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

fn main() {
    // skip if SQLX_OFFLINE (CI/Docker) - no db connection needed at compile time
    if std::env::var("SQLX_OFFLINE").is_ok() {
        return;
    }

    let manifest_dir =
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by cargo");
    let db_path = Path::new(&manifest_dir)
        .parent()
        .expect("grimoire crate has a parent (workspace root)")
        .join("data/grimoire.db");
    let url = format!("sqlite:{}", db_path.display());
    println!("cargo:rustc-env=DATABASE_URL={url}");
    println!("cargo:rerun-if-changed=build.rs");

    if !db_path.exists() {
        return;
    }

    // create views in dependency order (artist first, then others that reference it)
    let views_dir = Path::new(&manifest_dir)
        .parent()
        .unwrap()
        .join("migrations/views");

    for view_file in [
        "artist_query_view.sql",
        "album_query_view.sql",
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
            .arg(&db_path)
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

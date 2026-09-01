use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    emit_git_sha();
    tauri_build::build()
}

/// bake the git short sha of the checkout this binary was built from into the
/// binary (read back via `env!("FREQHOLE_GIT_SHA")`) so a running app can
/// report exactly which commit it came from - the only reliable way to tell a
/// stale build from a fresh one.
fn emit_git_sha() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default();

    // docker builds have no .git in the context - the Makefile passes the sha in
    // as a build arg instead (same convention as spume's vite.config.ts)
    if let Ok(sha) = std::env::var("FREQHOLE_GIT_SHA") {
        if !sha.is_empty() {
            println!("cargo:rerun-if-env-changed=FREQHOLE_GIT_SHA");
            println!("cargo:rustc-env=FREQHOLE_GIT_SHA={sha}");
            return;
        }
    }

    let sha = git(&manifest_dir, &["rev-parse", "--short", "HEAD"])
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());

    let dirty = git(
        &manifest_dir,
        &["status", "--porcelain", "--untracked-files=no"],
    )
    .map(|s| !s.is_empty())
    .unwrap_or(false);

    let sha = if dirty { format!("{sha}-dirty") } else { sha };
    println!("cargo:rustc-env=FREQHOLE_GIT_SHA={sha}");
    println!("cargo:rerun-if-env-changed=FREQHOLE_GIT_SHA");

    // rebuild when HEAD moves (checkout/commit) so the baked sha stays honest
    if let Some(git_dir) = find_git_dir(&manifest_dir) {
        println!("cargo:rerun-if-changed={}", git_dir.join("HEAD").display());
    }
}

fn git(dir: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn find_git_dir(start: &str) -> Option<PathBuf> {
    let mut dir: Option<&Path> = Some(Path::new(start));
    while let Some(d) = dir {
        let candidate = d.join(".git");
        if candidate.is_dir() {
            return Some(candidate);
        }
        dir = d.parent();
    }
    None
}

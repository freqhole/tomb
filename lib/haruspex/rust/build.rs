//! compiles `src/augur/ios/AugurBonjour.swift` directly with `swiftc`
//! and links the result into whatever final binary/cdylib links this
//! crate - no xcode project wiring needed on the consuming app's side,
//! unlike the android backend's companion kotlin file (which does need
//! a gradle `sourceSets` entry, since gradle has no equivalent of this).
//!
//! only runs when actually targeting ios with the `augur` feature on -
//! every other target/feature combination returns immediately, so this
//! adds no cost to the vast majority of builds of this crate.

use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os != "ios" {
        return;
    }
    // only compiled in when the `augur` feature is actually on - cargo
    // sets this env var for build scripts of the package that declares
    // the feature (see the cargo book's "build scripts" chapter).
    if env::var("CARGO_FEATURE_AUGUR").is_err() {
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let swift_file = manifest_dir.join("src/augur/ios/AugurBonjour.swift");
    println!("cargo:rerun-if-changed={}", swift_file.display());

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let object_file = out_dir.join("AugurBonjour.o");
    let archive_file = out_dir.join("libaugurbonjour.a");

    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    // swiftc's triple spelling differs from rustc's for this one arch;
    // everything else (x86_64) matches.
    let swift_arch = if arch == "aarch64" { "arm64" } else { &arch };

    // cargo's `TARGET` env var carries the full target triple, which is
    // the only place the device-vs-simulator distinction shows up
    // (`aarch64-apple-ios` = device, `aarch64-apple-ios-sim` /
    // `x86_64-apple-ios` = simulator) - `CARGO_CFG_TARGET_OS` alone
    // doesn't distinguish them.
    let full_target = env::var("TARGET").unwrap_or_default();
    let is_simulator = full_target.ends_with("-sim") || full_target == "x86_64-apple-ios";

    let (sdk_name, swift_target) = if is_simulator {
        (
            "iphonesimulator",
            format!("{swift_arch}-apple-ios14.0-simulator"),
        )
    } else {
        ("iphoneos", format!("{swift_arch}-apple-ios14.0"))
    };

    let sdk_path = run(Command::new("xcrun").args(["--sdk", sdk_name, "--show-sdk-path"]))
        .unwrap_or_else(|err| {
            panic!("augur: failed to locate the {sdk_name} sdk via xcrun: {err}")
        });
    let sdk_path = sdk_path.trim();

    let status = Command::new("swiftc")
        .args([
            "-emit-object",
            "-target",
            &swift_target,
            "-sdk",
            sdk_path,
            "-o",
        ])
        .arg(&object_file)
        .arg(&swift_file)
        .status()
        .unwrap_or_else(|err| panic!("augur: failed to run swiftc: {err}"));
    if !status.success() {
        panic!("augur: swiftc failed to compile {}", swift_file.display());
    }

    let status = Command::new("ar")
        .args(["rcs"])
        .arg(&archive_file)
        .arg(&object_file)
        .status()
        .unwrap_or_else(|err| panic!("augur: failed to run ar: {err}"));
    if !status.success() {
        panic!("augur: ar failed to archive {}", object_file.display());
    }

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=augurbonjour");
    println!("cargo:rustc-link-lib=framework=Network");
    println!("cargo:rustc-link-lib=framework=Foundation");
}

/// runs `cmd`, returning its captured stdout on success.
fn run(cmd: &mut Command) -> Result<String, String> {
    let output = cmd.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

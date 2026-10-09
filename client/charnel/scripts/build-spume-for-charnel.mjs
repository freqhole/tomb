#!/usr/bin/env node
// cross-platform replacement for the old shell one-liner that used to live in
// tauri.conf.json's beforeBuildCommand:
//   cd ../spume && VITE_CHARNEL_MODE=true npm run build && cp -r ../charnel/dist/wizard dist/ && cp ../charnel/public/about.html dist/
//
// that only worked on macOS/linux: tauri runs beforeBuildCommand through
// cmd.exe on windows, which has neither posix `VAR=value cmd` env-prefix
// syntax nor a `cp` builtin. this does the same three steps (build spume with
// VITE_CHARNEL_MODE set, copy the wizard build in, copy about.html in) using
// only node apis, so it runs identically on windows/macOS/linux.
//
// invoked by tauri with cwd = client/charnel (the npm project root).

import { execSync } from "node:child_process";
import { cpSync } from "node:fs";
import { join } from "node:path";

const charnelDir = process.cwd();
const spumeDir = join(charnelDir, "..", "spume");

// x86_64-apple-darwin is the only charnel target that still has to run on
// Catalina's old bundled WKWebView - tells spume's vite config to target
// es2020 instead of esnext (see vite.config.ts's needsLegacySafariTarget
// for why: esnext's native private class fields can't even be PARSED
// there). TAURI_ENV_TARGET_TRIPLE is set by tauri-cli for beforeBuildCommand
// hooks (same var fixup-mpv-install-name.sh's beforeBundleCommand hook
// relies on).
const needsLegacySafariTarget = process.env.TAURI_ENV_TARGET_TRIPLE === "x86_64-apple-darwin";

execSync("npm run build", {
  cwd: spumeDir,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_CHARNEL_MODE: "true",
    ...(needsLegacySafariTarget ? { VITE_LEGACY_SAFARI_TARGET: "true" } : {}),
  },
});

cpSync(join(charnelDir, "dist", "wizard"), join(spumeDir, "dist", "wizard"), {
  recursive: true,
});
cpSync(join(charnelDir, "public", "about.html"), join(spumeDir, "dist", "about.html"));

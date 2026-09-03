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

execSync("npm run build", {
  cwd: spumeDir,
  stdio: "inherit",
  env: { ...process.env, VITE_CHARNEL_MODE: "true" },
});

cpSync(join(charnelDir, "dist", "wizard"), join(spumeDir, "dist", "wizard"), {
  recursive: true,
});
cpSync(join(charnelDir, "public", "about.html"), join(spumeDir, "dist", "about.html"));

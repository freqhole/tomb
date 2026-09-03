#!/usr/bin/env node
// cross-platform replacement for the old shell one-liner used by the
// "dev:all" npm script:
//   cd ../spume && VITE_CHARNEL_MODE=true npm run dev -- --port 1420 --host
//
// same windows problem as build-spume-for-charnel.mjs (cmd.exe has no posix
// env-prefix syntax) - reimplemented with node's child_process so it works
// on windows/macOS/linux. invoked with cwd = client/charnel.

import { spawnSync } from "node:child_process";
import { join } from "node:path";

const spumeDir = join(process.cwd(), "..", "spume");

const result = spawnSync("npm", ["run", "dev", "--", "--port", "1420", "--host"], {
  cwd: spumeDir,
  stdio: "inherit",
  env: { ...process.env, VITE_CHARNEL_MODE: "true" },
  shell: true,
});

process.exit(result.status ?? 1);

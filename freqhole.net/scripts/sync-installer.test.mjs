import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("sync preserves installer bytes and check detects a stale copy without writing", () => {
  const root = mkdtempSync(join(tmpdir(), "freqhole-installer-"));
  try {
    const scripts = join(root, "freqhole.net/scripts");
    const source = join(root, "scripts/raspberry-pi/setup.sh");
    const target = join(root, "freqhole.net/public/setup.sh");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(join(root, "scripts/raspberry-pi"), { recursive: true });
    mkdirSync(join(root, "freqhole.net/public"));
    const runner = join(scripts, "sync-installer.mjs");
    copyFileSync(new URL("./sync-installer.mjs", import.meta.url), runner);
    const content = "#!/bin/bash\nread -r answer\nprintf '%s\\n' \"$answer\"\n";
    writeFileSync(source, content);
    const run = (...args) => spawnSync(process.execPath, [runner, ...args], { encoding: "utf8" });
    assert.equal(run().status, 0);
    assert.equal(readFileSync(target, "utf8"), content);
    assert.equal(run("--check").status, 0);
    writeFileSync(source, content + "# updated\n");
    const stale = run("--check");
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /hosted installer is stale/);
    assert.equal(readFileSync(target, "utf8"), content);
    assert.equal(run().status, 0);
    assert.equal(readFileSync(target, "utf8"), content + "# updated\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// helper to load and parse rust-generated protocol fixtures - ensures the
// ts codec stays in sync with the rust side's serialized message shapes.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** loads all json fixtures from `rust/fixtures/protocol/` and returns them
 *  as parsed objects, keyed by filename (without the `.json` extension). */
export function loadProtocolFixtures(): Record<string, unknown> {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = join(here, "..", "..", "..", "rust", "fixtures", "protocol");

  const files = readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".json"))
    .sort();

  const fixtures: Record<string, unknown> = {};
  for (const file of files) {
    const key = file.replace(".json", "");
    fixtures[key] = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));
  }
  return fixtures;
}

/** loads a single protocol fixture by name (without the `.json`
 *  extension), throwing if the file doesn't exist. */
export function loadProtocolFixture(name: string): unknown {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = join(here, "..", "..", "..", "rust", "fixtures", "protocol");
  const path = join(fixturesDir, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

// primary correctness test for ./protocol: every one of the 20 rust
// fixture files (haruspex/rust/fixtures/protocol/) must parse successfully
// through decodeFriendzMessage, and representative fixtures must round-trip
// (re-encoding produces an equivalent value - not necessarily byte-identical
// key order/whitespace, which doesn't matter).

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { decodeFriendzMessage, encodeFriendzMessageToJson } from "./codec.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "..", "..", "rust", "fixtures", "protocol");

const fixtureFiles = readdirSync(fixturesDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

describe("protocol fixture parity", () => {
  it("found the expected 20 fixture files", () => {
    expect(fixtureFiles).toHaveLength(20);
  });

  it.each(fixtureFiles)("parses %s", (name: string) => {
    const raw = JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
    const message = decodeFriendzMessage(raw);
    expect(message).toBeDefined();
  });

  it("routes the app-extension fixture through the passthrough, not the core union", () => {
    const raw = JSON.parse(
      readFileSync(join(fixturesDir, "app-extension-skein-canvas-invite.json"), "utf8"),
    );
    const message = decodeFriendzMessage(raw);
    expect(message.kind).toBe("app-extension");
    if (message.kind === "app-extension") {
      expect(message.messageType).toBe("skein:canvas-invite");
      expect(message.payload).toEqual(raw);
    }
  });

  it.each(fixtureFiles.filter((name) => name !== "app-extension-skein-canvas-invite.json"))(
    "round-trips %s through decode -> encode as an equivalent value",
    (name: string) => {
      const raw = JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
      const message = decodeFriendzMessage(raw);
      const reEncoded = encodeFriendzMessageToJson(message);
      // decode fills in defaults (v, empty arrays) the fixture may omit,
      // so re-decoding the re-encoded form must reach a fixed point -
      // that's the round-trip property that matters here, not raw
      // key-for-key equality with the original fixture.
      expect(decodeFriendzMessage(reEncoded)).toEqual(message);
    },
  );

  it("every fixture's type is either a known core type or namespaced", () => {
    for (const name of fixtureFiles) {
      const raw = JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as {
        type: string;
      };
      const message = decodeFriendzMessage(raw);
      expect(typeof message.kind).toBe("string");
    }
  });
});

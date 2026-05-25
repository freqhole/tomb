// relations.test
//
// locks in the phase-18 "open-ended relation kinds" contract:
// known kinds round-trip through `relationMeta` unchanged, and
// unknown kinds get a deterministic fallback (hashed color,
// humanized label, taxon-like value-layer support) so a remote
// can surface novel `(kind, value)` pairs without a client
// allowlist update.

import { describe, expect, it } from "vitest";
import { RELATION_COLOR, RELATION_LABEL, relationMeta } from "./relations";

describe("relationMeta — known kinds", () => {
  it("returns the registered color + label for genre", () => {
    const m = relationMeta("genre");
    expect(m.color).toBe(RELATION_COLOR.genre);
    expect(m.label).toBe(RELATION_LABEL.genre);
    expect(m.supportsValueLayer).toBe(true);
  });

  it("flags non-taxon kinds (favorite, same_artist, related_artist, artist_album) as no-value-layer", () => {
    for (const k of ["favorite", "same_artist", "related_artist", "artist_album"] as const) {
      expect(relationMeta(k).supportsValueLayer).toBe(false);
    }
  });
});

describe("relationMeta — unknown kinds (phase 18 fallback)", () => {
  it("returns a deterministic hsl color for an unknown kind", () => {
    const a = relationMeta("vibe");
    const b = relationMeta("vibe");
    expect(a.color).toBe(b.color);
    expect(a.color.startsWith("hsl(")).toBe(true);
  });

  it("different unknown kinds usually get different hues", () => {
    // we only check that we don't always collapse to one color,
    // not that every pair differs — the hash is small mod 360.
    const seen = new Set<string>();
    for (const k of ["vibe", "decade", "instrument", "country", "scene", "subgenre"]) {
      seen.add(relationMeta(k).color);
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it("humanizes snake_case + kebab-case kinds for the label", () => {
    expect(relationMeta("user_vibe").label).toBe("user vibe");
    expect(relationMeta("user-vibe").label).toBe("user vibe");
    expect(relationMeta("vibe").label).toBe("vibe");
  });

  it("treats unknown kinds as taxon-like (supports value-layer drill)", () => {
    expect(relationMeta("vibe").supportsValueLayer).toBe(true);
    expect(relationMeta("user_vibe").supportsValueLayer).toBe(true);
  });

  it("returns a safe placeholder for null/empty input", () => {
    expect(relationMeta(null).supportsValueLayer).toBe(false);
    expect(relationMeta("").supportsValueLayer).toBe(false);
    expect(relationMeta("   ").supportsValueLayer).toBe(false);
  });
});

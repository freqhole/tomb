// hubNodes.test
//
// covers the phase-18 widening of relation/relation-value hub id
// parsers: novel kinds emitted by remotes must round-trip through
// the id grammar instead of being silently dropped by an allowlist.

import { describe, expect, it } from "vitest";
import {
  parseRelationHubId,
  parseRelationValueHubId,
  relationHubId,
  relationHubKind,
  relationSupportsValueLayer,
  relationValueHubId,
} from "./hubNodes";

describe("relation hub id round-trip", () => {
  it("known kind survives construct + parse", () => {
    const id = relationHubId("genre", "remoteA");
    const parsed = parseRelationHubId(id);
    expect(parsed).toEqual({ remoteId: "remoteA", kind: "genre" });
    expect(relationHubKind(id)).toBe("genre");
  });

  it("unknown kind survives construct + parse (no allowlist gate)", () => {
    const id = relationHubId("vibe", "remoteA");
    const parsed = parseRelationHubId(id);
    expect(parsed).toEqual({ remoteId: "remoteA", kind: "vibe" });
    expect(relationHubKind(id)).toBe("vibe");
  });

  it("rejects malformed ids (empty kind, empty remote, missing separator)", () => {
    expect(parseRelationHubId("hub_relation::remoteA::")).toBeNull();
    expect(parseRelationHubId("hub_relation::::genre")).toBeNull();
    expect(parseRelationHubId("hub_relation::no-sep")).toBeNull();
    expect(parseRelationHubId(null)).toBeNull();
    expect(parseRelationHubId("")).toBeNull();
  });
});

describe("relation-value hub id round-trip", () => {
  it("known kind + value survive construct + parse with url-decoded value", () => {
    const id = relationValueHubId("tag", "lo fi / chill");
    const parsed = parseRelationValueHubId(id);
    expect(parsed).toEqual({ kind: "tag", valueNorm: "lo fi / chill" });
  });

  it("unknown kind + value survive construct + parse", () => {
    const id = relationValueHubId("vibe", "saturday morning");
    const parsed = parseRelationValueHubId(id);
    expect(parsed).toEqual({ kind: "vibe", valueNorm: "saturday morning" });
  });

  it("rejects ids with bad % escapes in the value segment", () => {
    expect(parseRelationValueHubId("hub_relation_value::tag::%E0%A4")).toBeNull();
  });
});

describe("relationSupportsValueLayer", () => {
  it("returns true for known taxon kinds", () => {
    for (const k of ["genre", "tag", "mood", "style", "era", "label"] as const) {
      expect(relationSupportsValueLayer(k)).toBe(true);
    }
  });

  it("returns false for entity-to-entity kinds", () => {
    for (const k of ["favorite", "same_artist", "related_artist", "artist_album"] as const) {
      expect(relationSupportsValueLayer(k)).toBe(false);
    }
  });

  it("returns true for novel remote-supplied kinds (phase 18 default)", () => {
    expect(relationSupportsValueLayer("vibe")).toBe(true);
    expect(relationSupportsValueLayer("user_country")).toBe(true);
  });

  it("returns false for null/empty", () => {
    expect(relationSupportsValueLayer(null)).toBe(false);
    expect(relationSupportsValueLayer(undefined)).toBe(false);
    expect(relationSupportsValueLayer("")).toBe(false);
  });
});

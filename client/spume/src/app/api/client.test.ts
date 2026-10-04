// regression test for isP2PTransportType: a remote reference is permissive
// (RemoteRef/RemoteLike accepts either the new discriminated `transport`
// field or the legacy `transport_type` field - see resolveTransport's own
// doc comment). the bug this guards: two call sites (TopNavSearch.tsx,
// contextMenu.ts) used to reimplement this check by hand against only the
// NEW field name, via a `CurrentRemoteInfo` object that only ever carries
// the LEGACY field - silently always false, permanently hiding the
// "add to station" action for every P2P remote reached via
// `getCurrentRemote()`.

import { describe, expect, it } from "vitest";
import { isP2PTransportType } from "./client";

describe("isP2PTransportType", () => {
  it("is true for the new discriminated wasm/app transport field", () => {
    expect(isP2PTransportType({ transport: "wasm" })).toBe(true);
    expect(isP2PTransportType({ transport: "app" })).toBe(true);
  });

  it("is false for the new discriminated http transport field", () => {
    expect(isP2PTransportType({ transport: "http" })).toBe(false);
  });

  it("is true for the legacy transport_type field (e.g. CurrentRemoteInfo shape)", () => {
    expect(isP2PTransportType({ transport_type: "wasm" })).toBe(true);
    expect(isP2PTransportType({ transport_type: "app" })).toBe(true);
  });

  it("is false for the legacy transport_type field set to http", () => {
    expect(isP2PTransportType({ transport_type: "http" })).toBe(false);
  });

  it("defaults to false (http) when neither field is set and there's no peer_addr", () => {
    expect(isP2PTransportType({})).toBe(false);
  });

  it("prefers the new discriminated field over the legacy one when both are somehow present", () => {
    expect(isP2PTransportType({ transport: "http", transport_type: "wasm" })).toBe(false);
  });
});

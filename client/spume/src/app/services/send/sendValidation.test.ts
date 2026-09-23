import { describe, expect, it, vi } from "vitest";
import type { Transport } from "@freqhole/api-client";
import type { Remote } from "../storage/schemas/remote";

const isP2PTransportType = vi.fn(() => false);
vi.mock("../../api/client", () => ({
  isP2PTransportType: (...a: unknown[]) => isP2PTransportType(...(a as [])),
}));

const extractNodeIdStrict = vi.fn((peerAddr: string) => peerAddr || null);
vi.mock("../remotes/peerAddr", () => ({
  extractNodeIdStrict: (...a: unknown[]) => extractNodeIdStrict(...(a as [string])),
}));

const getLocalNodeId = vi.fn(() => "local-node-id");
vi.mock("../charnel", () => ({
  getLocalNodeId: () => getLocalNodeId(),
}));

import {
  isValidSendDestination,
  resolveSourceNodeId,
  checkBlobsPresentOnDest,
  peerUnauthorizedMessage,
} from "./sendValidation";

function remote(over: Partial<Remote> = {}): Remote {
  return {
    remote_id: "r1",
    name: "a remote",
    transport: "http",
    ...over,
  } as unknown as Remote;
}

describe("isValidSendDestination", () => {
  it("accepts a p2p transport", () => {
    isP2PTransportType.mockReturnValue(true);
    expect(isValidSendDestination(remote())).toBe(true);
  });

  it("accepts a charnel-managed remote even without p2p transport", () => {
    isP2PTransportType.mockReturnValue(false);
    expect(isValidSendDestination(remote({ is_charnel_managed: true }))).toBe(true);
  });

  it("rejects a plain http, non-charnel-managed remote", () => {
    isP2PTransportType.mockReturnValue(false);
    expect(isValidSendDestination(remote())).toBe(false);
  });
});

describe("resolveSourceNodeId", () => {
  it("uses the p2p peer_addr when source is a p2p remote", () => {
    const source = remote({ transport: "app", peer_addr: "peer-123" }) as Remote;
    expect(resolveSourceNodeId(source)).toBe("peer-123");
  });

  it("falls back to this device's own node id when charnel-managed", () => {
    const source = remote({ is_charnel_managed: true });
    expect(resolveSourceNodeId(source)).toBe("local-node-id");
  });

  it("returns null when neither p2p nor charnel-managed", () => {
    expect(resolveSourceNodeId(remote())).toBeNull();
  });
});

describe("checkBlobsPresentOnDest", () => {
  function fakeTransport(response: { status: number; body: string }): Transport {
    return { request: vi.fn(async () => response) } as unknown as Transport;
  }

  it("returns an empty set for an empty blake3 list without calling the transport", async () => {
    const request = vi.fn();
    const transport = { request } as unknown as Transport;
    const result = await checkBlobsPresentOnDest(transport, [], "tag", "[lp]");
    expect(result.size).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });

  it("parses the present blake3s from a successful response", async () => {
    const transport = fakeTransport({
      status: 200,
      body: JSON.stringify({
        data: {
          blake3s_present: ["a", "b"],
          blake3s_missing: ["c"],
          sha256s_present: [],
          sha256s_missing: [],
        },
      }),
    });
    const result = await checkBlobsPresentOnDest(transport, ["a", "b", "c"], "tag", "[lp]");
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("returns an empty set on a non-2xx response", async () => {
    const transport = fakeTransport({ status: 500, body: "oops" });
    const result = await checkBlobsPresentOnDest(transport, ["a"], "tag", "[lp]");
    expect(result.size).toBe(0);
  });

  it("returns an empty set when the request itself throws", async () => {
    const transport = {
      request: vi.fn(async () => {
        throw new Error("network down");
      }),
    } as unknown as Transport;
    const result = await checkBlobsPresentOnDest(transport, ["a"], "tag", "[lp]");
    expect(result.size).toBe(0);
  });
});

describe("peerUnauthorizedMessage", () => {
  it("names both the source and dest remotes", () => {
    const msg = peerUnauthorizedMessage(remote({ name: "source-a" }), remote({ name: "dest-b" }));
    expect(msg).toContain("source-a");
    expect(msg).toContain("dest-b");
  });
});

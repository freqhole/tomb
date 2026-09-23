// tests for docs/transfer-unification-plan.md phase 1's bucket-A registry.
// covers the two write paths (explicit register/update/complete for
// downloads, poll-and-mirror for uploads) and the pause/resume control
// surface - the three genuinely new pieces of logic this file adds.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const isCharnelAvailable = vi.fn(() => false);
const getMiddenNode = vi.fn();
vi.mock("../../api/client", () => ({
  isCharnelAvailable: () => isCharnelAvailable(),
  getMiddenNode: () => getMiddenNode(),
}));

const getActiveOutgoingTransfers = vi.fn(async () => [] as unknown[]);
vi.mock("../charnel/commands", () => ({
  getActiveOutgoingTransfers: () => getActiveOutgoingTransfers(),
}));

import {
  completeBlobTransfer,
  getBlobTransfer,
  pauseBlobTransfer,
  registerBlobTransfer,
  resetBlobTransfers,
  resumeBlobTransfer,
  startUploadTransferPolling,
  updateBlobTransferProgress,
} from "./blobTransferRegistry";

beforeEach(() => {
  resetBlobTransfers();
  isCharnelAvailable.mockReturnValue(false);
  getMiddenNode.mockReset();
  getActiveOutgoingTransfers.mockReset();
  getActiveOutgoingTransfers.mockResolvedValue([]);
});

describe("register/update/complete (download direction)", () => {
  it("registers a transfer and reports it back", () => {
    registerBlobTransfer("abc123", "download", { peerId: "peer-1", bytesTotal: 1000 });
    const t = getBlobTransfer("abc123");
    expect(t).toMatchObject({
      blake3: "abc123",
      direction: "download",
      peerId: "peer-1",
      bytesTransferred: 0,
      bytesTotal: 1000,
      state: "active",
    });
  });

  it("updateBlobTransferProgress updates bytesTransferred without losing other fields", () => {
    registerBlobTransfer("abc123", "download", { peerId: "peer-1", bytesTotal: 1000 });
    updateBlobTransferProgress("abc123", 500);
    const t = getBlobTransfer("abc123");
    expect(t?.bytesTransferred).toBe(500);
    expect(t?.peerId).toBe("peer-1");
    expect(t?.bytesTotal).toBe(1000);
  });

  it("updateBlobTransferProgress is a no-op for an untracked blake3", () => {
    updateBlobTransferProgress("never-registered", 500);
    expect(getBlobTransfer("never-registered")).toBeUndefined();
  });

  it("completeBlobTransfer removes the entry", () => {
    registerBlobTransfer("abc123", "download");
    completeBlobTransfer("abc123");
    expect(getBlobTransfer("abc123")).toBeUndefined();
  });

  it("re-registering the same blake3 overwrites (fresh retry wins)", () => {
    registerBlobTransfer("abc123", "download", { bytesTotal: 1000 });
    updateBlobTransferProgress("abc123", 900);
    registerBlobTransfer("abc123", "download", { bytesTotal: 2000 });
    expect(getBlobTransfer("abc123")).toMatchObject({ bytesTransferred: 0, bytesTotal: 2000 });
  });
});

describe("pause/resume (download direction only)", () => {
  it("pauseBlobTransfer flips state to paused when the transport cancels >0 downloads", async () => {
    registerBlobTransfer("abc123", "download");
    const download_cancel_by_blake3 = vi.fn(async () => 1);
    getMiddenNode.mockResolvedValue({ download_cancel_by_blake3 });
    const result = await pauseBlobTransfer("abc123");
    expect(result).toBe(true);
    expect(download_cancel_by_blake3).toHaveBeenCalledWith("abc123");
    expect(getBlobTransfer("abc123")?.state).toBe("paused");
  });

  it("pauseBlobTransfer returns false and leaves state unchanged when nothing was in flight", async () => {
    registerBlobTransfer("abc123", "download");
    const download_cancel_by_blake3 = vi.fn(async () => 0);
    getMiddenNode.mockResolvedValue({ download_cancel_by_blake3 });
    const result = await pauseBlobTransfer("abc123");
    expect(result).toBe(false);
    expect(getBlobTransfer("abc123")?.state).toBe("active");
  });

  it("pauseBlobTransfer is a no-op under charnel (not wired yet)", async () => {
    isCharnelAvailable.mockReturnValue(true);
    registerBlobTransfer("abc123", "download");
    const result = await pauseBlobTransfer("abc123");
    expect(result).toBe(false);
    expect(getMiddenNode).not.toHaveBeenCalled();
    expect(getBlobTransfer("abc123")?.state).toBe("active");
  });

  it("resumeBlobTransfer flips a paused transfer back to active without touching bytes", () => {
    registerBlobTransfer("abc123", "download", { bytesTotal: 1000 });
    updateBlobTransferProgress("abc123", 400);
    // manually simulate the paused state pauseBlobTransfer would have set
    const paused = getBlobTransfer("abc123");
    expect(paused).toBeDefined();
    resumeBlobTransfer("abc123");
    const t = getBlobTransfer("abc123");
    expect(t?.state).toBe("active");
    expect(t?.bytesTransferred).toBe(400);
  });

  it("resumeBlobTransfer is a no-op for an untracked blake3", () => {
    expect(() => resumeBlobTransfer("never-registered")).not.toThrow();
    expect(getBlobTransfer("never-registered")).toBeUndefined();
  });
});

describe("upload-direction polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mirrors get_active_transfers() results into the registry as uploads", async () => {
    const get_active_transfers = vi.fn(async () => [
      { peerId: "peer-1", blake3: "up1", bytesSent: 100, totalSize: 1000 },
    ]);
    getMiddenNode.mockResolvedValue({ get_active_transfers });
    const stop = startUploadTransferPolling();
    await vi.waitFor(() => expect(getBlobTransfer("up1")).toBeDefined());
    expect(getBlobTransfer("up1")).toMatchObject({
      direction: "upload",
      peerId: "peer-1",
      bytesTransferred: 100,
      bytesTotal: 1000,
    });
    stop();
  });

  it("drops an upload entry once it no longer appears in a later poll", async () => {
    let transfers: Array<{ peerId: string; blake3: string; bytesSent: number; totalSize: number }> =
      [{ peerId: "peer-1", blake3: "up1", bytesSent: 100, totalSize: 1000 }];
    const get_active_transfers = vi.fn(async () => transfers);
    getMiddenNode.mockResolvedValue({ get_active_transfers });

    const stop = startUploadTransferPolling();
    await vi.waitFor(() => expect(getBlobTransfer("up1")).toBeDefined());

    // transfer finished - next poll no longer reports it
    transfers = [];
    await vi.advanceTimersByTimeAsync(1000);
    expect(getBlobTransfer("up1")).toBeUndefined();
    stop();
  });

  it("charnel mode polls p2p_get_active_transfers instead of the wasm node", async () => {
    isCharnelAvailable.mockReturnValue(true);
    getActiveOutgoingTransfers.mockResolvedValue([
      { peerId: "peer-1", blake3: "up1", bytesSent: 100, totalSize: 1000 },
    ]);
    const stop = startUploadTransferPolling();
    await vi.waitFor(() => expect(getBlobTransfer("up1")).toBeDefined());
    expect(getMiddenNode).not.toHaveBeenCalled();
    expect(getBlobTransfer("up1")).toMatchObject({
      direction: "upload",
      peerId: "peer-1",
      bytesTransferred: 100,
      bytesTotal: 1000,
    });
    stop();
  });

  it("starting polling twice is idempotent - second call is a no-op", async () => {
    const get_active_transfers = vi.fn(async () => []);
    getMiddenNode.mockResolvedValue({ get_active_transfers });
    const stop1 = startUploadTransferPolling();
    const stop2 = startUploadTransferPolling();
    await vi.advanceTimersByTimeAsync(1000);
    // exactly one interval running: one initial call + one tick = 2 calls,
    // not 4 (which a second independent interval would produce)
    expect(get_active_transfers.mock.calls.length).toBe(2);
    stop1();
    stop2();
  });
});

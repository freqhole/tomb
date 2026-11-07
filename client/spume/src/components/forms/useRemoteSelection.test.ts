import { describe, expect, it } from "vitest";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { reconcileRemotes } from "./useRemoteSelection";

function remote(id: string, overrides: Partial<Remote> = {}): Remote {
  return {
    remote_id: id,
    name: `remote ${id}`,
    is_active: false,
    last_connected_at: null,
    created_at: 1,
    updated_at: 1,
    description: null,
    image_url: null,
    image_blob_id: null,
    version: null,
    last_info_check: null,
    transport: "http",
    base_url: `http://${id}.test`,
    ...overrides,
  } as Remote;
}

describe("reconcileRemotes", () => {
  it("returns the fresh list on first read", () => {
    const next = [remote("a")];
    expect(reconcileRemotes(undefined, next)).toBe(next);
  });

  it("keeps the previous array when only volatile fields changed", () => {
    const prev = [remote("a"), remote("b")];
    const next = [
      remote("a", { last_checked: 99, updated_at: 99 }),
      remote("b", { last_connected_at: 42, offline_since: null }),
    ];
    expect(reconcileRemotes(prev, next)).toBe(prev);
  });

  it("picks up an added remote while reusing unchanged objects", () => {
    const prev = [remote("a")];
    const result = reconcileRemotes(prev, [remote("a"), remote("b")]);
    expect(result).not.toBe(prev);
    expect(result.map((r) => r.remote_id)).toEqual(["a", "b"]);
    expect(result[0]).toBe(prev[0]);
  });

  it("drops a removed remote", () => {
    const prev = [remote("a"), remote("b")];
    const result = reconcileRemotes(prev, [remote("b")]);
    expect(result.map((r) => r.remote_id)).toEqual(["b"]);
    expect(result[0]).toBe(prev[1]);
  });

  it("replaces a remote whose meaningful fields changed", () => {
    const prev = [remote("a"), remote("b")];
    const result = reconcileRemotes(prev, [remote("a", { graph_disabled: true }), remote("b")]);
    expect(result[0]).not.toBe(prev[0]);
    expect(result[0].graph_disabled).toBe(true);
    expect(result[1]).toBe(prev[1]);
  });
});

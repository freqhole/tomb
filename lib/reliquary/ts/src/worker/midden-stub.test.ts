import { describe, expect, it } from "vitest";
import { MiddenNode } from "./midden-stub.js";

// every method on the stub throws - it exists only so a bundler alias for
// the "midden" module (e.g. in a tauri build with no wasm binary) resolves
// to something during dev/build. these tests pin down that every method
// throws a clear, consistent error rather than something more confusing
// (undefined is not a function, etc.).

describe("midden stub MiddenNode", () => {
  it("create() rejects", async () => {
    await expect(MiddenNode.create()).rejects.toThrow(/midden wasm is not available/);
  });

  it("create_from_key() rejects", async () => {
    await expect(MiddenNode.create_from_key(new Uint8Array(32))).rejects.toThrow(
      /midden wasm is not available/
    );
  });

  it("create_with_alpns() rejects", async () => {
    await expect(MiddenNode.create_with_alpns(new Uint8Array(32), ["alpn/1"])).rejects.toThrow(
      /midden wasm is not available/
    );
  });

  it("instance methods all throw", async () => {
    const node = Object.create(MiddenNode.prototype) as MiddenNode;
    expect(() => node.node_id()).toThrow(/midden wasm is not available/);
    expect(() => node.secret_key()).toThrow(/midden wasm is not available/);
    await expect(node.open_bi("peer", "alpn/1")).rejects.toThrow(/midden wasm is not available/);
    await expect(node.accept()).rejects.toThrow(/midden wasm is not available/);
  });
});

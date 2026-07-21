import { createEffect, createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { createTransferProgress } from "./transfer-progress.js";

describe("createTransferProgress", () => {
  it("starts with an empty map", () => {
    createRoot((dispose) => {
      const { states } = createTransferProgress<string>();
      expect(states().size).toBe(0);
      dispose();
    });
  });

  it("setState adds a key without replacing untouched entries", () => {
    createRoot((dispose) => {
      const { states, setState } = createTransferProgress<string>();
      setState("a", "downloading");
      setState("b", "pending");
      expect(states().get("a")).toBe("downloading");
      expect(states().get("b")).toBe("pending");
      expect(states().size).toBe(2);
      dispose();
    });
  });

  it("setState overwrites an existing key's state", () => {
    createRoot((dispose) => {
      const { states, setState } = createTransferProgress<string>();
      setState("a", "downloading");
      setState("a", "error");
      expect(states().get("a")).toBe("error");
      expect(states().size).toBe(1);
      dispose();
    });
  });

  it("setState(key, null) removes the key", () => {
    createRoot((dispose) => {
      const { states, setState } = createTransferProgress<string>();
      setState("a", "downloading");
      setState("a", null);
      expect(states().has("a")).toBe(false);
      dispose();
    });
  });

  it("reset clears every tracked key", () => {
    createRoot((dispose) => {
      const { states, setState, reset } = createTransferProgress<string>();
      setState("a", "downloading");
      setState("b", "pending");
      reset();
      expect(states().size).toBe(0);
      dispose();
    });
  });

  it("an effect reading states() re-runs after each setState call", async () => {
    let runs = 0;
    let dispose = () => {};
    let setState!: (key: string, state: string | null) => void;

    createRoot((d) => {
      dispose = d;
      const progress = createTransferProgress<string>();
      setState = progress.setState;
      createEffect(() => {
        progress.states();
        runs++;
      });
    });

    // the initial effect run is flushed on the next microtask
    await Promise.resolve();
    expect(runs).toBe(1);

    setState("a", "downloading");
    await Promise.resolve();
    expect(runs).toBe(2);

    setState("a", "error");
    await Promise.resolve();
    expect(runs).toBe(3);

    dispose();
  });
});

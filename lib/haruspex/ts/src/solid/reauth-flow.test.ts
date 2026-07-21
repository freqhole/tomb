import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createReauthFlow } from "./reauth-flow.js";

describe("createReauthFlow", () => {
  it("submit calls authenticate and onSuccess on success", async () => {
    await createRoot(async (dispose) => {
      const authenticate = vi.fn().mockResolvedValue({ success: true });
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      const flow = createReauthFlow({ authenticate, onSuccess, onClose });

      await flow.submit({ username: "viz", mode: "login" });

      expect(authenticate).toHaveBeenCalledWith({ username: "viz", mode: "login" });
      expect(onSuccess).toHaveBeenCalled();
      expect(flow.error()).toBeNull();
      expect(flow.isLoading()).toBe(false);
      dispose();
    });
  });

  it("submit sets error and does not call onSuccess when authenticate resolves unsuccessfully", async () => {
    await createRoot(async (dispose) => {
      const authenticate = vi.fn().mockResolvedValue({ success: false, error: "bad credentials" });
      const onSuccess = vi.fn();
      const flow = createReauthFlow({ authenticate, onSuccess, onClose: vi.fn() });

      await flow.submit({ username: "viz", mode: "login" });

      expect(onSuccess).not.toHaveBeenCalled();
      expect(flow.error()).toBe("bad credentials");
      expect(flow.isLoading()).toBe(false);
      dispose();
    });
  });

  it("submit sets a generic error message when authenticate throws a non-Error", async () => {
    await createRoot(async (dispose) => {
      const authenticate = vi.fn().mockRejectedValue("network down");
      const flow = createReauthFlow({ authenticate, onSuccess: vi.fn(), onClose: vi.fn() });

      await flow.submit({ username: "viz", mode: "login" });

      expect(flow.error()).toBe("authentication failed");
      dispose();
    });
  });

  it("submit surfaces a thrown Error's message", async () => {
    await createRoot(async (dispose) => {
      const authenticate = vi.fn().mockRejectedValue(new Error("peer unreachable"));
      const flow = createReauthFlow({ authenticate, onSuccess: vi.fn(), onClose: vi.fn() });

      await flow.submit({ username: "viz", mode: "login" });

      expect(flow.error()).toBe("peer unreachable");
      dispose();
    });
  });

  it("submit clears a previous error before retrying", async () => {
    await createRoot(async (dispose) => {
      const authenticate = vi
        .fn()
        .mockResolvedValueOnce({ success: false, error: "first failure" })
        .mockResolvedValueOnce({ success: true });
      const flow = createReauthFlow({ authenticate, onSuccess: vi.fn(), onClose: vi.fn() });

      await flow.submit({ username: "viz", mode: "login" });
      expect(flow.error()).toBe("first failure");

      await flow.submit({ username: "viz", mode: "login" });
      expect(flow.error()).toBeNull();
      dispose();
    });
  });

  it("close calls onClose and clears any error when not loading", () => {
    createRoot((dispose) => {
      const onClose = vi.fn();
      const flow = createReauthFlow({
        authenticate: vi.fn(),
        onSuccess: vi.fn(),
        onClose,
      });

      flow.close();

      expect(onClose).toHaveBeenCalled();
      dispose();
    });
  });

  it("close is a no-op while a submit is in flight", async () => {
    await createRoot(async (dispose) => {
      const onClose = vi.fn();
      let resolveAuth!: (value: { success: boolean }) => void;
      const authenticate = vi.fn(
        () => new Promise<{ success: boolean }>((resolve) => (resolveAuth = resolve)),
      );
      const flow = createReauthFlow({ authenticate, onSuccess: vi.fn(), onClose });

      const submitPromise = flow.submit({ username: "viz", mode: "login" });
      expect(flow.isLoading()).toBe(true);

      flow.close();
      expect(onClose).not.toHaveBeenCalled();

      resolveAuth({ success: true });
      await submitPromise;
      dispose();
    });
  });
});

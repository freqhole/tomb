import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createAuthForm } from "./auth-form.js";

describe("createAuthForm", () => {
  it("defaults to login mode", () => {
    createRoot((dispose) => {
      const form = createAuthForm();
      expect(form.mode()).toBe("login");
      dispose();
    });
  });

  it("honors an initialMode", () => {
    createRoot((dispose) => {
      const form = createAuthForm({ initialMode: "register" });
      expect(form.mode()).toBe("register");
      dispose();
    });
  });

  it("isSubmitDisabled is true until a username is entered", () => {
    createRoot((dispose) => {
      const form = createAuthForm();
      expect(form.isSubmitDisabled()).toBe(true);
      form.setUsername("viz");
      expect(form.isSubmitDisabled()).toBe(false);
      dispose();
    });
  });

  it("register mode also requires an invite code", () => {
    createRoot((dispose) => {
      const form = createAuthForm({ initialMode: "register" });
      form.setUsername("viz");
      expect(form.isSubmitDisabled()).toBe(true);
      form.setInviteCode("abc123");
      expect(form.isSubmitDisabled()).toBe(false);
      dispose();
    });
  });

  it("isSubmitDisabled is true while loading, regardless of field state", () => {
    createRoot((dispose) => {
      const form = createAuthForm({ loading: () => true });
      form.setUsername("viz");
      expect(form.isSubmitDisabled()).toBe(true);
      dispose();
    });
  });

  it("switchMode flips login <-> register and calls onModeChange", () => {
    createRoot((dispose) => {
      const onModeChange = vi.fn();
      const form = createAuthForm({ onModeChange });
      form.switchMode();
      expect(form.mode()).toBe("register");
      expect(onModeChange).toHaveBeenCalledWith("register");
      form.switchMode();
      expect(form.mode()).toBe("login");
      expect(onModeChange).toHaveBeenCalledWith("login");
      dispose();
    });
  });

  it("handleSubmit calls onSubmit with the current field values, omitting inviteCode in login mode", async () => {
    await createRoot(async (dispose) => {
      const onSubmit = vi.fn();
      const form = createAuthForm({ onSubmit });
      form.setUsername("viz");
      form.setInviteCode("should-be-ignored");
      await form.handleSubmit();
      expect(onSubmit).toHaveBeenCalledWith({
        username: "viz",
        inviteCode: undefined,
        mode: "login",
      });
      dispose();
    });
  });

  it("handleSubmit includes inviteCode in register mode", async () => {
    await createRoot(async (dispose) => {
      const onSubmit = vi.fn();
      const form = createAuthForm({ initialMode: "register", onSubmit });
      form.setUsername("viz");
      form.setInviteCode("abc123");
      await form.handleSubmit();
      expect(onSubmit).toHaveBeenCalledWith({
        username: "viz",
        inviteCode: "abc123",
        mode: "register",
      });
      dispose();
    });
  });

  it("handleSubmit no-ops while loading", async () => {
    await createRoot(async (dispose) => {
      const onSubmit = vi.fn();
      const form = createAuthForm({ loading: () => true, onSubmit });
      form.setUsername("viz");
      await form.handleSubmit();
      expect(onSubmit).not.toHaveBeenCalled();
      dispose();
    });
  });

  it("handleSubmit calls preventDefault on a passed event", async () => {
    await createRoot(async (dispose) => {
      const form = createAuthForm();
      const preventDefault = vi.fn();
      await form.handleSubmit({ preventDefault });
      expect(preventDefault).toHaveBeenCalled();
      dispose();
    });
  });

  it("handlePasskeyClick calls onPasskeyClick with the current field values", async () => {
    await createRoot(async (dispose) => {
      const onPasskeyClick = vi.fn();
      const form = createAuthForm({ onPasskeyClick });
      form.setUsername("viz");
      await form.handlePasskeyClick();
      expect(onPasskeyClick).toHaveBeenCalledWith({
        username: "viz",
        inviteCode: undefined,
        mode: "login",
      });
      dispose();
    });
  });

  it("handlePasskeyClick no-ops while loading", async () => {
    await createRoot(async (dispose) => {
      const onPasskeyClick = vi.fn();
      const form = createAuthForm({ loading: () => true, onPasskeyClick });
      await form.handlePasskeyClick();
      expect(onPasskeyClick).not.toHaveBeenCalled();
      dispose();
    });
  });
});

// @vitest-environment jsdom

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import SetupView from "./SetupView";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class { onmessage = null; },
}));
vi.mock("@solidjs/router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.restoreAllMocks();
  mocks.invoke.mockReset();
});

async function mount(hostname: Promise<string>) {
  mocks.invoke.mockImplementation(async (command: string) => {
    switch (command) {
      case "get_default_server_name": return hostname;
      case "check_dependencies": return { can_proceed: true };
      case "is_flatpak": return false;
      case "get_default_data_dir": return "/data";
      case "get_os_username": return "pi";
      case "check_setup_status": return { needs_setup: true };
      default: return null;
    }
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <SetupView />, host);
  for (let i = 0; i < 40; i++) await Promise.resolve();
  [...host.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "get started")!.click();
  return host.querySelector<HTMLInputElement>("#server-name")!;
}

describe("setup server name", () => {
  it("suggests the system hostname and lets the user change it", async () => {
    const input = await mount(Promise.resolve("music-pi"));
    expect(input.value).toBe("music-pi");
    input.value = "my library";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.value).toBe("my library");
  });

  describe("setup feature defaults", () => {
    for (const enabled of [true, false]) {
      it(`submits federation, remote admin and radio ${enabled ? "enabled by default" : "disabled when deselected"}`, async () => {
        await mount(Promise.resolve("music-pi"));
        for (const text of ["enable remote admin over P2P", "enable radio", "enable P2P federation"]) {
          const label = [...host.querySelectorAll("label")]
            .find((item) => item.querySelector(".checkbox-label")?.textContent === text)!;
          const checkbox = label.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
          expect(checkbox.checked).toBe(true);
          if (!enabled) checkbox.click();
        }
        mocks.invoke.mockResolvedValue({ success: true });
        [...host.querySelectorAll("button")]
          .find((button) => button.textContent?.trim() === "run setup")!.click();
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(mocks.invoke).toHaveBeenCalledWith("run_setup_core", expect.objectContaining({
          federationEnabled: enabled,
          remoteAdminEnabled: enabled,
          radioEnabled: enabled,
        }));
      });
    }
  });

  it("does not overwrite typing when the hostname arrives late", async () => {
    let resolve!: (name: string) => void;
    const hostname = new Promise<string>((done) => { resolve = done; });
    const input = await mount(hostname);
    input.value = "custom name";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    resolve("music-pi");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(input.value).toBe("custom name");
  });

  it("logs a lookup failure and retains an editable fallback", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = await mount(Promise.reject(new Error("lookup failed")));
    expect(input.value).toBe("freqhole");
    expect(log).toHaveBeenCalledWith(
      "could not get the default server name:", expect.any(Error),
    );
  });
});

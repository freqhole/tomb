// @vitest-environment jsdom

import { HashRouter, Route } from "@solidjs/router";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("./admin/context", () => ({
  AdminTransportProvider: (props: { children: unknown }) => props.children,
}));
vi.mock("./jobs", () => ({
  JobsProvider: (props: { children: unknown }) => props.children,
}));
vi.mock("./admin/AdminTargetPicker", () => ({
  AdminTargetPicker: () => null,
  AdminScopeBanner: () => null,
}));
vi.mock("./components/TitleBarStrip", () => ({ TitleBarStrip: () => null }));

let dispose: (() => void) | undefined;
let host: HTMLDivElement;

async function mount(enabled: boolean, route = "/") {
  vi.useFakeTimers();
  window.location.hash = `#${route}`;
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === "get_wizard_jobz_enabled") return enabled;
    if (command === "check_setup_status") return { needs_setup: false };
    if (command === "p2p_get_status") return { federation_enabled: false, status: "stopped" };
    if (command === "get_build_info") return { version: "test", git_sha: "test" };
    throw new Error(`unexpected command: ${command}`);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <HashRouter root={App}>
        <Route path="/" component={() => <p>setup</p>} />
        <Route path="/library" component={() => <p>library view</p>} />
        <Route path="/logs" component={() => <p>log view</p>} />
        <Route path="/jobs" component={() => <p>job view</p>} />
      </HashRouter>
    ),
    host,
  );
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

afterEach(() => {
  dispose?.();
  host?.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  bridge.invoke.mockReset();
});

describe("wizard jobz navigation", () => {
  it("hides jobz when disabled and keeps logz as the landing view", async () => {
    await mount(false);
    expect(host.querySelector('a[href="#/jobs"]')).toBeNull();
    expect(host.querySelector('a[href="#/logs"]')?.textContent).toBe("logz");
    expect(host.textContent).toContain("log view");
  });

  it("shows jobz with the selected-letter accent when enabled", async () => {
    await mount(true, "/jobs");
    const link = host.querySelector('a[href="#/jobs"]')!;
    expect(link.textContent).toBe("jobz");
    expect(link.classList.contains("active")).toBe(true);
    expect(link.querySelector(".pinky")?.textContent).toBe("z");
    expect(host.textContent).toContain("job view");
  });

  it("preserves direct job-view access while the nav button is hidden", async () => {
    await mount(false, "/jobs");
    expect(host.querySelector('a[href="#/jobs"]')).toBeNull();
    expect(host.textContent).toContain("job view");
  });

  it("re-reads app preferences on focus without polling or remounting", async () => {
    await mount(false);
    const calls = bridge.invoke.mock.calls.filter(
      ([cmd]) => cmd === "get_wizard_jobz_enabled",
    ).length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(
      bridge.invoke.mock.calls.filter(([cmd]) => cmd === "get_wizard_jobz_enabled"),
    ).toHaveLength(calls);
    bridge.invoke.mockImplementationOnce(async () => true);
    window.dispatchEvent(new Event("focus"));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(host.querySelector('a[href="#/jobs"]')?.textContent).toBe("jobz");
    bridge.invoke.mockImplementationOnce(async () => false);
    window.dispatchEvent(new Event("focus"));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(host.querySelector('a[href="#/jobs"]')).toBeNull();
  });

  it("shows preference errors and recovers after the config is fixed", async () => {
    await mount(false);
    bridge.invoke.mockRejectedValueOnce(new Error("could not parse Charnel app config"));
    window.dispatchEvent(new Event("focus"));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "could not parse Charnel app config",
    );
    bridge.invoke.mockResolvedValueOnce(true);
    window.dispatchEvent(new Event("focus"));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('a[href="#/jobs"]')).not.toBeNull();
  });
});

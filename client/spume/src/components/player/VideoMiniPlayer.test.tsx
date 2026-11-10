// @vitest-environment jsdom

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../music/services/audio/player", () => ({
  isPlaying: () => false,
  pause: () => {},
  togglePlayback: async () => {},
}));
vi.mock("../../app/services/charnel/commands", () => ({
  getTargetOs: async () => null,
  setWindowFullscreen: async () => {},
  setNativeCursorVisible: async () => {},
}));
vi.mock("../../app/services/charnel/mode", () => ({ isCharnelMode: () => false }));
vi.mock("../../utils/isMobile", () => ({ isTouchDevice: () => false }));

import {
  collapseVideoMiniPlayer,
  VideoMiniPlayer,
  videoMiniPlayerExpanded,
} from "./VideoMiniPlayer";

let dispose: (() => void) | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <VideoMiniPlayer videoElement={document.createElement("video")} />, host);
});

afterEach(() => {
  collapseVideoMiniPlayer();
  dispose?.();
  dispose = undefined;
  host.remove();
  vi.useRealTimers();
});

const controls = () =>
  host.querySelector('[data-testid="video-mini-player-controls"]') as HTMLElement;
const panel = () => controls().parentElement as HTMLElement;
const expand = () => (host.querySelector('button[title="expand"]') as HTMLButtonElement).click();

describe("VideoMiniPlayer expanded idle", () => {
  it("keeps hover-revealed controls and the cursor while collapsed", () => {
    vi.advanceTimersByTime(10_000);
    expect(controls().className).toContain("group-hover:opacity-100");
    expect(panel().classList.contains("player-cursor-idle")).toBe(false);
  });

  it("fades the controls and hides the cursor after idle, and reveals them on movement", () => {
    expand();
    expect(controls().className).toContain("opacity-100");
    vi.advanceTimersByTime(3000);
    expect(controls().className).toContain("opacity-0 pointer-events-none");
    expect(panel().classList.contains("player-cursor-idle")).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(panel().classList.contains("player-cursor-idle")).toBe(true);

    window.dispatchEvent(new Event("pointermove"));
    expect(controls().className).not.toContain("pointer-events-none");
    expect(panel().classList.contains("player-cursor-idle")).toBe(false);
  });

  it("drops the idle state when collapsed again", () => {
    expand();
    vi.advanceTimersByTime(5000);
    collapseVideoMiniPlayer();
    expect(controls().className).toContain("group-hover:opacity-100");
    expect(panel().classList.contains("player-cursor-idle")).toBe(false);
  });
});

describe("VideoMiniPlayer close while expanded", () => {
  it("stops reporting expanded once the panel is hidden, and stays collapsed", () => {
    dispose?.();
    host.innerHTML = "";
    const [hidden, setHidden] = createSignal(false);
    dispose = render(
      () => (
        <VideoMiniPlayer
          videoElement={document.createElement("video")}
          hidden={hidden()}
          onClose={() => setHidden(true)}
        />
      ),
      host
    );

    expand();
    expect(videoMiniPlayerExpanded()).toBe(true);

    (host.querySelector('button[title="close"]') as HTMLButtonElement).click();
    expect(videoMiniPlayerExpanded()).toBe(false);

    setHidden(false);
    expect(videoMiniPlayerExpanded()).toBe(false);
    expect(host.querySelector('button[title="expand"]')).not.toBeNull();
  });

  it("stops reporting expanded once the panel unmounts", () => {
    expand();
    expect(videoMiniPlayerExpanded()).toBe(true);
    dispose?.();
    dispose = undefined;
    expect(videoMiniPlayerExpanded()).toBe(false);
  });
});

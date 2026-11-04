// @vitest-environment jsdom
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaybackProgressBar } from "./PlaybackProgressBar";

vi.mock("../media/MediaImage", () => ({ default: () => null }));

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

describe("existing live-stream time readouts", () => {
  it("keeps total listening time while counting down each track, without an extra timer", () => {
    const [elapsed, setElapsed] = createSignal(15);
    const [position, setPosition] = createSignal(15);
    const host = document.createElement("div");
    dispose = render(
      () => (
        <PlaybackProgressBar
          currentTime={elapsed()}
          trackCurrentTime={position()}
          duration={60}
          currentTimeTitle="listening time"
          hideBarAndDuration
        />
      ),
      host
    );
    const elapsedLabel = () => host.querySelector('[title="listening time"]')!.textContent;
    const countdown = () =>
      host.querySelector('[title="time remaining in this track"]')!.textContent;
    expect(elapsedLabel()).toBe("0:15");
    expect(countdown()).toBe("-0:45");
    setElapsed(125);
    setPosition(5);
    expect(elapsedLabel()).toBe("2:05");
    expect(countdown()).toBe("-0:55");
    expect(host.querySelectorAll("span")).toHaveLength(2);
  });

  it("keeps the existing currentTime behavior when no separate track position is supplied", () => {
    const host = document.createElement("div");
    dispose = render(
      () => <PlaybackProgressBar currentTime={20} duration={60} hideBarAndDuration />,
      host
    );
    expect(host.querySelector('[title="time remaining in this track"]')!.textContent).toBe("-0:40");
  });
});

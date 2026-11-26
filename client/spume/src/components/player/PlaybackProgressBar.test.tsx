// @vitest-environment jsdom
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaybackProgressBar } from "./PlaybackProgressBar";
import type { ImageMetadata } from "../../music/services/storage/types";

vi.mock("../media/MediaImage", () => ({
  default: (props: { onError?: () => void }) => (
    <button data-waveform on:click={() => props.onError?.()} />
  ),
}));

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

  it("shows a later waveform after an earlier waveform fails", () => {
    const [image, setImage] = createSignal<ImageMetadata>({
      remote_blob_id: "broken",
      remote_server_id: "remote",
      is_primary: false,
      blob_type: "waveform",
    });
    const host = document.createElement("div");
    dispose = render(
      () => <PlaybackProgressBar currentTime={10} duration={60} waveformImage={image()} />,
      host
    );
    expect(host.querySelectorAll("[data-waveform]")).toHaveLength(2);
    host.querySelector<HTMLButtonElement>("[data-waveform]")!.click();
    expect(host.querySelectorAll("[data-waveform]")).toHaveLength(0);
    setImage({ ...image(), remote_blob_id: "working" });
    expect(host.querySelectorAll("[data-waveform]")).toHaveLength(2);
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

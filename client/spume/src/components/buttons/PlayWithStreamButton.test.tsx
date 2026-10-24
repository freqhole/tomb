// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlayWithStreamButton } from "./PlayWithStreamButton";
import type { PublicStation } from "@freqhole/api-client";

const radioSubmitRequest = vi.fn(async () => ({ success: true, data: null }));
const radioStationsFull = vi.fn(async () => ({
  success: true,
  data: { enabled: true, stations: [] as PublicStation[] },
}));
const getClientForRemote = vi.fn(async (..._args: unknown[]) => ({
  app: { radioStationsFull, radioSubmitRequest },
}));
vi.mock("../../app/api/client", () => ({
  getClientForRemote: (...args: unknown[]) => getClientForRemote(...args),
}));

const toastSuccess = vi.fn((..._args: unknown[]) => {});
const toastError = vi.fn((..._args: unknown[]) => {});
vi.mock("../feedback/Toast", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

function station(overrides: Partial<PublicStation> = {}): PublicStation {
  return {
    station_id: "station-1",
    name: "test station",
    description: null,
    listener_count: 0,
    is_default: true,
    is_public: true,
    is_running: true,
    accepts_requests: true,
    content_mode: "video_only",
    now_playing: {
      kind: "video",
      song_id: "",
      title: "",
      artist: null,
      album: null,
      art_blob_id: null,
      waveform_blob_id: null,
      audio_blob_id: null,
      duration_ms: null,
    },
    ...overrides,
  };
}

const remote = { remote_id: "remote-1", name: "test remote" } as never;
const resolveToNull = async () => null;

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  // ClickDropdownMenu portals its open panel straight into document.body,
  // outside `host` - clean up any that got left open by a test.
  document.querySelectorAll('[role="menu"]').forEach((el) => el.remove());
  vi.clearAllMocks();
  radioStationsFull.mockResolvedValue({ success: true, data: { enabled: true, stations: [] } });
});

function mount(ui: () => ReturnType<typeof PlayWithStreamButton>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const queryClient = new QueryClient();
  dispose = render(
    () => <QueryClientProvider client={queryClient}>{ui()}</QueryClientProvider>,
    host
  );
}

describe("PlayWithStreamButton", () => {
  it("plays directly (no menu) when there's no remote", async () => {
    const onClick = vi.fn();
    mount(() => (
      <PlayWithStreamButton
        label="play"
        onClick={onClick}
        remote={() => null}
        resolveStreamItems={resolveToNull}
        streamLabel="video"
      />
    ));
    await Promise.resolve();
    // a single plain button, not a ClickDropdownMenu trigger wrapper -
    // clicking it calls onClick directly, no menu to open.
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const button = host!.querySelector("button") as HTMLButtonElement;
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("plays directly (no menu) when there are no compatible stations", async () => {
    radioStationsFull.mockResolvedValue({ success: true, data: { enabled: true, stations: [] } });
    const onClick = vi.fn();
    mount(() => (
      <PlayWithStreamButton
        label="play"
        onClick={onClick}
        remote={() => remote}
        resolveStreamItems={resolveToNull}
        streamLabel="video"
      />
    ));
    await vi.waitFor(() => expect(radioStationsFull).toHaveBeenCalled());
    const button = host!.querySelector("button") as HTMLButtonElement;
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("plays directly (no menu) when the video is already available locally", async () => {
    radioStationsFull.mockResolvedValue({
      success: true,
      data: { enabled: true, stations: [station()] },
    });
    const onClick = vi.fn();
    mount(() => (
      <PlayWithStreamButton
        label="play"
        onClick={onClick}
        remote={() => remote}
        resolveStreamItems={resolveToNull}
        streamLabel="video"
        alreadyLocal={() => true}
      />
    ));
    await vi.waitFor(() => expect(radioStationsFull).toHaveBeenCalled());
    const button = host!.querySelector("button") as HTMLButtonElement;
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("opens a menu (play + stream) and streams to the picked station when one qualifies", async () => {
    radioStationsFull.mockResolvedValue({
      success: true,
      data: { enabled: true, stations: [station()] },
    });
    const onClick = vi.fn();
    const resolveStreamItems = vi.fn(async () => [{ kind: "video" as const, itemId: "v1" }]);

    mount(() => (
      <PlayWithStreamButton
        label="play"
        onClick={onClick}
        remote={() => remote}
        resolveStreamItems={resolveStreamItems}
        streamLabel='video "my video"'
      />
    ));

    await vi.waitFor(() => expect(radioStationsFull).toHaveBeenCalled());

    // clicking the button now opens a menu instead of calling onClick
    // directly - "play" itself is the menu's own first entry.
    const trigger = host!.querySelector("button") as HTMLButtonElement;
    trigger.click();
    expect(onClick).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    const menuButtons = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(menuButtons.some((b) => b.textContent?.includes("play"))).toBe(true);
    const streamItem = menuButtons.find((b) => b.textContent?.includes("stream on"));
    expect(streamItem).toBeTruthy();
    (streamItem as HTMLButtonElement).click();

    await vi.waitFor(() =>
      expect(radioSubmitRequest).toHaveBeenCalledWith({
        station_id: "station-1",
        kind: "video",
        item_id: "v1",
        start_position_seconds: undefined,
      })
    );
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});

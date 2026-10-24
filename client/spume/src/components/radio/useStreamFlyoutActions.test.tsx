// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStreamFlyoutActions } from "./useStreamFlyoutActions";
import type { PublicStation } from "@freqhole/api-client";

// mocks only the true leaf (the http client) - useStreamStation and
// pickStreamStation run for real, same reasoning as
// video/data/index.test.ts: this is the piece that needs to agree with
// real station shapes (accepts_requests/content_mode), and a test that
// mocked useStreamStation itself wouldn't catch a regression in that
// filtering logic.
const radioStationsFull = vi.fn(async () => ({
  success: true,
  data: { enabled: true, stations: [] as PublicStation[] },
}));
vi.mock("../../app/api/client", () => ({
  getClientForRemote: async () => ({ app: { radioStationsFull } }),
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
    now_playing: null,
    ...overrides,
  } as PublicStation;
}

const remote = { remote_id: "remote-1", name: "test remote" } as never;

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.clearAllMocks();
});

// mounts a throwaway component that calls the hook and reflects its live
// showCaret()/menuActions() state into the DOM as plain text, so a test
// can assert on them without needing its own component-authoring
// boilerplate per case.
function mountFlyout(props: Parameters<typeof useStreamFlyoutActions>[0]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const queryClient = new QueryClient();
  function Probe() {
    const flyout = useStreamFlyoutActions(props);
    return (
      <div>
        <span data-testid="caret">{String(flyout.showCaret())}</span>
        <span data-testid="actions">{flyout.menuActions().length}</span>
      </div>
    );
  }
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ),
    host
  );
}

const resolveToNull = async () => null;

describe("useStreamFlyoutActions", () => {
  it("shows no caret when there's no remote at all", async () => {
    mountFlyout({
      remote: () => null,
      resolveStreamItems: resolveToNull,
      streamLabel: () => "video",
    });
    await Promise.resolve();
    expect(host!.querySelector('[data-testid="caret"]')!.textContent).toBe("false");
    expect(host!.querySelector('[data-testid="actions"]')!.textContent).toBe("0");
  });

  it("shows no caret when the remote has no compatible stations", async () => {
    radioStationsFull.mockResolvedValue({ success: true, data: { enabled: true, stations: [] } });
    mountFlyout({
      remote: () => remote,
      resolveStreamItems: resolveToNull,
      streamLabel: () => "video",
    });
    await vi.waitFor(() => expect(radioStationsFull).toHaveBeenCalled());
    expect(host!.querySelector('[data-testid="caret"]')!.textContent).toBe("false");
  });

  it("shows the caret once a compatible station resolves, when alreadyLocal is false", async () => {
    radioStationsFull.mockResolvedValue({
      success: true,
      data: { enabled: true, stations: [station()] },
    });
    mountFlyout({
      remote: () => remote,
      resolveStreamItems: resolveToNull,
      streamLabel: () => "video",
      alreadyLocal: () => false,
    });
    await vi.waitFor(() =>
      expect(host!.querySelector('[data-testid="caret"]')!.textContent).toBe("true")
    );
    expect(host!.querySelector('[data-testid="actions"]')!.textContent).toBe("1");
  });

  it("hides the caret once alreadyLocal flips true, even with a compatible station available - the exact regression class this test guards against", async () => {
    radioStationsFull.mockResolvedValue({
      success: true,
      data: { enabled: true, stations: [station()] },
    });
    mountFlyout({
      remote: () => remote,
      resolveStreamItems: resolveToNull,
      streamLabel: () => "video",
      alreadyLocal: () => true,
    });
    await vi.waitFor(() => expect(radioStationsFull).toHaveBeenCalled());
    // give the station query's resolution a tick to flow through, then
    // confirm the caret stays hidden despite a real, compatible station
    // existing - alreadyLocal must win regardless.
    await new Promise((r) => setTimeout(r, 10));
    expect(host!.querySelector('[data-testid="caret"]')!.textContent).toBe("false");
  });

  it("filters out a station that doesn't accept video requests (content_mode compatibility, exercised for real)", async () => {
    radioStationsFull.mockResolvedValue({
      success: true,
      data: { enabled: true, stations: [station({ content_mode: "audio_only" })] },
    });
    mountFlyout({
      remote: () => remote,
      resolveStreamItems: resolveToNull,
      streamLabel: () => "video",
    });
    await vi.waitFor(() => expect(radioStationsFull).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(host!.querySelector('[data-testid="caret"]')!.textContent).toBe("false");
  });
});

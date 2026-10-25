// @vitest-environment jsdom
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const radioListRequests = vi.fn();
const radioRemoveRequest = vi.fn(async () => ({ success: true, data: null }) as unknown);
const radioClearRequests = vi.fn(async () => ({ success: true, data: null }));
const radioReorderRequest = vi.fn(async () => ({ success: true, data: null }));
// default: no live events ever arrive - resolves (ends the generator)
// once aborted, same contract a real transport's subscribe() has on
// cleanup. individual tests override this via `radioQueueEventsSubscribe`
// to feed in `RadioQueueEvent`s and assert the hook applies them.
const radioQueueEventsSubscribe = vi.fn(
  (_filter: unknown, signal?: AbortSignal): AsyncGenerator<unknown, void, void> =>
    (async function* () {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    })()
);
vi.mock("../../app/api/client", () => ({
  getClientForRemote: async () => ({
    app: { radioListRequests, radioRemoveRequest, radioClearRequests, radioReorderRequest },
    radioQueue: { events: { subscribe: radioQueueEventsSubscribe } },
  }),
}));

const toastError = vi.fn();
vi.mock("../feedback/Toast", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("../../music/services/storage/blobResolver", () => ({
  resolveBlobUrl: vi.fn(async () => "blob:fake"),
}));

import { useRadioRequestQueue } from "./useRadioRequestQueue";

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "req-1",
    kind: "song",
    item_id: "song-1",
    requested_by: "user-1",
    requested_by_username: "alice",
    title: "a song",
    artist: "an artist",
    album: null,
    duration_ms: 180000,
    art_blob_id: null,
    ...overrides,
  };
}

const remoteRef = { transport: "http" as const, base_url: "https://example.test" };

// runs `fn` inside a reactive root (the hook's createEffect calls need
// one) and disposes it afterward - mirrors solid-testing-library's own
// render() without pulling in the DOM-mounting machinery this hook
// doesn't need (it renders nothing itself).
function withRoot<T>(fn: () => T): { result: T; dispose: () => void } {
  let result!: T;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    result = fn();
  });
  return { result, dispose };
}

/**
 * a manually-driven async iterable for simulating a live
 * `RadioQueueEvent` subscription in tests - `push()` enqueues an event
 * for the hook's `for await` loop to pick up, and the generator ends
 * (same contract a real transport's `subscribe()` has) once `signal`
 * aborts.
 */
function pushableEventStream<T>(signal?: AbortSignal) {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let aborted = signal?.aborted ?? false;
  signal?.addEventListener(
    "abort",
    () => {
      aborted = true;
      wake?.();
    },
    { once: true }
  );
  async function* iterable(): AsyncGenerator<T, void, void> {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (aborted) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }
  return {
    push: (item: T) => {
      queue.push(item);
      wake?.();
    },
    iterable: iterable(),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRadioRequestQueue", () => {
  it("loads the queue for a station and maps requested_by_username through", async () => {
    radioListRequests.mockResolvedValue({ success: true, data: { requests: [row()] } });
    const { result, dispose } = withRoot(() =>
      useRadioRequestQueue({ stationId: () => "station-1", remoteRef: () => remoteRef })
    );
    await vi.waitFor(() => expect(result.rows()).toHaveLength(1));
    expect(result.rows()[0]).toMatchObject({
      id: "req-1",
      requestedByUsername: "alice",
      title: "a song",
    });
    dispose();
  });

  it("optimistically removes a request and reverts on server failure", async () => {
    radioListRequests.mockResolvedValue({
      success: true,
      data: { requests: [row({ id: "req-1" }), row({ id: "req-2", item_id: "song-2" })] },
    });
    radioRemoveRequest.mockResolvedValueOnce({
      success: false,
      error: { issues: [{ message: "nope" }] },
    });
    const { result, dispose } = withRoot(() =>
      useRadioRequestQueue({ stationId: () => "station-1", remoteRef: () => remoteRef })
    );
    await vi.waitFor(() => expect(result.rows()).toHaveLength(2));

    const removal = result.handleRemove("req-1");
    // optimistic removal happens synchronously, before the server call
    // resolves.
    expect(result.rows()).toHaveLength(1);
    await removal;
    // server rejected it - reverted back to both rows.
    expect(result.rows()).toHaveLength(2);
    expect(toastError).toHaveBeenCalled();
    dispose();
  });

  it("reorders a request to a new index, clamped to the queue's bounds", async () => {
    radioListRequests.mockResolvedValue({
      success: true,
      data: {
        requests: [
          row({ id: "a", item_id: "song-a" }),
          row({ id: "b", item_id: "song-b" }),
          row({ id: "c", item_id: "song-c" }),
        ],
      },
    });
    const { result, dispose } = withRoot(() =>
      useRadioRequestQueue({ stationId: () => "station-1", remoteRef: () => remoteRef })
    );
    await vi.waitFor(() => expect(result.rows()).toHaveLength(3));

    // "a" (index 0) targeted at a wildly out-of-range index (99) should
    // clamp to the last valid index (2), not be rejected or push out of
    // bounds.
    await result.handleReorder("a", 99);
    expect(radioReorderRequest).toHaveBeenCalledWith({
      station_id: "station-1",
      request_id: "a",
      new_index: 2,
    });
    expect(result.rows().map((r) => r.id)).toEqual(["b", "c", "a"]);

    // move it back to the front.
    await result.handleReorder("a", 0);
    expect(result.rows().map((r) => r.id)).toEqual(["a", "b", "c"]);
    dispose();
  });

  it("clears every request before a target id via parallel removes", async () => {
    radioListRequests.mockResolvedValue({
      success: true,
      data: {
        requests: [
          row({ id: "a", item_id: "song-a" }),
          row({ id: "b", item_id: "song-b" }),
          row({ id: "c", item_id: "song-c" }),
        ],
      },
    });
    const { result, dispose } = withRoot(() =>
      useRadioRequestQueue({ stationId: () => "station-1", remoteRef: () => remoteRef })
    );
    await vi.waitFor(() => expect(result.rows()).toHaveLength(3));

    await result.handleClearRange("c", "before");
    expect(radioRemoveRequest).toHaveBeenCalledWith({
      station_id: "station-1",
      request_id: "a",
    });
    expect(radioRemoveRequest).toHaveBeenCalledWith({
      station_id: "station-1",
      request_id: "b",
    });
    expect(radioRemoveRequest).not.toHaveBeenCalledWith({
      station_id: "station-1",
      request_id: "c",
    });
    expect(result.rows().map((r) => r.id)).toEqual(["c"]);
    dispose();
  });

  it("applies live RadioQueueEvents (Submitted/Reordered/Removed/Cleared) to rows", async () => {
    radioListRequests.mockResolvedValue({
      success: true,
      data: { requests: [row({ id: "a", item_id: "song-a" })] },
    });
    let pusher!: ReturnType<typeof pushableEventStream<unknown>>;
    radioQueueEventsSubscribe.mockImplementationOnce((_filter: unknown, signal?: AbortSignal) => {
      pusher = pushableEventStream(signal);
      return pusher.iterable;
    });
    const { result, dispose } = withRoot(() =>
      useRadioRequestQueue({ stationId: () => "station-1", remoteRef: () => remoteRef })
    );
    await vi.waitFor(() => expect(result.rows().map((r) => r.id)).toEqual(["a"]));

    // Submitted - appends the new row using the event's own embedded
    // metadata, no extra fetch.
    pusher.push({
      kind: "Submitted",
      station_id: "station-1",
      request: row({ id: "b", item_id: "song-b", title: "b song" }),
    });
    await vi.waitFor(() => expect(result.rows().map((r) => r.id)).toEqual(["a", "b"]));
    expect(result.rows()[1]).toMatchObject({ id: "b", title: "b song" });

    // Reordered - moves "b" to the front.
    pusher.push({ kind: "Reordered", station_id: "station-1", request_id: "b", new_index: 0 });
    await vi.waitFor(() => expect(result.rows().map((r) => r.id)).toEqual(["b", "a"]));

    // Removed - "a" disappears without any server round-trip from here.
    pusher.push({ kind: "Removed", station_id: "station-1", request_id: "a" });
    await vi.waitFor(() => expect(result.rows().map((r) => r.id)).toEqual(["b"]));

    // Cleared - empties the queue.
    pusher.push({ kind: "Cleared", station_id: "station-1" });
    await vi.waitFor(() => expect(result.rows()).toHaveLength(0));

    dispose();
  });

  it("ignores a Submitted event for a request id it already has (de-dupes against a concurrent load())", async () => {
    radioListRequests.mockResolvedValue({
      success: true,
      data: { requests: [row({ id: "a", item_id: "song-a" })] },
    });
    let pusher!: ReturnType<typeof pushableEventStream<unknown>>;
    radioQueueEventsSubscribe.mockImplementationOnce((_filter: unknown, signal?: AbortSignal) => {
      pusher = pushableEventStream(signal);
      return pusher.iterable;
    });
    const { result, dispose } = withRoot(() =>
      useRadioRequestQueue({ stationId: () => "station-1", remoteRef: () => remoteRef })
    );
    await vi.waitFor(() => expect(result.rows().map((r) => r.id)).toEqual(["a"]));

    pusher.push({
      kind: "Submitted",
      station_id: "station-1",
      request: row({ id: "a", item_id: "song-a" }),
    });
    // give the microtask queue a tick to (not) apply the duplicate.
    await Promise.resolve();
    await Promise.resolve();
    expect(result.rows().map((r) => r.id)).toEqual(["a"]);
    dispose();
  });
});

// @vitest-environment jsdom
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingVideoReviewSession } from "@freqhole/api-client";
import type { CurrentRemoteInfo } from "../../music/data/currentState";
import { useVideoImportReview } from "./useVideoImportReview";

function backend(title: string) {
  const sessions: PendingVideoReviewSession[] = [
    {
      session_id: "session",
      created_at: 1,
      groups: [
        {
          group_key: "video",
          pending_blob_count: 1,
          videos: [{ video_id: "video", title, content_type: "movie" }],
        },
      ],
    },
  ];
  return {
    listPendingSessions: vi.fn(async (_id: string) => sessions),
    getSessionTarget: vi.fn(async (_id: string) => ({ id: "dest", name: "destination" })),
    patchGroup: vi.fn(async () => {}),
    moveVideo: vi.fn(async () => {}),
    markReviewed: vi.fn(async () => {}),
  };
}
const mocks = vi.hoisted(() => ({
  backends: new Map<string, ReturnType<typeof backend>>(),
  getBackend: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../services/reviewBackend", () => ({ getVideoReviewBackend: mocks.getBackend }));
vi.mock("../../components/feedback/Toast", () => ({ toast: { error: mocks.toast } }));
vi.mock("../../queryClient", () => ({ queryClient: { invalidateQueries: vi.fn() } }));

let dispose: (() => void) | undefined;
function mount(initial: CurrentRemoteInfo | null | undefined) {
  const [origin, setOrigin] = createSignal(initial);
  let review!: ReturnType<typeof useVideoImportReview>;
  dispose = render(() => {
    review = useVideoImportReview(() => "session", origin);
    return null;
  }, document.createElement("div"));
  return { review, setOrigin };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.backends = new Map([
    ["browser", backend("local file")],
    ["remote", backend("URL import")],
  ]);
  mocks.getBackend.mockImplementation((origin: CurrentRemoteInfo | null) => {
    const result = mocks.backends.get(origin?.remote_id ?? "browser");
    if (!result) throw new Error("unexpected library");
    return result;
  });
});
afterEach(() => dispose?.());

describe("video review source routing", () => {
  it("reviews and completes browser-local files while retaining the durable send destination", async () => {
    const { review } = mount(null);
    await vi.waitFor(() => expect(review.loading()).toBe(false));
    expect(review.groups()[0].videos[0].title).toBe("local file");
    expect(review.targetRemoteId()).toBe("dest");
    const local = mocks.backends.get("browser")!;
    local.listPendingSessions.mockResolvedValue([]);
    await review.markReviewed("video");
    await vi.waitFor(() => expect(review.groups()).toEqual([]));
    expect(local.markReviewed).toHaveBeenCalledWith("session", "video");
    expect(review.targetRemoteId()).toBe("dest");
    expect(review.error()).toBeNull();
    expect(mocks.backends.get("remote")!.markReviewed).not.toHaveBeenCalled();
  });

  it("waits for a resolved origin instead of implicitly opening local storage", async () => {
    const { review, setOrigin } = mount(undefined);
    expect(review.loading()).toBe(true);
    expect(mocks.getBackend).not.toHaveBeenCalled();
    setOrigin(null);
    await vi.waitFor(() => expect(review.loading()).toBe(false));
    expect(review.groups()[0].videos[0].title).toBe("local file");
  });

  it("does not treat a failed target lookup as a successfully drained review", async () => {
    mocks.backends
      .get("browser")!
      .getSessionTarget.mockRejectedValue(new Error("storage unavailable"));
    const { review } = mount(null);
    await vi.waitFor(() => expect(review.error()).toContain("storage unavailable"));
    expect(mocks.toast).toHaveBeenCalled();
    expect(review.targetRemoteId()).toBeUndefined();
  });

  it("does not let a previous origin's late failure poison the current session", async () => {
    let reject!: (error: Error) => void;
    mocks.backends.get("browser")!.listPendingSessions.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        })
    );
    const { review, setOrigin } = mount(null);
    await vi.waitFor(() => expect(reject).toBeDefined());
    setOrigin({ remote_id: "remote", name: "remote library" });
    expect(review.loading()).toBe(true);
    await vi.waitFor(() => expect(review.groups()[0]?.videos[0]?.title).toBe("URL import"));
    reject(new Error("old local read failed"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(review.groups()[0].videos[0].title).toBe("URL import");
    expect(review.error()).toBeNull();
  });
});

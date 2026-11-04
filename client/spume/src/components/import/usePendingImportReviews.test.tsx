// @vitest-environment jsdom
import { createSignal, untrack } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingReviewSession, PendingVideoReviewSession } from "@freqhole/api-client";
import type { CurrentRemoteInfo } from "../../music/data/currentState";
import { getReviewBackend } from "../../music/services/review/reviewBackend";
import { useImportReview } from "../../music/hooks/useImportReview";
import { usePendingImportReviews } from "./usePendingImportReviews";

const mocks = vi.hoisted(() => ({
  charnel: false,
  localRemote: null as CurrentRemoteInfo | null,
  browserSessions: [] as PendingReviewSession[],
  browserVideoSessions: [] as PendingVideoReviewSession[],
  browserMerge: vi.fn(),
  clients: new Map<string, ReturnType<typeof makeClient>>(),
  toastError: vi.fn(),
}));

function session(id: string): PendingReviewSession {
  return {
    session_id: id,
    created_at: 1,
    albums: [],
  };
}

function makeClient(id: string) {
  return {
    music: {
      listPendingImportReview: vi.fn(async (_request: { session_id: string | null }) => ({
        success: true,
        data: [session(`${id}-music`)],
      })),
      getImportSessionTarget: vi.fn(async () => ({ success: true, data: {} })),
      mergeAlbumsReview: vi.fn(async () => ({ success: true })),
      patchAlbumReview: vi.fn(async () => ({ success: true })),
      moveSongReview: vi.fn(async () => ({ success: true })),
      markAlbumReviewed: vi.fn(async () => ({ success: true })),
    },
    video: {
      listPendingVideoImportReview: vi.fn(async () => ({
        success: true,
        data: [{ session_id: `${id}-video`, created_at: 1, groups: [] }],
      })),
    },
  };
}

vi.mock("../../app/services/charnel", () => ({ isCharnelMode: () => mocks.charnel }));
vi.mock("../../app/services/remotes/remoteManager", () => ({
  getTauriManagedRemote: async () => mocks.localRemote,
}));
vi.mock("../../app/api/client", () => ({
  getClientForRemote: async (remote: CurrentRemoteInfo) => {
    const client = mocks.clients.get(remote.remote_id);
    if (!client) throw new Error(`unexpected review library: ${remote.remote_id}`);
    return client;
  },
}));
vi.mock("../../music/services/review/localIdbReviewBackend", () => ({
  createLocalIdbReviewBackend: () => ({
    listPendingSessions: async () => mocks.browserSessions,
    mergeAlbums: mocks.browserMerge,
  }),
}));
vi.mock("../../video/services/storage/db/importReview", () => ({
  listLocalPendingVideoReviews: async () => mocks.browserVideoSessions,
  patchLocalVideoReviewGroup: vi.fn(),
  moveLocalReviewVideo: vi.fn(),
  markLocalVideoGroupReviewed: vi.fn(),
}));
vi.mock("../feedback/Toast", () => ({ toast: { error: mocks.toastError } }));

const local: CurrentRemoteInfo = {
  remote_id: "local",
  name: "this device",
  is_charnel_managed: true,
};
const remoteA: CurrentRemoteInfo = { remote_id: "a", name: "library a", peer_addr: "peer-a" };
const remoteB: CurrentRemoteInfo = { remote_id: "b", name: "library b", peer_addr: "peer-b" };
let dispose: (() => void) | undefined;

function mountReviews(initialTarget: CurrentRemoteInfo | null) {
  const [target, setTarget] = createSignal(initialTarget);
  const [isOpen, setOpen] = createSignal(true);
  let reviews!: ReturnType<typeof usePendingImportReviews>;
  dispose = render(() => {
    reviews = usePendingImportReviews({
      get isOpen() {
        return isOpen();
      },
      get targetRemote() {
        return target();
      },
    });
    return null;
  }, document.createElement("div"));
  return {
    get reviews() {
      return reviews;
    },
    setTarget,
    setOpen,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.charnel = false;
  mocks.localRemote = null;
  mocks.browserSessions = [];
  mocks.browserVideoSessions = [];
  mocks.clients = new Map(
    [local, remoteA, remoteB].map((remote) => [remote.remote_id, makeClient(remote.remote_id)])
  );
});
afterEach(() => dispose?.());

describe("add-media review origins", () => {
  it("lists browser video-file sessions locally alongside URL reviews on their remote", async () => {
    mocks.browserVideoSessions = [{ session_id: "browser-video-files", created_at: 1, groups: [] }];
    const { reviews } = mountReviews(remoteA);
    await vi.waitFor(() => expect(reviews.videoPendingSessions()).toHaveLength(2));
    expect(reviews.videoPendingSessions()?.map((s) => [s.session_id, s.originRemote])).toEqual([
      ["browser-video-files", null],
      ["a-video", remoteA],
    ]);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
  it("finds browser URL sessions on the fetch remote while file sessions remain local", async () => {
    mocks.browserSessions = [session("browser-files")];
    const { reviews } = mountReviews(remoteA);
    await vi.waitFor(() => expect(reviews.pendingSessions()).toHaveLength(2));
    const sessions = reviews.pendingSessions()!;
    expect(sessions.map((s) => [s.session_id, s.originRemote])).toEqual([
      ["browser-files", null],
      ["a-music", remoteA],
    ]);
    expect(reviews.videoPendingSessions()?.[0].originRemote).toEqual(remoteA);

    await getReviewBackend(sessions[0].originRemote).mergeAlbums(
      "browser-files",
      ["source"],
      "target"
    );
    await getReviewBackend(sessions[1].originRemote).mergeAlbums("a-music", ["source"], "target");
    expect(mocks.browserMerge).toHaveBeenCalledWith("browser-files", ["source"], "target");
    expect(mocks.clients.get("a")!.music.mergeAlbumsReview).toHaveBeenCalledWith({
      session_id: "a-music",
      source_ids: ["source"],
      target_id: "target",
    });
    expect(mocks.clients.get("local")!.music.mergeAlbumsReview).not.toHaveBeenCalled();
  });

  it("keeps Charnel file review local even when the reviewed output is destined for a remote", async () => {
    mocks.charnel = true;
    mocks.localRemote = local;
    const localClient = mocks.clients.get("local")!;
    localClient.music.listPendingImportReview.mockResolvedValue({
      success: true,
      data: [{ ...session("file-import"), target_remote_id: "a", target_remote_name: "library a" }],
    });
    const { reviews } = mountReviews(remoteA);
    await vi.waitFor(() => expect(reviews.pendingSessions()).toHaveLength(2));
    const files = reviews.pendingSessions()!.find((s) => s.session_id === "file-import")!;
    expect(files.originRemote).toEqual(local);
    expect(
      reviews.pendingSessions()!.find((s) => s.session_id === "a-music")!.originRemote
    ).toEqual(remoteA);
    await getReviewBackend(files.originRemote).mergeAlbums("file-import", ["source"], "target");
    expect(localClient.music.mergeAlbumsReview).toHaveBeenCalled();
    expect(mocks.clients.get("a")!.music.mergeAlbumsReview).not.toHaveBeenCalled();
  });

  it("queries a newly selected target without requiring a close or completed job", async () => {
    const { reviews, setTarget } = mountReviews(remoteA);
    await vi.waitFor(() => expect(reviews.pendingSessions()?.[0]?.originRemote).toEqual(remoteA));
    const openedSession = reviews.pendingSessions()![0];
    setTarget(remoteB);
    await vi.waitFor(() => expect(reviews.pendingSessions()?.[0]?.originRemote).toEqual(remoteB));
    expect(reviews.videoPendingSessions()?.[0]?.originRemote).toEqual(remoteB);
    await getReviewBackend(openedSession.originRemote).mergeAlbums("a-music", ["source"], "target");
    expect(mocks.clients.get("a")!.music.mergeAlbumsReview).toHaveBeenCalled();
    expect(mocks.clients.get("b")!.music.mergeAlbumsReview).not.toHaveBeenCalled();
  });

  it("ignores an older destination's late response", async () => {
    let finish!: (value: { success: boolean; data: PendingReviewSession[] }) => void;
    mocks.clients.get("a")!.music.listPendingImportReview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { reviews, setTarget } = mountReviews(remoteA);
    await vi.waitFor(() => expect(finish).toBeDefined());
    setTarget(remoteB);
    await vi.waitFor(() => expect(reviews.pendingSessions()?.[0]?.originRemote).toEqual(remoteB));
    finish({ success: true, data: [session("late-a")] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reviews.pendingSessions()?.[0]?.session_id).toBe("b-music");
    expect(reviews.pendingSessions()?.[0]?.originRemote).toEqual(remoteB);
  });

  it("does not query the local Charnel library twice when it is also the URL destination", async () => {
    mocks.charnel = true;
    mocks.localRemote = local;
    const { reviews } = mountReviews(local);
    await vi.waitFor(() => expect(reviews.pendingSessions()).toHaveLength(1));
    expect(reviews.pendingSessions()?.[0].originRemote).toEqual(local);
    expect(mocks.clients.get("local")!.music.listPendingImportReview).toHaveBeenCalledTimes(1);
  });

  it("pins album reads and every review mutation to the opened session's remote", async () => {
    let review!: ReturnType<typeof useImportReview>;
    const [browsedRemote, setBrowsedRemote] = createSignal<CurrentRemoteInfo | null>(remoteA);
    const origin = untrack(browsedRemote);
    dispose = render(() => {
      review = useImportReview(
        () => "a-music",
        () => origin
      );
      return null;
    }, document.createElement("div"));
    await vi.waitFor(() => expect(review.loading()).toBe(false));
    const client = mocks.clients.get("a")!;
    expect(client.music.listPendingImportReview).toHaveBeenCalledWith({ session_id: "a-music" });
    setBrowsedRemote(remoteB);
    await review.mergeAlbums(["source"], "target");
    await review.patchAlbum("target", { title: "merged album" });
    await review.moveSong("song", "target");
    await review.markReviewed("target");
    expect(client.music.mergeAlbumsReview).toHaveBeenCalledWith({
      session_id: "a-music",
      source_ids: ["source"],
      target_id: "target",
    });
    expect(client.music.patchAlbumReview).toHaveBeenCalledWith({
      session_id: "a-music",
      album_id: "target",
      title: "merged album",
    });
    expect(client.music.moveSongReview).toHaveBeenCalledWith({
      session_id: "a-music",
      song_id: "song",
      to_album_id: "target",
      new_album_title: null,
      new_album_artist_name: null,
    });
    expect(client.music.markAlbumReviewed).toHaveBeenCalledWith({
      session_id: "a-music",
      album_id: "target",
    });
    expect(mocks.clients.get("local")!.music.listPendingImportReview).not.toHaveBeenCalled();
    expect(mocks.clients.get("b")!.music.listPendingImportReview).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("does not interpret an unresolved review origin as browser storage", async () => {
    let review!: ReturnType<typeof useImportReview>;
    const [origin, setOrigin] = createSignal<CurrentRemoteInfo | null | undefined>();
    dispose = render(() => {
      review = useImportReview(() => "a-music", origin);
      return null;
    }, document.createElement("div"));
    await Promise.resolve();
    expect(review.loading()).toBe(true);
    expect(mocks.clients.get("a")!.music.listPendingImportReview).not.toHaveBeenCalled();
    await review.mergeAlbums(["source"], "target");
    expect(mocks.browserMerge).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("merge failed: review library is still loading");
    setOrigin(remoteA);
    await vi.waitFor(() => expect(review.loading()).toBe(false));
    expect(mocks.clients.get("a")!.music.listPendingImportReview).toHaveBeenCalled();
  });
});

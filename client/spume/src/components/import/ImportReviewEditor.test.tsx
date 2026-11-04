// @vitest-environment jsdom
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentRemoteInfo } from "../../music/data/currentState";
import type { ImportReviewHandle } from "../../music/hooks/useImportReview";
import { ImportReviewEditor } from "./ImportReviewEditor";

const mocks = vi.hoisted(() => ({
  client: { name: "session library" },
  localClient: { name: "browser library" },
  getClient: vi.fn(),
  panel: vi.fn((_props: { apiClient: unknown; reviewRemote?: CurrentRemoteInfo | null }) => null),
}));
vi.mock("../../app/api/client", () => ({ getClientForRemote: mocks.getClient }));
vi.mock("../../music/services/local-api/localTaxonomyClient", () => ({
  localTaxonomyClient: mocks.localClient,
}));
vi.mock("../../music/data/local/localSource", () => ({ localDataSource: {} }));
vi.mock("../../lib/musicbrainzBrowserClient", () => ({ mbBrowserClient: {} }));
vi.mock("./ImportAlbumEditorPanel", () => ({ ImportAlbumEditorPanel: mocks.panel }));

const remote: CurrentRemoteInfo = { remote_id: "fetch-target", name: "fetch target" };
let dispose: (() => void) | undefined;

function mountEditor(origin: CurrentRemoteInfo | null) {
  const review: ImportReviewHandle = {
    albums: () => [],
    loading: () => false,
    targetRemoteId: () => undefined,
    targetRemoteName: () => undefined,
    patchAlbum: vi.fn(),
    mergeAlbums: vi.fn(),
    moveSong: vi.fn(),
    markReviewed: vi.fn(),
    refetch: vi.fn(),
  };
  dispose = render(
    () => (
      <ImportReviewEditor
        remote={origin}
        reviewHandle={review}
        sessionId="session"
        album={{ id: "album", title: "album", artist: null, artworkUrl: null, songs: [] }}
        albumIndex={0}
        albumTotal={1}
        isReviewed={false}
        onPrev={() => {}}
        onNext={() => {}}
        onLooksGood={() => {}}
        onRegisterSave={() => {}}
        onUnregisterSave={() => {}}
      />
    ),
    document.createElement("div")
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClient.mockResolvedValue(mocks.client);
});
afterEach(() => dispose?.());

describe("import review metadata library", () => {
  it("waits for the session client before mounting editors that could fall back to the browsed library", async () => {
    let finish!: (client: typeof mocks.client) => void;
    mocks.getClient.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    mountEditor(remote);
    await vi.waitFor(() => expect(mocks.getClient).toHaveBeenCalledWith(remote));
    expect(mocks.panel).not.toHaveBeenCalled();
    finish(mocks.client);
    await vi.waitFor(() => expect(mocks.panel).toHaveBeenCalled());
    const props = mocks.panel.mock.calls[0][0];
    expect(props.apiClient).toBe(mocks.client);
    expect(props.reviewRemote).toBe(remote);
  });

  it("supplies the browser taxonomy client explicitly for local file review", async () => {
    mountEditor(null);
    await vi.waitFor(() => expect(mocks.panel).toHaveBeenCalled());
    const props = mocks.panel.mock.calls[0][0];
    expect(props.apiClient).toBe(mocks.localClient);
    expect(props.reviewRemote).toBeNull();
    expect(mocks.getClient).not.toHaveBeenCalled();
  });
});

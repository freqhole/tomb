// @vitest-environment jsdom
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import { ResolveShareModal } from "./ResolveShareModal";
import { getRemoteByPeerAddr } from "../../app/services/remotes/remoteManager";
import type { Remote } from "../../app/services/storage/schemas/remote";

vi.mock("./Modal", () => ({ Modal: (props: { children: JSX.Element }) => props.children }));
vi.mock("../icons/registry", () => ({ Icon: () => null }));
vi.mock("../../utils/permalink", () => ({
  decodeShareToken: () => ({ v: 1, k: "album", i: "album", t: "shared album", s: { n: "peer" } }),
}));
vi.mock("../../app/services/remotes/remoteManager", () => ({
  getRemoteByPeerAddr: vi.fn(async () => null),
  getTauriManagedRemote: vi.fn(async () => null),
}));
vi.mock("../../app/services/charnel", () => ({ getLocalNodeId: () => null, isCharnelMode: () => false }));
vi.mock("../../music/utils/routing", () => ({ getDefaultRoute: () => "/remote" }));
vi.mock("../../music/state/highlightedSong", () => ({ setHighlightedSongId: vi.fn() }));
vi.mock("../share/startSharedRadioStation", () => ({
  ensurePendingRemoteForNode: async () => {},
  startSharedRadioStation: vi.fn(),
}));

afterEach(() => { vi.clearAllMocks(); });

it.each([false, true])("reopens received shares without auto-navigation (connected: %s)", async (connected) => {
  const remote: Remote = {
    remote_id: "remote", name: "connected remote", transport: "wasm", peer_addr: "peer",
    is_active: true, last_connected_at: null, created_at: 0, updated_at: 0,
    description: null, image_url: null, image_blob_id: null, version: null, last_info_check: null,
  };
  vi.mocked(getRemoteByPeerAddr).mockImplementation(async () =>
    connected ? remote : undefined
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  const close = vi.fn();
  const dispose = render(() => <ResolveShareModal
    token="saved-token"
    autoNavigate={false}
    onClose={close}
    onAddRemote={vi.fn()}
  />, host);
  try {
    await vi.waitFor(() => expect(host.querySelector('a[href="freqhole://o/saved-token"]')).not.toBeNull());
    expect(host.textContent).toContain("shared album");
    expect(close).not.toHaveBeenCalled();
  } finally {
    dispose();
    host.remove();
  }
});

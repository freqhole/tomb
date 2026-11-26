// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { PlaylistSelectorModal } from "./PlaylistSelectorModal";

const mocks = vi.hoisted(() => ({
  charnel: false,
  active: null as { remote_id: string; name: string } | null,
  localRemote: null as Remote | null,
  localPlaylists: vi.fn(),
  sourcePlaylists: [] as Array<{ playlist_id: string; title: string; song_count: number }>,
  importItems: vi.fn(),
  addLocal: vi.fn(),
  addRemote: vi.fn(),
  findRemote: vi.fn(),
}));
vi.mock("../modals/Modal", () => ({ Modal: (props: { children: JSX.Element }) => props.children }));
vi.mock("../icons/registry", () => ({ Icon: () => null, IconNames: { playlist: "playlist", add: "add" } }));
vi.mock("../buttons/Button", () => ({
  Button: (props: { children: JSX.Element; onClick?: () => void; disabled?: boolean }) =>
    <button onClick={props.onClick} disabled={props.disabled}>{props.children}</button>,
}));
vi.mock("../badges/Badge", () => ({ Badge: (props: { children: JSX.Element }) => props.children }));
vi.mock("../forms/TextInput", () => ({
  TextInput: (props: { value: string; onInput: JSX.EventHandlerUnion<HTMLInputElement, InputEvent> }) =>
    <input value={props.value} onInput={props.onInput} />,
}));
vi.mock("../../music/data", () => ({
  getCurrentRemote: () => mocks.active,
  getCurrentUser: () => null,
  isLocalSourceActive: () => !mocks.active,
}));
vi.mock("../../music/data/permissions", () => ({ canCreatePlaylist: () => false }));
vi.mock("../../app/services/charnel", () => ({ isCharnelMode: () => mocks.charnel }));
vi.mock("../../app/services/remotes/remoteManager", () => ({
  getTauriManagedRemote: async () => mocks.localRemote,
  getRemoteById: mocks.findRemote,
}));
vi.mock("../../music/data/local/localSource", () => ({
  localDataSource: { getPlaylists: mocks.localPlaylists },
}));
vi.mock("../../music/data/remote/remoteSource", () => ({
  RemoteMusicDataSource: class { getPlaylists = mocks.localPlaylists; },
}));
vi.mock("../../music/queries/playlists", () => ({
  useRecentPlaylistsQuery: () => ({ get data() { return mocks.sourcePlaylists; } }),
  usePlaylistsQuery: (options: { search: () => string }) => ({
    get data() {
      const search = options.search().toLowerCase();
      return { pages: [{ items: mocks.sourcePlaylists.filter((p) => p.title.toLowerCase().includes(search)) }] };
    },
  }),
  useCreatePlaylistMutation: () => ({ isPending: false }),
}));
vi.mock("../../video/queries/playlistItems", () => ({
  useAddPlaylistItemsMutation: () => ({ isPending: false, mutateAsync: mocks.addRemote }),
}));
vi.mock("../../music/services/sync/importPlaylistItemsToLocal", () => ({
  importPlaylistItemsToLocal: mocks.importItems,
}));
vi.mock("../../music/services/storage/db/init", () => ({ initMusicDB: async () => "db" }));
vi.mock("../../music/services/storage/playlists", () => ({ addPlaylistItemsToLocal: mocks.addLocal }));

const source: Remote = {
  remote_id: "source", name: "friend", transport: "http", base_url: "https://example.test",
  is_active: true, last_connected_at: null, created_at: 0, updated_at: 0,
  description: null, image_url: null, image_blob_id: null, version: null, last_info_check: null,
};
const local = { ...source, remote_id: "self", name: "local", is_charnel_managed: true };
let host: HTMLDivElement;
let dispose: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.charnel = false;
  mocks.active = source;
  mocks.localRemote = null;
  mocks.sourcePlaylists = [{ playlist_id: "remote-list", title: "remote list", song_count: 0 }];
  mocks.localPlaylists.mockResolvedValue({
    items: [{ playlist_id: "local-list", title: "local list", song_count: 0 }],
  });
  mocks.importItems.mockResolvedValue([{ entity_type: "song", entity_id: "local-song" }]);
  mocks.findRemote.mockResolvedValue(source);
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => { dispose?.(); host.remove(); });

function open(remote?: Remote) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const close = vi.fn();
  dispose = render(() => (
    <QueryClientProvider client={client}>
      <PlaylistSelectorModal isOpen={true} onClose={close}
        items={[{ entity_type: "song", entity_id: "remote-song" }]} remote={remote} />
    </QueryClientProvider>
  ), host);
  return close;
}

it.each([false, true])("groups destinations and imports before adding locally (charnel: %s)", async (charnel) => {
  mocks.charnel = charnel;
  mocks.localRemote = charnel ? local : null;
  const close = open(source);
  await vi.waitFor(() => expect(host.textContent).toContain("local list"));
  const text = host.textContent ?? "";
  expect(text.indexOf("friend")).toBeLessThan(text.indexOf("remote list"));
  expect(text.indexOf("remote list")).toBeLessThan(text.indexOf("local library"));
  expect(text.indexOf("local library")).toBeLessThan(text.indexOf("local list"));
  Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("local list"))?.click();
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  expect(mocks.importItems).toHaveBeenCalledWith(
    [{ entity_type: "song", entity_id: "remote-song" }], source
  );
  if (charnel) {
    expect(mocks.addRemote).toHaveBeenCalledWith({
      playlistId: "local-list", items: [{ entity_type: "song", entity_id: "local-song" }], remote: local,
    });
  } else {
    expect(mocks.addLocal).toHaveBeenCalledWith("db", "local-list", [
      { entity_type: "song", entity_id: "local-song" },
    ]);
  }
});

it("shows local playlists even when the remote has none", async () => {
  mocks.sourcePlaylists = [];
  open(source);
  await vi.waitFor(() => expect(host.textContent).toContain("local list"));
  expect(host.textContent).toContain("no playlists on this remote");
  expect(host.textContent).toContain("local library");
});

it("shows a local playlist loading error even when the remote has no results", async () => {
  mocks.sourcePlaylists = [];
  mocks.localPlaylists.mockRejectedValue(new Error("offline"));
  open(source);
  await vi.waitFor(() => expect(host.textContent).toContain("failed to load local playlists"));
});

it("keeps search results under their own source headings", async () => {
  mocks.sourcePlaylists = [
    { playlist_id: "one", title: "mix remote", song_count: 0 },
    { playlist_id: "two", title: "unrelated", song_count: 0 },
  ];
  mocks.localPlaylists.mockImplementation(async ({ search }: { search?: string }) => ({
    items: search ? [{ playlist_id: "local-list", title: "mix local", song_count: 0 }] : [],
  }));
  open(source);
  const input = host.querySelector("input")!;
  input.value = "mix";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(host.textContent).toContain("mix local"));
  const text = host.textContent ?? "";
  expect(text.indexOf("friend")).toBeLessThan(text.indexOf("mix remote"));
  expect(text.indexOf("mix remote")).toBeLessThan(text.indexOf("local library"));
  expect(text.indexOf("local library")).toBeLessThan(text.indexOf("mix local"));
  expect(text).not.toContain("unrelated");
});

it("adds to a remote playlist on the media source without importing it", async () => {
  const close = open(source);
  await vi.waitFor(() => expect(host.textContent).toContain("local list"));
  Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("remote list"))?.click();
  await vi.waitFor(() => expect(close).toHaveBeenCalled());
  expect(mocks.addRemote).toHaveBeenCalledWith({
    playlistId: "remote-list", items: [{ entity_type: "song", entity_id: "remote-song" }], remote: source,
  });
  expect(mocks.importItems).not.toHaveBeenCalled();
});

it("keeps the existing ungrouped layout for the local library", async () => {
  mocks.charnel = true;
  mocks.localRemote = local;
  mocks.active = local;
  open(local);
  await vi.waitFor(() => expect(host.textContent).toContain("recent playlists"));
  expect(host.textContent).not.toContain("local library");
  expect(mocks.localPlaylists).not.toHaveBeenCalled();
});

it("shows import errors without adding dangling references", async () => {
  mocks.importItems.mockRejectedValue(new Error("transfer failed"));
  const close = open(source);
  await vi.waitFor(() => expect(host.textContent).toContain("local list"));
  Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("local list"))?.click();
  await vi.waitFor(() => expect(host.textContent).toContain("transfer failed"));
  expect(mocks.addLocal).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

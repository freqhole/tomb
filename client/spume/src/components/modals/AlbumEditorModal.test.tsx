// @vitest-environment jsdom
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import { AlbumEditorModal } from "./AlbumEditorModal";
import type { Album } from "../../music/services/storage/types";

const state = vi.hoisted(() => ({
  album: () => undefined as Partial<Album> | undefined,
  refetch: vi.fn(),
  refreshTaxons: vi.fn(),
}));
vi.mock("@tanstack/solid-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../music/queries/songs", () => ({
  useAlbumQuery: () => ({
    get data() {
      return state.album();
    },
    refetch: state.refetch,
    status: "success",
  }),
  useAlbumSongsQuery: () => ({
    data: { items: [] },
    refetch: async () => ({ data: { items: [] } }),
  }),
}));
vi.mock("../../music/queries/mutations", () => ({ useUpdateAlbumMutation: () => ({}) }));
vi.mock("../../music/data", () => ({ getCurrentRemote: () => undefined, getDataSource: vi.fn() }));
vi.mock("../../music/data/currentState", () => ({ getCurrentRemote: () => undefined }));
vi.mock("../../music/data/permissions", () => ({
  canUpdateAlbum: () => true,
  canDeleteAlbum: () => false,
}));
vi.mock("../../music/hooks/useAlbumPending", () => ({
  useAlbumPending: () => ({ hasPending: () => false }),
}));
vi.mock("../../music/hooks/useEnrichmentEnabled", () => ({
  useEnrichmentEnabledQuery: () => ({ data: { mb: true, lastfm: false, audiodb: false } }),
}));
vi.mock("../../library/hooks/useRemoteRole", () => ({ useRemoteIsAdmin: () => false }));
vi.mock("../../music/hooks/modals", () => ({ showArtistEditor: vi.fn() }));
vi.mock("../../app/services/jobs/jobService", () => ({ pollJobUntilComplete: vi.fn() }));
vi.mock("../../app/services/confirmState", () => ({ confirm: vi.fn() }));
vi.mock("../../app/api/client", () => ({ getClientForRemote: vi.fn() }));
vi.mock("../../utils/logger", () => ({ debug: vi.fn(), error: vi.fn() }));
vi.mock("../feedback/Toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../icons/registry", () => ({ Icon: () => null, IconNames: {} }));
vi.mock("./Modal", () => ({ Modal: (props: { children: unknown }) => props.children }));
vi.mock("../buttons/Button", () => ({
  Button: (props: { children: string; onClick?: () => void }) => (
    <button onClick={props.onClick}>{props.children}</button>
  ),
}));
vi.mock("../forms/AlbumAutocomplete", () => ({
  AlbumAutocomplete: (props: { value: string; onSelect: (s: { title: string }) => void }) => (
    <input
      aria-label="album title"
      value={props.value}
      onInput={(e) => props.onSelect({ title: e.currentTarget.value })}
    />
  ),
}));
vi.mock("../forms/ArtistAutocomplete", () => ({ ArtistAutocomplete: () => null }));
vi.mock("../forms/EntityUrlz", () => ({ EntityUrlz: () => null }));
vi.mock("../layout/EntityImages", () => ({
  EntityImages: (props: { images: { remote_blob_id?: string }[] }) => (
    <div data-testid="images">{props.images.map((image) => image.remote_blob_id).join(",")}</div>
  ),
}));
vi.mock("./AlbumTaxonsEditor", () => ({
  AlbumTaxonsEditor: (props: { ref: (handle: object) => void }) => {
    props.ref({ refresh: state.refreshTaxons, isDirty: () => false });
    return null;
  },
}));
vi.mock("../musicbrainz/MusicBrainzPanel", () => ({
  MusicBrainzPanel: (props: { onAlbumUpdated: () => void }) => (
    <button onClick={props.onAlbumUpdated}>apply enrichment</button>
  ),
}));
vi.mock("../enrichment/AlbumEnrichmentSourceTab", () => ({ AlbumEnrichmentSourceTab: () => null }));
vi.mock("../enrichment/SingleAlbumTaxonApplyPanel", () => ({
  SingleAlbumTaxonApplyPanel: () => null,
}));
vi.mock("../../library/components/EnrichmentReviewPanel", () => ({
  EnrichmentReviewPanel: () => null,
}));

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.clearAllMocks();
});

it("refreshes enrichment images and metadata for an empty album without losing unsaved edits", async () => {
  const [album, setAlbum] = createSignal<Partial<Album>>({
    album_id: "album",
    title: "old title",
    album_type: "album",
    images: [{ remote_blob_id: "old-image", is_primary: true, blob_type: "original" }],
  });
  state.album = album;
  state.refetch.mockImplementation(async () => {
    setAlbum({
      ...album(),
      title: "MB title",
      album_type: "single",
      images: [{ remote_blob_id: "new-image", is_primary: true, blob_type: "original" }],
    });
    return { data: album() };
  });
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <AlbumEditorModal albumId="album" onClose={() => {}} />, host);
  const title = host.querySelector<HTMLInputElement>('[aria-label="album title"]')!;
  expect(title.value).toBe("old title");
  title.value = "unsaved title";
  title.dispatchEvent(new Event("input", { bubbles: true }));
  host.querySelector<HTMLButtonElement>("#tab-musicbrainz")!.click();
  const apply = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "apply enrichment"
  )!;
  apply.click();
  await vi.waitFor(() => expect(state.refreshTaxons).toHaveBeenCalled());
  expect(title.value).toBe("unsaved title");
  expect(host.querySelector("select")!.value).toBe("single");
  expect(host.querySelector('[data-testid="images"]')!.textContent).toBe("new-image");
  setAlbum({ ...album(), images: [] });
  expect(host.querySelector('[data-testid="images"]')!.textContent).toBe("");
});

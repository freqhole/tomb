// modal state helpers for song, artist, and album editors
import { createSignal } from "solid-js";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { queryClient } from "../../queryClient";
import { toast } from "../../components/feedback/Toast";

// query-key prefixes invalidated whenever a music-edit modal closes.
// the user may have changed entity names/ids that downstream lists,
// detail views, and search caches all reference, so we cast a wide
// net rather than try to surgically patch each cache.
const MUSIC_EDIT_INVALIDATION_KEYS: readonly string[] = [
  "songs",
  "song",
  "albums",
  "album",
  "artists",
  "artist",
  "genres",
  "genre",
  "playlists",
  "search",
  "tags",
  "analytics",
  "favorites",
  "library-albums",
  "library-artists",
  "library-songs",
];

function invalidateMusicEditQueries() {
  for (const key of MUSIC_EDIT_INVALIDATION_KEYS) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

// modal stack to track which modal is topmost for esc key handling
interface ModalEntry {
  id: string;
  onClose: () => void;
}

const modalStack: ModalEntry[] = [];
let escapeListenerInstalled = false;

// reactive mirror of modalStack.length - lets components (e.g. the video
// mini player) react to any modal opening/closing without polling.
const [modalStackSize, setModalStackSize] = createSignal(0);

function handleGlobalEscape(e: KeyboardEvent) {
  if (e.key === "Escape" && modalStack.length > 0) {
    // immediately pop the modal from the stack before calling onClose
    const topModal = modalStack.pop()!;
    setModalStackSize(modalStack.length);

    // remove global listener if no more modals
    if (modalStack.length === 0 && escapeListenerInstalled) {
      window.removeEventListener("keydown", handleGlobalEscape);
      escapeListenerInstalled = false;
    }

    // now call the close handler
    topModal.onClose();
  }
}

export function pushModal(modalId: string, onClose: () => void) {
  modalStack.push({ id: modalId, onClose });
  setModalStackSize(modalStack.length);

  // install global escape listener once
  if (!escapeListenerInstalled) {
    window.addEventListener("keydown", handleGlobalEscape);
    escapeListenerInstalled = true;
  }
}

export function popModal(modalId: string) {
  const index = modalStack.findIndex((m) => m.id === modalId);
  if (index !== -1) {
    modalStack.splice(index, 1);
  }
  setModalStackSize(modalStack.length);

  // remove global listener when no modals are open
  if (modalStack.length === 0 && escapeListenerInstalled) {
    window.removeEventListener("keydown", handleGlobalEscape);
    escapeListenerInstalled = false;
  }
}

/** true when at least one modal is on the global modal stack. used by
 *  view-level esc handlers to skip their own "close" behaviour when a
 *  modal is already going to consume the keystroke. */
export function isAnyModalOpen(): boolean {
  return modalStack.length > 0;
}

/** reactive version of `isAnyModalOpen` - true while any modal is on the
 *  global stack. used to auto-dismiss the video mini player when a modal
 *  opens over it. */
export function useIsAnyModalOpen(): () => boolean {
  return () => modalStackSize() > 0;
}

interface SongEditorOptions {
  songId: string;
  /** when set, the modal queries/updates against this remote instead of
   *  the globally-active data source. used by context-menu actions on
   *  songs that came from a remote different from the current source. */
  remote?: Remote;
  onSave?: () => void;
  disableNestedModals?: boolean;
}

interface ArtistEditorOptions {
  artistId: string;
  /** when set, the modal queries against this remote instead of the
   *  globally-active data source. mirrors the album/song editor pattern
   *  for cases (e.g. graph view) where the displayed entity belongs to
   *  a non-active remote. */
  remote?: Remote;
  onSave?: () => void;
  disableNestedModals?: boolean;
}

interface AlbumEditorOptions {
  albumId: string;
  /** when set, the modal queries against this remote instead of the
   *  globally-active data source. needed because the library view lets
   *  the user pick a remote independently of `getDataSource()`. */
  remote?: Remote;
  onSave?: () => void;
  disableNestedModals?: boolean;
  /** called after a successful merge with the target album id, so callers can navigate */
  onMergeNavigate?: (newAlbumId: string) => void;
  /** called after a successful delete so callers can navigate away from the now-gone album */
  onDeleted?: () => void;
  /** bulk-enrichment review mode (phase 14.7/14.9). when set, the modal
   *  renders a header strip + footer toolbar + arrow/`j`/`k` keybindings
   *  for navigating through the supplied list. */
  review?: {
    ids: string[];
    currentIndex: number;
    onNext: () => void;
    onPrev: () => void;
    onExit: () => void;
  };
}

// song editor
const [songEditorState, setSongEditorState] = createSignal<SongEditorOptions | null>(null);

export function showSongEditor(options: SongEditorOptions) {
  setSongEditorState(options);
}

export function hideSongEditor() {
  setSongEditorState(null);
  invalidateMusicEditQueries();
}

export function useSongEditorState() {
  return songEditorState;
}

// artist editor
const [artistEditorState, setArtistEditorState] = createSignal<ArtistEditorOptions | null>(null);

export function showArtistEditor(options: ArtistEditorOptions) {
  setArtistEditorState(options);
}

export function hideArtistEditor() {
  setArtistEditorState(null);
  invalidateMusicEditQueries();
}

export function useArtistEditorState() {
  return artistEditorState;
}

// album editor
const [albumEditorState, setAlbumEditorState] = createSignal<AlbumEditorOptions | null>(null);

export function showAlbumEditor(options: AlbumEditorOptions) {
  setAlbumEditorState(options);
}

export function hideAlbumEditor() {
  setAlbumEditorState(null);
  invalidateMusicEditQueries();
}

export function useAlbumEditorState() {
  return albumEditorState;
}

// image carousel
//
// each slide is a "slot" with a stable identity/index so a carousel can be
// opened immediately with placeholders for every expected image (count
// known up front, before any url has actually resolved) and have slots
// filled in — or marked failed — independently as each resolves. this
// replaces the old "open on first success, append the rest" model, which
// couldn't show the user how many images were still coming.
export interface CarouselSlide {
  /** resolved full-res url, or null while still resolving. */
  url: string | null;
  /** small pre-generated thumbnail url for the strip, when cheaply
   *  available (plain http remotes only — see `openImageCarouselFromResolvers`).
   *  falls back to client-side downscaling of `url` in the modal when absent. */
  thumbnailUrl?: string | null;
  /** true once we know this slot can't be resolved/shown. */
  failed?: boolean;
}

export type ImageResolveResult = { url: string; thumbnailUrl?: string | null } | null | undefined;

interface ImageCarouselOptions {
  images: CarouselSlide[];
  initialIndex?: number;
  title?: string;
  /** internal — guards against a slower, superseded resolution batch
   *  mutating a carousel the user has since closed or replaced by
   *  opening a different one. not meant to be passed by callers. */
  sessionId?: number;
}

const [imageCarouselState, setImageCarouselState] = createSignal<ImageCarouselOptions | null>(null);

export function showImageCarousel(options: ImageCarouselOptions) {
  setImageCarouselState(options);
}

// build a consistent header title for the image carousel modal. the
// count used to be appended ("name — N images") but it was easy to
// drift out of sync with what the modal actually renders (failed-load
// dedup happens inside the modal), so we just show the entity name.
// the `_count` param is kept so existing call sites don't have to
// change; callers can still pass it but it has no effect.
export function formatImageCarouselTitle(
  name: string | null | undefined,
  _count?: number
): string | undefined {
  const n = (name ?? "").trim();
  return n || undefined;
}

export function hideImageCarousel() {
  setImageCarouselState(null);
}

export function useImageCarouselState() {
  return imageCarouselState;
}

// true while an image-carousel trigger (playerbar, album/artist/playlist
// detail, etc) is gathering images (sync collection + entity hydration),
// before we even know how many slides there will be. drives a spinner at
// the trigger button so clicking gives immediate feedback instead of an
// invisible wait; cleared as soon as the carousel opens with placeholders.
const [imageCarouselLoading, setImageCarouselLoading] = createSignal(false);

export function useImageCarouselLoading() {
  return imageCarouselLoading;
}

/** call at the very start of an image-carousel trigger handler, before
 *  any hydration/network prep work, so the spinner appears immediately
 *  on click rather than only once url-resolution actually begins. */
export function beginImageCarouselLoading(): void {
  setImageCarouselLoading(true);
}

/** clear the loading spinner without opening anything or showing a
 *  toast — for the normal "this entity has no images at all" case,
 *  which isn't a failure worth alarming the user about. */
export function endImageCarouselLoading(): void {
  setImageCarouselLoading(false);
}

let carouselSessionCounter = 0;

/**
 * resolve a set of image-url producers in parallel and open the carousel
 * immediately with one placeholder slot per resolver — so the user sees
 * the true total image count and a loading spinner per not-yet-loaded
 * slide right away, instead of only learning the count as images trickle
 * in. each slot is then filled in (or marked failed) independently, in
 * place, as its resolver settles — slides never reorder/append, they just
 * transition from "loading" to "loaded" or "failed".
 *
 * closes the carousel (and shows an error toast) only if every resolver
 * ends up failed — i.e. we had candidate images and genuinely could not
 * load any of them. callers should only invoke this once they know
 * there's at least one candidate image (an empty `resolvers` array is
 * treated as "nothing to try" and returns silently, matching the existing
 * no-images-found behavior — that's a normal state, not an error).
 */
export async function openImageCarouselFromResolvers(
  resolvers: Array<() => Promise<ImageResolveResult>>,
  opts: { title?: string; initialIndex?: number; entityLabel?: string } = {}
): Promise<void> {
  if (resolvers.length === 0) return;

  const sessionId = ++carouselSessionCounter;
  setImageCarouselLoading(false);
  showImageCarousel({
    images: resolvers.map(() => ({ url: null, thumbnailUrl: null })),
    initialIndex: opts.initialIndex,
    title: opts.title,
    sessionId,
  });

  const isCurrentSession = () => imageCarouselState()?.sessionId === sessionId;

  const setSlot = (index: number, slot: CarouselSlide) => {
    setImageCarouselState((prev) => {
      if (!prev || prev.sessionId !== sessionId) return prev;
      const images = prev.images.slice();
      images[index] = slot;
      return { ...prev, images };
    });
  };

  let anySucceeded = false;

  await Promise.allSettled(
    resolvers.map(async (resolve, index) => {
      let result: ImageResolveResult;
      try {
        result = await resolve();
      } catch {
        result = null;
      }
      if (result?.url) {
        anySucceeded = true;
        setSlot(index, { url: result.url, thumbnailUrl: result.thumbnailUrl ?? null });
      } else {
        setSlot(index, { url: null, thumbnailUrl: null, failed: true });
      }
    })
  );

  // a slower/newer carousel-open call may have superseded this one while
  // we were resolving (user closed it, or clicked a different trigger) —
  // don't close someone else's carousel or toast about a stale attempt.
  if (!anySucceeded && isCurrentSession()) {
    hideImageCarousel();
    toast.error(
      opts.entityLabel
        ? `couldn't load any images for ${opts.entityLabel}`
        : "couldn't load any images",
      { title: "image carousel" }
    );
  }
}

// tag selector — moved to a domain-neutral home (app/state/tagSelectorState.ts)
// so video (and any future domain) can reuse the same modal/adapter
// machinery; re-exported here since existing callers still import from
// this module.
export {
  showTagSelector,
  hideTagSelector,
  useTagSelectorState,
  type TagSelectorOptions,
} from "../../app/state/tagSelectorState";

// add music modal
const [addMusicOpen, setAddMusicOpen] = createSignal(false);

export function openAddMusic() {
  setAddMusicOpen(true);
}

export function closeAddMusic() {
  setAddMusicOpen(false);
}

export function useAddMusicState() {
  return addMusicOpen;
}

// share modal — global mount, opened from toolbars and context menus.
// kept generic via a `source` accessor so callers can pass either a
// reactive `createCurrentRemoteFull()` or a one-shot snapshot getter.
import type { ShareTarget } from "../../components/share/types";
import type { SendPayload } from "../services/send/sendToRemote";

export interface ShareModalOptions {
  target: ShareTarget;
  /** lazily resolved source remote — null until loaded. */
  source: () => Remote | null | undefined;
  /**
   * lazily build the send-to-remote payload. may be async so context-menu
   * shares can defer the song-list fetch until the modal opens.
   */
  buildSendPayload?: () => SendPayload | Promise<SendPayload>;
  /** override default web mirror host. */
  webHost?: string;
}

const [shareModalState, setShareModalState] = createSignal<ShareModalOptions | null>(null);

export function showShareModal(options: ShareModalOptions) {
  setShareModalState(options);
}

export function hideShareModal() {
  setShareModalState(null);
}

export function useShareModalState() {
  return shareModalState;
}

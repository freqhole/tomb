// modal state helpers for song, artist, and album editors
import { createSignal } from "solid-js";

// modal stack to track which modal is topmost for esc key handling
interface ModalEntry {
  id: string;
  onClose: () => void;
}

const modalStack: ModalEntry[] = [];
let escapeListenerInstalled = false;

function handleGlobalEscape(e: KeyboardEvent) {
  if (e.key === "Escape" && modalStack.length > 0) {
    // immediately pop the modal from the stack before calling onClose
    const topModal = modalStack.pop()!;
    
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
  
  // install global escape listener once
  if (!escapeListenerInstalled) {
    window.addEventListener("keydown", handleGlobalEscape);
    escapeListenerInstalled = true;
  }
}

export function popModal(modalId: string) {
  const index = modalStack.findIndex(m => m.id === modalId);
  if (index !== -1) {
    modalStack.splice(index, 1);
  }
  
  // remove global listener when no modals are open
  if (modalStack.length === 0 && escapeListenerInstalled) {
    window.removeEventListener("keydown", handleGlobalEscape);
    escapeListenerInstalled = false;
  }
}

interface SongEditorOptions {
  songId: string;
  onSave?: () => void;
  disableNestedModals?: boolean;
}

interface ArtistEditorOptions {
  artistId: string;
  onSave?: () => void;
  disableNestedModals?: boolean;
}

interface AlbumEditorOptions {
  albumId: string;
  onSave?: () => void;
  disableNestedModals?: boolean;
  /** called after a successful merge with the target album id, so callers can navigate */
  onMergeNavigate?: (newAlbumId: string) => void;
}

// song editor
const [songEditorState, setSongEditorState] =
  createSignal<SongEditorOptions | null>(null);

export function showSongEditor(options: SongEditorOptions) {
  setSongEditorState(options);
}

export function hideSongEditor() {
  setSongEditorState(null);
}

export function useSongEditorState() {
  return songEditorState;
}

// artist editor
const [artistEditorState, setArtistEditorState] =
  createSignal<ArtistEditorOptions | null>(null);

export function showArtistEditor(options: ArtistEditorOptions) {
  setArtistEditorState(options);
}

export function hideArtistEditor() {
  setArtistEditorState(null);
}

export function useArtistEditorState() {
  return artistEditorState;
}

// album editor
const [albumEditorState, setAlbumEditorState] =
  createSignal<AlbumEditorOptions | null>(null);

export function showAlbumEditor(options: AlbumEditorOptions) {
  setAlbumEditorState(options);
}

export function hideAlbumEditor() {
  setAlbumEditorState(null);
}

export function useAlbumEditorState() {
  return albumEditorState;
}

// image carousel
interface ImageCarouselOptions {
  images: string[];
  initialIndex?: number;
  title?: string;
}

const [imageCarouselState, setImageCarouselState] =
  createSignal<ImageCarouselOptions | null>(null);

export function showImageCarousel(options: ImageCarouselOptions) {
  setImageCarouselState(options);
}

export function hideImageCarousel() {
  setImageCarouselState(null);
}

export function useImageCarouselState() {
  return imageCarouselState;
}

// tag selector
interface TagSelectorOptions {
  albumIds: string[];
  albumTitle?: string;
  onSave?: () => void;
}

const [tagSelectorState, setTagSelectorState] =
  createSignal<TagSelectorOptions | null>(null);

export function showTagSelector(albumIds: string[], albumTitle?: string) {
  setTagSelectorState({ albumIds, albumTitle });
}

export function hideTagSelector() {
  setTagSelectorState(null);
}

export function useTagSelectorState() {
  return tagSelectorState;
}

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
import type { Remote } from "../../app/services/storage/schemas/remote";
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

const [shareModalState, setShareModalState] =
  createSignal<ShareModalOptions | null>(null);

export function showShareModal(options: ShareModalOptions) {
  setShareModalState(options);
}

export function hideShareModal() {
  setShareModalState(null);
}

export function useShareModalState() {
  return shareModalState;
}

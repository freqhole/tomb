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

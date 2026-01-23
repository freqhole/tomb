// modal state helpers for song, artist, and album editors
import { createSignal } from "solid-js";

interface SongEditorOptions {
  songId: string;
  onSave?: () => void;
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

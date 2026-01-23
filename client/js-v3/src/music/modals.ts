// song editor modal state helper
import { createSignal } from "solid-js";

interface SongEditorOptions {
  songId: string;
  onSave?: () => void;
}

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

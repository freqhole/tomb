// global signal for highlighting a song on the album detail view after search navigation.
// backed by history state so it survives back/forward and reload.
import { createSignal } from "solid-js";
import { readHistoryValue, writeHistoryValue } from "../../utils/historyState";

const HISTORY_KEY = "highlightSongId";

// initialize from history state (handles reload / back-forward)
const [highlightedSongId, _setHighlightedSongId] = createSignal<string | null>(
  readHistoryValue<string>(HISTORY_KEY) ?? null
);

/** set the highlighted song id (writes to both signal and history state) */
export function setHighlightedSongId(id: string | null) {
  _setHighlightedSongId(id);
  writeHistoryValue(HISTORY_KEY, id ?? undefined);
}

export { highlightedSongId };

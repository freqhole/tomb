// useDetailPanelHide
//
// shared signal + reset wiring for the graph's per-kind floating
// detail panels (album, artist, …future kinds). returns:
//   - `hidden`   — read accessor; true when user has collapsed the panel
//   - `hide()`   — collapse the panel (e.g. corner chevron-down button)
//   - `restore()` — expand it again (e.g. the "show details" pill)
//
// the `resetTrigger` accessor is read inside a createEffect so that
// whenever the trigger value changes (typically the per-kind selection
// signal), the hidden state is reset to false. this means picking a
// new node of the same kind always re-opens the panel.
//
// kept intentionally tiny — one hook per kind, signals are not
// shared between kinds so collapsing the album panel doesn't affect
// the artist panel.

import { createEffect, createSignal, type Accessor } from "solid-js";

export interface DetailPanelHide {
  hidden: Accessor<boolean>;
  hide: () => void;
  restore: () => void;
}

export function useDetailPanelHide(resetTrigger: Accessor<unknown>): DetailPanelHide {
  const [hidden, setHidden] = createSignal(false);
  createEffect(() => {
    resetTrigger();
    setHidden(false);
  });
  return {
    hidden,
    hide: () => setHidden(true),
    restore: () => setHidden(false),
  };
}

// global station selector state — opens the AddToStationModal from anywhere

import { createSignal } from "solid-js";

// what the caller wants to add to the station
export type StationSelectorTarget =
  | { kind: "songs"; songIds: string[] }
  | { kind: "artist"; artistName: string }
  | { kind: "album"; albumTitle: string }
  | { kind: "genre"; genreName: string };

interface StationSelectorState {
  isOpen: boolean;
  target: StationSelectorTarget | null;
  resolve: (() => void) | null;
}

const defaultState: StationSelectorState = {
  isOpen: false,
  target: null,
  resolve: null,
};

const [stationSelectorState, setStationSelectorState] =
  createSignal<StationSelectorState>(defaultState);

export { stationSelectorState };

/**
 * open the station selector modal. returns a promise that resolves when
 * the modal is closed (regardless of whether the user picked a station or
 * cancelled).
 */
export function showStationSelector(target: StationSelectorTarget): Promise<void> {
  return new Promise((resolve) => {
    setStationSelectorState({ isOpen: true, target, resolve });
  });
}

export function closeStationSelector(): void {
  const state = stationSelectorState();
  if (state.resolve) state.resolve();
  setStationSelectorState(defaultState);
}

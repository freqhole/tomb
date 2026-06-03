// global remote-picker dialog state.
//
// imperative entry point: `await pickRemote([...remotes])` resolves with the
// chosen remote (or null if the user cancels). pattern mirrors
// `confirmState.ts`. the rendering modal is mounted once in App.tsx via
// `RemotePickerModal` and subscribes to `remotePickerState`.

import { createSignal } from "solid-js";
import type { Remote } from "./storage/schemas/remote";

interface PickerState {
  isOpen: boolean;
  remotes: Remote[];
  title?: string;
  message?: string;
  resolve: ((value: Remote | null) => void) | null;
}

const defaultState: PickerState = {
  isOpen: false,
  remotes: [],
  resolve: null,
};

const [remotePickerState, setRemotePickerState] = createSignal<PickerState>(defaultState);

export interface PickRemoteOptions {
  title?: string;
  message?: string;
}

export function pickRemote(
  remotes: Remote[],
  options: PickRemoteOptions = {}
): Promise<Remote | null> {
  // short-circuit on zero/one remote — no picker needed
  if (remotes.length === 0) return Promise.resolve(null);
  if (remotes.length === 1) return Promise.resolve(remotes[0]);

  return new Promise((resolve) => {
    setRemotePickerState({
      isOpen: true,
      remotes,
      title: options.title,
      message: options.message,
      resolve,
    });
  });
}

export function resolveRemotePicker(remote: Remote | null): void {
  const state = remotePickerState();
  if (state.resolve) state.resolve(remote);
  setRemotePickerState(defaultState);
}

export function closeRemotePicker(): void {
  resolveRemotePicker(null);
}

export { remotePickerState };

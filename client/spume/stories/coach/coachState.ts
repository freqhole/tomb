// scroll-coach demo — runtime state + step controller
//
// the CoachContext is the imperative surface the script.ts steps drive.
// SuperStory (or its coach wrapper) wires real signals into this context
// when it mounts, so the script doesn't import any solid internals.
//
// also exposes a global window.__FREQHOLE_DEMO__ for the astro host + tests.

import { createSignal } from "solid-js";
import { coachStepCount, coachSteps, type CoachStep } from "./script";

export type DemoLibraryMode = "empty" | "populated";
export type DemoRoute =
  | "songs"
  | "albums"
  | "artists"
  | "genres"
  | "playlists"
  | "favorites"
  | "feed"
  | "radio"
  | "remotes"
  | "album-detail"
  | "shares";
export type DemoModalName =
  | "add-music"
  | "add-remote"
  | "share"
  | "settings"
  | "album-edit"
  | "resolve-share";

export interface CoachContext {
  setLibraryMode: (mode: DemoLibraryMode) => void;
  setRoute: (route: DemoRoute) => void;
  setQueueOpen: (open: boolean) => void;
  openModal: (name: DemoModalName) => void;
  closeModal: (name: DemoModalName) => void;
  closeAllModals: () => void;
  openSearch: (query?: string) => void;
  closeSearch: () => void;
  /** seed (or clear) the now-playing song + a sample queue. used by the
   *  queue step so the playerbar appears with content rather than empty. */
  seedNowPlaying: (enabled: boolean) => void;
  /** animate a fake scan progress bar inside the open add-music modal */
  runFakeScan: (opts: { durationMs: number; flipToPopulated?: boolean }) => Promise<void>;
}

// step index is module-global so window.__FREQHOLE_DEMO__ + the host can both
// drive it without prop-drilling.
const [currentStep, setCurrentStepInternal] = createSignal(0);
export { currentStep };

let activeContext: CoachContext | null = null;

/**
 * the SuperStory wrapper calls this on mount to register its mutators.
 * subsequent goToStep() calls run the step's apply() against this context.
 */
export function registerCoachContext(ctx: CoachContext) {
  activeContext = ctx;
  // re-apply current step so freshly-mounted story matches state
  void runStep(currentStep());
}

export function unregisterCoachContext() {
  activeContext = null;
}

async function runStep(idx: number) {
  if (!activeContext) return;
  const step: CoachStep | undefined = coachSteps[idx];
  if (!step) return;
  try {
    await step.apply(activeContext);
  } catch (e) {
    console.warn("[coach] step failed:", step.id, e);
  }
}

export async function goToStep(idx: number) {
  const clamped = Math.max(0, Math.min(coachStepCount - 1, idx | 0));
  setCurrentStepInternal(clamped);
  await runStep(clamped);
}

export const next = () => goToStep(currentStep() + 1);
export const prev = () => goToStep(currentStep() - 1);
export const reset = () => goToStep(0);

// expose to host page + playwright. lazy: only attach in browser.
if (typeof window !== "undefined") {
  (window as any).__FREQHOLE_DEMO__ = {
    goToStep,
    next,
    prev,
    reset,
    get currentStep() {
      return currentStep();
    },
    steps: coachSteps.map((s) => ({
      id: s.id,
      title: s.title,
      body: s.body,
      anchor: s.anchor,
    })),
  };
}

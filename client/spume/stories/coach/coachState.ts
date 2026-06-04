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
  | "library"
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

  // --- scroll-driven animation hooks (used by step.onProgress) ---
  /** drive the fake scan progress bar directly. p in 0..1. */
  setScanProgress?: (p: number) => void;
  /** spotlight one coach-anchor: dim everything else by `intensity` (0..1).
   *  pass `null` to clear. used by focus-on-button steps. */
  setSpotlight?: (anchor: string | null, intensity?: number) => void;
  /** scroll the element whose `data-coach-anchor` matches `anchor` to
   *  fraction `p` (0..1) of its scrollable height. when the element itself
   *  isn't scrollable, walks descendants for one that is. */
  setListProgress?: (anchor: string, p: number) => void;
  /** set the displayed search query (drives the fake flyout). useful for
   *  char-by-char typing animations. */
  setSearchQuery?: (text: string) => void;
  /** click the Nth selectable item inside an anchor. used to cycle through
   *  the master list of a master-detail view (artists / playlists). */
  setSelectedListItem?: (anchor: string, idx: number) => void;
  // type a value into an input by anchor (story-only — pokes the DOM
  // input's value via the native value setter so it shows char-by-char).
  setInputValue?: (anchor: string, text: string) => void;
  // drive the story-only "knock flow" modal phase.
  // phases: "id-form" | "loading" | "request-form" | "pending" | "approved"
  setKnockPhase?: (phase: string) => void;
  // story-only: switch the queue sidebar's tab to "queue" or "history" by
  // clicking the actual button (the spume QueueSidebar owns its own state).
  setQueueTab?: (tab: "queue" | "history") => void;
  // story-only: open or close the topnav navigation menu (kobalte popover)
  // by simulating a click on the trigger when the desired state differs
  // from the current aria-expanded state.
  setTopNavMenuOpen?: (open: boolean) => void;
  // story-only: drive the library graph walker through a scripted path
  // (local -> genres -> electronic -> pan sonic) as `p` goes 0..1.
  // also opens the matching detail popover at the final step.
  walkLibraryGraph?: (p: number) => void;
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
    // default: close the topnav menu so each step starts from a known
    // baseline. steps that want it open re-open it inside their apply().
    activeContext.setTopNavMenuOpen?.(false);
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

/**
 * scroll-driven sub-progress within a slide. `p` is 0..1.
 * called by the host page on every scroll tick. routes to the active
 * step's onProgress hook.
 */
export function setStepProgress(idx: number, p: number) {
  if (!activeContext) return;
  const step = coachSteps[idx];
  if (!step?.onProgress) return;
  const clamped = Math.max(0, Math.min(1, p));
  try {
    step.onProgress(activeContext, clamped);
  } catch (e) {
    console.warn("[coach] onProgress failed:", step.id, e);
  }
}

export const next = () => goToStep(currentStep() + 1);
export const prev = () => goToStep(currentStep() - 1);
export const reset = () => goToStep(0);

// expose to host page + playwright. lazy: only attach in browser.
if (typeof window !== "undefined") {
  (window as any).__FREQHOLE_DEMO__ = {
    goToStep,
    setStepProgress,
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

// scroll-coach demo — storybook story (development surface)
//
// renders the SuperStory body + CoachOverlay together so we can iterate on
// step copy + tooltip placements before the standalone build runs.
//
// SuperStory's onMount registers a real CoachContext (route + queue +
// runFakeScan); the unused `stubContext` below is kept for reference / for
// the standalone "headless" preview.

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CoachOverlay } from "./CoachOverlay";
import { FullAppDemoBody } from "../SuperStory.stories";
import type { CoachContext } from "./coachState";

const meta = {
  title: "Coach Demo",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// reference logging-only context. SuperStory now registers its own real
// context on mount, so this isn't used by ScrollCoachLive — kept for the
// HeadlessOverlay story below.
const stubContext: CoachContext = {
  setLibraryMode: (m) => console.log("[coach] library:", m),
  setRoute: (r) => console.log("[coach] route:", r),
  setQueueOpen: (o) => console.log("[coach] queue:", o),
  openModal: (n) => console.log("[coach] open modal:", n),
  closeModal: (n) => console.log("[coach] close modal:", n),
  closeAllModals: () => console.log("[coach] close all modals"),
  openSearch: () => console.log("[coach] open search"),
  closeSearch: () => console.log("[coach] close search"),
  seedNowPlaying: (enabled) => console.log("[coach] seed now playing:", enabled),
  runFakeScan: ({ durationMs }) =>
    new Promise((resolve) => {
      console.log("[coach] fake scan start", durationMs);
      setTimeout(() => {
        console.log("[coach] fake scan done");
        resolve();
      }, durationMs);
    }),
};
void stubContext;

/** primary dev surface — full app + overlay, controllable via prev/next. */
export const ScrollCoachLive: Story = {
  render: () => (
    <div class="relative h-screen w-full overflow-hidden">
      <FullAppDemoBody />
      <CoachOverlay showControls={true} showDots={true} />
    </div>
  ),
};

/** overlay-only preview against an empty stage. */
export const HeadlessOverlay: Story = {
  render: () => (
    <div class="h-screen w-full bg-[var(--color-bg-primary,#0a0a0a)] text-[var(--color-text-primary,#fff)] flex items-center justify-center">
      <div class="text-center max-w-md p-6">
        <h1 class="text-2xl font-bold mb-2">overlay-only stub</h1>
        <p class="text-sm opacity-60">
          no SuperStory mounted — anchors won't resolve. tooltip will fall back to centered "stage"
          position.
        </p>
      </div>
      <CoachOverlay showControls={true} showDots={true} />
    </div>
  ),
};

# scroll-coach demo

scaffolding for the scroll-driven step-through demo. see
[../../docs/scroll-coach-demo-plan.md](../../../../docs/scroll-coach-demo-plan.md)
for the full plan.

## files

| file                     | purpose                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `script.ts`              | declarative step list + tooltip copy. owned by the story.                                                      |
| `coachState.ts`          | runtime: `currentStep` signal, `goToStep`/`next`/`prev`, `CoachContext` interface, `window.__FREQHOLE_DEMO__`. |
| `anchors.ts`             | central registry of `data-coach-anchor` IDs.                                                                   |
| `CoachOverlay.tsx`       | tooltip + progress dots overlay. positions itself off `[data-coach-anchor]` rects.                             |
| `CoachStory.stories.tsx` | dev surface — `ScrollCoachLive` mounts SuperStory + overlay; `HeadlessOverlay` is the empty-stage variant.     |
| `standalone.tsx`         | entry for the standalone build (single-page html + `<freqhole-coach-demo>` web component).                     |
| `index.html`             | input for the html-mode build (`npm run build:coach:html`).                                                    |

## related (outside this folder)

- [`../SuperStory.stories.tsx`](../SuperStory.stories.tsx) — exports
  `FullAppDemoBody`, registers a real `CoachContext` on mount, has
  `data-coach-anchor` attrs on songs/albums/favorites/feed/radio/queue/topnav.
- [`../mockData.ts`](../mockData.ts) — exports `demoLibraryMode` signal,
  `setDemoLibraryMode`, `runFakeLibraryScan({ durationMs, onProgress })`.
- [`../../vite.coach-demo.config.ts`](../../vite.coach-demo.config.ts) — build
  profile with `wc` and `html` modes.
- [`../../../freqhole.net/src/components/ScrollCoach.astro`](../../../../freqhole.net/src/components/ScrollCoach.astro)
  — astro host with sticky stage + scroll/touch handler.
- [`../../../freqhole.net/src/content/docs/demo.mdx`](../../../../freqhole.net/src/content/docs/demo.mdx)
  — page using `<ScrollCoach />`.

## scripts

```sh
# storybook dev surface
cd client/spume && npm run storybook
# then open "Coach Demo / Scroll Coach Live"

# standalone html preview (vite dev server)
npm run dev:coach

# build the web-component artifact (-> dist-coach-demo/freqhole-coach-demo.js)
npm run build:coach:wc

# build the standalone html (-> dist-coach-demo-html/)
npm run build:coach:html
```

## what's missing (next work)

1. SuperStory's derived signals don't yet read `demoLibraryMode()` — add
   conditional empty-state rendering so the welcome step actually looks empty.
2. add a fake-scan affordance (modal or button on the empty state) that calls
   `runFakeLibraryScan()` so the populated library reveal feels diegetic.
3. additional `data-coach-anchor` attrs for the artists / playlists views
   (skipped because they're inside `ResponsiveMasterDetail`).
4. copy the built `freqhole-coach-demo.js` into `freqhole.net/public/demo/`
   (manual or via a make target).
5. polish: reduced-motion fallback, longer scroll runway calibration,
   playwright smoke test for the step transitions.

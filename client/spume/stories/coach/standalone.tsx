// scroll-coach demo — standalone entry
//
// entry point for the standalone build (single-page html + web component
// artifacts) consumed by freqhole.net's <ScrollCoach /> astro component.
//
// behavior:
//   1. mounts <FullAppDemoBody /> (extracted from SuperStory.stories.tsx)
//   2. mounts <CoachOverlay /> on top
//   3. SuperStory's onMount registers a real CoachContext, so
//      window.__FREQHOLE_DEMO__ (attached by coachState) is fully wired.
//   4. host (astro) calls __FREQHOLE_DEMO__.goToStep(idx) on scroll/swipe.
//
// build profiles: client/spume/vite.coach-demo.config.ts

import { render } from "solid-js/web";
import { CoachOverlay } from "./CoachOverlay";
import { FullAppDemoBody } from "../SuperStory.stories";
// side-effect import: attaches window.__FREQHOLE_DEMO__
import "./coachState";
// tailwind / design tokens — imported as a string and injected into the
// shadow root of the web component so it does NOT leak into the host page.
import demoStylesheet from "../../src/design-system/theme.css?inline";

// host overlays should NOT show prev/next buttons when the astro page drives
// via scroll. keep dots for mobile feedback.
//
// the wrapper sets `transform: translateZ(0)` (and `contain: layout paint`)
// to establish a containing block for `position: fixed` descendants —
// PlayerBar and QueueSidebar (overlay variant) use `fixed` and would
// otherwise escape the demo frame and overlay the host page.
function StandaloneRoot(props: { root?: ShadowRoot | HTMLElement | Document }) {
  return (
    <div
      class="relative h-full w-full overflow-hidden"
      style={{
        transform: "translateZ(0)",
        contain: "layout paint",
      }}
    >
      <FullAppDemoBody />
      <CoachOverlay root={props.root} showControls={false} showDots={false} showTooltip={false} />
    </div>
  );
}

// --- single-page html entry (auto-mount on #root) ------------------------
// note: the html-mode build still uses ./index.html which loads CSS via
// <link>; for the wc build the CSS is embedded into the shadow root below.
if (typeof document !== "undefined") {
  const root = document.getElementById("root");
  if (root) {
    // for the html preview, also inject the styles inline so it works
    // standalone without a separate .css file.
    const style = document.createElement("style");
    style.textContent = demoStylesheet;
    document.head.appendChild(style);
    render(() => <StandaloneRoot />, root);
  }
}
// the bundle auto-registers <freqhole-coach-demo> on load. uses Shadow DOM
// so the demo's tailwind preflight does NOT clobber the host page's styles
// (e.g. starlight in freqhole.net).
export function defineFreqholeCoachDemoElement(tagName = "freqhole-coach-demo") {
  if (typeof customElements === "undefined") return;
  if (customElements.get(tagName)) return;
  class FreqholeCoachDemo extends HTMLElement {
    connectedCallback() {
      const shadow = this.attachShadow({ mode: "open" });
      // inject scoped styles into the shadow root
      const style = document.createElement("style");
      style.textContent = demoStylesheet;
      shadow.appendChild(style);
      // mount point inside shadow
      const mount = document.createElement("div");
      mount.style.width = "100%";
      mount.style.height = "100%";
      shadow.appendChild(mount);
      render(() => <StandaloneRoot root={shadow} />, mount);
    }
  }
  customElements.define(tagName, FreqholeCoachDemo);
}

// auto-register when bundled. idempotent.
if (typeof customElements !== "undefined") {
  defineFreqholeCoachDemoElement();
}

// "open in app" button — fires the freqhole:// deep link.
//
// behaviour:
//   1. set window.location.href to the app url. if a handler is registered
//      the os opens it; if not, nothing visible happens (or the os shows
//      a dialog).
//   2. start a 1.2s timer + watch `document.visibilityState`. if the page
//      ever flipped to hidden during that window, the os almost certainly
//      handed off to the app — suppress any "didn't open?" hint.
//   3. otherwise show an inline note suggesting the app install.
//
// step 17 of SEND_TO_REMOTE_PLAN expands this with the full deep-link plumbing
// and inline cta variants. for now this is the minimal user-visible affordance.

import { createSignal, onCleanup, Show, type Component } from "solid-js";
import { buildShareUrls } from "../../utils/permalink";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { buildSharePayload } from "./buildSharePayload";
import type { ShareTarget } from "./types";

const VISIBILITY_GRACE_MS = 1200;

export interface OpenInAppButtonProps {
  target: ShareTarget;
  source: Remote;
}

export const OpenInAppButton: Component<OpenInAppButtonProps> = (props) => {
  const [showHint, setShowHint] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let didHide = false;

  const onVisibility = () => {
    if (document.visibilityState === "hidden") didHide = true;
  };

  onCleanup(() => {
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibility);
  });

  const handleClick = () => {
    setShowHint(false);
    didHide = false;
    let appUrl: string;
    try {
      const payload = buildSharePayload(props.target, props.source);
      appUrl = buildShareUrls(payload).appUrl;
    } catch {
      // can't build a link — silently bail; the permalink section already
      // surfaces the same error.
      return;
    }

    document.addEventListener("visibilitychange", onVisibility);
    // navigate to the custom scheme. browsers either hand off or no-op.
    window.location.href = appUrl;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      // if the page never lost visibility, the handoff probably didn't happen.
      if (!didHide) setShowHint(true);
    }, VISIBILITY_GRACE_MS);
  };

  return (
    <div class="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        class="px-3 py-2 text-sm rounded-md bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] transition-colors"
      >
        open in app
      </button>
      <Show when={showHint()}>
        <p class="text-xs text-[var(--color-text-tertiary)]">
          didn't open? install the freqhole desktop app, or copy the link above.
        </p>
      </Show>
    </div>
  );
};

// "open in app" button — fires the freqhole:// deep link.
//
// no detection heuristic: there's no reliable cross-browser way to tell
// whether a custom scheme handler is registered, so we just provide the
// button. if the os has the freqhole desktop app installed and registered,
// it takes over; otherwise nothing visible happens (or the os shows its
// own dialog). the matching web mirror url is always offered as a copy
// button alongside.

import { type Component } from "solid-js";
import { encodeShareToken } from "../../utils/permalink";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { buildSharePayload } from "./buildSharePayload";
import type { ShareTarget } from "./types";

export interface OpenInAppButtonProps {
  target: ShareTarget;
  source: Remote;
}

export const OpenInAppButton: Component<OpenInAppButtonProps> = (props) => {
  const handleClick = () => {
    let appUrl: string;
    try {
      const payload = buildSharePayload(props.target, props.source);
      appUrl = `freqhole://o/${encodeShareToken(payload)}`;
    } catch {
      // can't build a link — silently bail; the permalink section already
      // surfaces the same error.
      return;
    }
    window.location.href = appUrl;
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      class="px-3 py-2 text-sm rounded-md bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] transition-colors"
    >
      open in app
    </button>
  );
};

// share button — toolbar entry point for the share modal.
//
// the modal itself is mounted once globally in App.tsx; this button just
// pushes its (target, source, buildSendPayload) tuple into the global
// share modal hook so any toolbar / context menu can open the same modal.

import { type Component } from "solid-js";
import { Icon } from "../icons/registry";
import { showShareModal } from "../../music/hooks/modals";
import type { ShareTarget } from "../share/types";
import type { Remote } from "../../app/services/storage/schemas/remote";
import type { SendPayload } from "../../music/services/send/sendToRemote";

export interface ShareButtonProps {
  target: ShareTarget;
  /** lazily evaluated source remote. */
  source: () => Remote | null | undefined;
  /** lazily build the send-to-remote payload (album/playlist scope). */
  buildSendPayload?: () => SendPayload;
  /** trigger button class override. */
  class?: string;
  /** override the default web mirror host. */
  webHost?: string;
}

export const ShareButton: Component<ShareButtonProps> = (props) => {
  return (
    <button
      type="button"
      aria-label="share"
      title="share"
      onClick={() =>
        showShareModal({
          target: props.target,
          source: props.source,
          buildSendPayload: props.buildSendPayload,
          webHost: props.webHost,
        })
      }
      class={
        props.class ??
        "p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
      }
    >
      <Icon name="share" size={18} />
    </button>
  );
};

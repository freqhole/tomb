// share button — toolbar entry point for the share modal.
//
// owns the modal's open/close state. zero gating logic at this layer; the
// modal itself decides which sections to render based on `(target, source)`.

import { createSignal, type Component } from "solid-js";
import { Icon } from "../icons/registry";
import { ShareModal } from "../modals/ShareModal";
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
  const [open, setOpen] = createSignal(false);

  return (
    <>
      <button
        type="button"
        aria-label="share"
        title="share"
        onClick={() => setOpen(true)}
        class={
          props.class ??
          "p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
        }
      >
        <Icon name="share" size={18} />
      </button>
      <ShareModal
        isOpen={open()}
        onClose={() => setOpen(false)}
        target={props.target}
        source={props.source()}
        buildSendPayload={props.buildSendPayload}
        webHost={props.webHost}
      />
    </>
  );
};

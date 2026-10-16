// share modal — single entry point for everything sharing-related.
//
// composes two child sections:
//   - <PermalinkSection /> — renders the https://spume.freqhole.net share url
//     with a copy button, picking (and letting the user re-pick, when more
//     than one option exists) whichever remote's node id is actually safe
//     to embed - see permalinkCandidates.ts's doc comment for the full
//     local-library-reachability + other-remotes-with-the-content
//     reasoning. renders nothing at all once that resolves to zero options.
//   - <SendToRemoteSection /> — hidden when no eligible destinations or source
//     is not p2p.
//
// matches the visual language of TagSelectorModal / AddMusicModal via the
// shared `Modal` shell.

import { Show, type Component } from "solid-js";
import { Modal } from "./Modal";
import { PermalinkSection } from "../share/PermalinkSection";
import { SendToRemoteSection } from "../share/SendToRemoteSection";
import type { ShareTarget } from "../share/types";
import type { Remote } from "../../app/services/storage/schemas/remote";
import type { SendToRemotePayload } from "../share/SendToRemoteSection";

export interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: ShareTarget;
  /** the source remote — null until it resolves; modal stays gated until then. */
  source: Remote | null | undefined;
  /**
   * lazily build the send-to-remote payload. may return a promise so
   * context-menu shares can defer fetching the song list until the
   * modal opens. omit entirely for share targets that don't support
   * send-to (e.g. artists) — the section will hide, and PermalinkSection
   * falls back to its simpler source-only behavior (see
   * permalinkCandidates.ts).
   */
  buildSendPayload?: () => SendToRemotePayload | Promise<SendToRemotePayload>;
  /** override the default web mirror host. */
  webHost?: string;
}

export const ShareModal: Component<ShareModalProps> = (props) => {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      disableBackdropClose
      title={`share ${props.target.kind}${
        props.target.displayTitle ? ` "${props.target.displayTitle}"` : ""
      }`}
      size="md"
    >
      <div class="p-4 space-y-6 overflow-y-auto">
        <Show
          when={props.source}
          fallback={
            <p class="text-sm text-[var(--color-text-tertiary)]">source remote unavailable.</p>
          }
        >
          {(src) => (
            <>
              <PermalinkSection
                target={props.target}
                source={src()}
                buildSendPayload={props.buildSendPayload}
                webHost={props.webHost}
              />
              <Show when={props.buildSendPayload}>
                <div class="border-t border-[var(--color-border-default)] pt-6">
                  <SendToRemoteSection source={src()} buildPayload={props.buildSendPayload!} />
                </div>
              </Show>
            </>
          )}
        </Show>
      </div>
    </Modal>
  );
};

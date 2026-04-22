// share modal — single entry point for everything sharing-related.
//
// composes three child sections, any of which can render nothing if not
// applicable to the current `(target, source)` pair:
//   - <SendToRemoteSection /> — hidden when no eligible destinations
//     OR source is not p2p. for now buildPayload is required (album/playlist
//     scope); song/artist share will pass `undefined` and the section will
//     hide itself once those payload kinds land.
//   - <PermalinkSection /> — always shown when source has either a node id
//     or http origin (otherwise it surfaces a friendly error).
//   - <OpenInAppButton /> — always shown next to permalink. fires the
//     freqhole:// deep link.
//
// matches the visual language of TagSelectorModal / AddMusicModal via the
// shared `Modal` shell.

import { Show, type Component } from "solid-js";
import { Modal } from "./Modal";
import { PermalinkSection } from "../share/PermalinkSection";
import { SendToRemoteSection } from "../share/SendToRemoteSection";
import { OpenInAppButton } from "../share/OpenInAppButton";
import type { ShareTarget } from "../share/types";
import type { Remote } from "../../app/services/storage/schemas/remote";
import type { SendPayload } from "../../music/services/send/sendToRemote";

export interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: ShareTarget;
  /** the source remote — null until it resolves; modal stays gated until then. */
  source: Remote | null | undefined;
  /**
   * lazily build the send-to-remote payload. omit for share targets that
   * don't yet support send-to (song/artist) — the section will hide.
   */
  buildSendPayload?: () => SendPayload;
  /** override the default web mirror host. */
  webHost?: string;
}

export const ShareModal: Component<ShareModalProps> = (props) => {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
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
              <PermalinkSection target={props.target} source={src()} webHost={props.webHost} />
              <OpenInAppButton target={props.target} source={src()} />
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

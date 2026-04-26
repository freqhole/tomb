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

import { createMemo, Show, type Component } from "solid-js";
import { Modal } from "./Modal";
import { PermalinkSection } from "../share/PermalinkSection";
import { SendToRemoteSection } from "../share/SendToRemoteSection";
import { OpenInAppButton } from "../share/OpenInAppButton";
import { isCharnelMode } from "../../app/services/charnel";
import type { ShareTarget } from "../share/types";
import type { Remote } from "../../app/services/storage/schemas/remote";
import type { SendPayload } from "../../music/services/send/sendToRemote";
import { buildSharePayload } from "../share/buildSharePayload";
import { startSharedRadioStation } from "../share/startSharedRadioStation";
import Button from "../buttons/Button";
import { Icon } from "../icons/registry";

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
   * send-to (e.g. artists) — the section will hide.
   */
  buildSendPayload?: () => SendPayload | Promise<SendPayload>;
  /** override the default web mirror host. */
  webHost?: string;
}

export const ShareModal: Component<ShareModalProps> = (props) => {
  const playableRadioShare = createMemo(() => {
    if (props.target.kind !== "radio_station") return null;
    if (!props.source) return null;

    try {
      const payload = buildSharePayload(props.target, props.source);
      if (!payload.s.n) return null;
      return {
        nodeId: payload.s.n,
        stationId: props.target.id,
        stationName: props.target.displayTitle,
      };
    } catch {
      return null;
    }
  });

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
              <Show when={playableRadioShare()}>
                {(radio) => (
                  <div class="flex justify-end gap-6">
                    {/* <Button
                      variant="primary"
                      onClick={() => {
                        void startSharedRadioStation(radio()).finally(() => props.onClose());
                      }}
                    >
                      <Icon name="radioTower" size={24} />
                      play radio station
                    </Button> */}
                    <Show when={!isCharnelMode()}>
                      <OpenInAppButton target={props.target} source={src()} />
                    </Show>
                  </div>
                )}
              </Show>

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

// phase 6: pick the active playback target - this device, or a paired
// freqhole-player. picking a player automatically pushes the current
// queue to it (spotify-connect-style "transfer playback"), picking
// "this device" hands playback back to local.
import { createResource, For, Show } from "solid-js";
import { listPairedPlayers } from "../../app/services/players/pairedPlayers";
import {
  activeTarget,
  setActiveTargetToLocal,
  setActiveTargetToPlayer,
} from "../../app/services/players/activeTarget";
import { pushSongsToPlayer } from "../../app/services/players/playerQueuePush";
import { appState } from "../../app/services/storage/db";
import { songsOnly } from "../../app/services/storage/mediaItem";
import { toast } from "../feedback/Toast";
import { Button } from "../buttons/Button";

export interface TargetSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** songs from the current queue, starting at whatever's currently playing
 * (falls back to the whole queue if nothing's marked current). */
function songsToHandOff(): ReturnType<typeof songsOnly> {
  const state = appState();
  if (!state) return [];
  const songs = songsOnly(state.queue);
  const idx = songs.findIndex((s) => s.sha256 === state.current_sha256);
  return idx >= 0 ? songs.slice(idx) : songs;
}

export function TargetSwitcherModal(props: TargetSwitcherModalProps) {
  const [players, { refetch }] = createResource(listPairedPlayers);

  const isActivePlayer = (nodeId: string) => {
    const t = activeTarget();
    return t.kind === "player" && t.node_id === nodeId;
  };

  const switchToLocal = () => {
    setActiveTargetToLocal();
    props.onClose();
  };

  const switchToPlayer = async (player: { node_id: string; display_name: string }) => {
    const songs = songsToHandOff();
    setActiveTargetToPlayer(player);
    props.onClose();
    if (songs.length === 0) {
      toast.error("nothing in the queue to hand off yet");
      return;
    }
    try {
      await pushSongsToPlayer(player.node_id, songs);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "failed to send queue to player");
    }
  };

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        data-testid="target-switcher-modal"
      >
        <div class="w-full max-w-sm bg-neutral-900 rounded-lg p-4 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">play on</h2>
            <button type="button" class="text-xs text-neutral-400" onClick={() => props.onClose()}>
              close
            </button>
          </div>

          <button
            type="button"
            class="flex items-center justify-between text-sm bg-neutral-800 rounded px-3 py-2"
            onClick={switchToLocal}
            data-testid="target-switcher-local"
          >
            <span>this device</span>
            <Show when={activeTarget().kind === "local"}>
              <span class="text-xs text-neutral-500">active</span>
            </Show>
          </button>

          <div class="flex flex-col gap-1" data-testid="target-switcher-players">
            <For each={players() ?? []}>
              {(player) => (
                <button
                  type="button"
                  class="flex items-center justify-between text-sm bg-neutral-800 rounded px-3 py-2"
                  onClick={() => void switchToPlayer(player)}
                  data-testid="target-switcher-player-row"
                >
                  <span class="truncate">{player.display_name}</span>
                  <Show when={isActivePlayer(player.node_id)}>
                    <span class="text-xs text-neutral-500">active</span>
                  </Show>
                </button>
              )}
            </For>
            <Show when={players()?.length === 0}>
              <p class="text-xs text-neutral-500 px-1">no paired players yet</p>
            </Show>
          </div>

          <Button variant="ghost" size="sm" onClick={() => void refetch()}>
            refresh
          </Button>
        </div>
      </div>
    </Show>
  );
}

// "play on" flyout - lives in QueueSidebar's footer (see PlayerBar.tsx's
// activeTargetIsRemote-driven queue icon for the at-a-glance indicator
// that replaced the old standalone button there). kept as its own small
// component (rather than inlined into the already-large QueueSidebar.tsx).
//
// a single trigger button always opens a click-flyout listing "this
// device" + every paired player (ClickDropdownMenu, position:fixed so it
// never clips inside the sidebar's scroll container) - no inline-pills/
// modal split by player count, since that added an extra component +
// counting threshold for no real benefit.
import { createResource, createSignal, Show } from "solid-js";
import { pairedPlayersVersion, listPairedPlayers } from "../../app/services/players/pairedPlayers";
import { activeTarget } from "../../app/services/players/activeTarget";
import {
  selectLocalPlaybackTarget,
  selectPlayerPlaybackTarget,
} from "../../app/services/players/selectPlaybackTarget";
import {
  remoteStatusKnown,
  remoteCommandPending,
} from "../../app/services/players/remotePlaybackControl";
import {
  queryPlayerPresence,
  type PlayerPresence,
} from "../../app/services/players/playerPairingClient";
import { Icon } from "../icons/registry";
import { ClickDropdownMenu, type MenuAction } from "../overlays/ContextMenu";
import { CometBorderRing } from "../feedback";

export function QueuePlayerTargetRow() {
  const [pairedPlayers] = createResource(pairedPlayersVersion, listPairedPlayers);

  // step 6 (docs/player-peer-trust-bridge-plan.md): on-demand presence per
  // paired player, queried fresh each time the flyout opens (via
  // ClickDropdownMenu's onOpen) rather than kept continuously live -
  // there's no shutdown()/close() binding yet for a background poll to
  // reliably tear down, so "query when the picker is actually opened" is
  // the simplest correct behavior. keyed by node_id; undefined means
  // "not queried yet this time" (shown as neither online nor offline).
  const [presence, setPresence] = createSignal<Record<string, PlayerPresence>>({});

  const refreshPresence = () => {
    for (const player of pairedPlayers() ?? []) {
      void queryPlayerPresence(player.node_id).then((state) => {
        setPresence((prev) => ({ ...prev, [player.node_id]: state }));
      });
    }
  };

  const isActivePlayer = (nodeId: string) => {
    const t = activeTarget();
    return t.kind === "player" && t.node_id === nodeId;
  };

  const currentLabel = () => {
    const t = activeTarget();
    return t.kind === "player" ? t.username : "this device";
  };

  // true while we've picked a player but haven't heard its queue/status
  // yet - the "connecting" comet-trail ring below mirrors the playerbar's
  // own loading ring so the button doesn't just look inert while waiting.
  // also lit up by remoteCommandPending() - queue add/reorder/remove all
  // round-trip to the player before the queue view reflects them (queue
  // adds in particular can take a while: blob import + artwork resize
  // happen before the command is even sent, see playerQueuePush.ts).
  const isConnecting = () => activeTarget().kind === "player" && !remoteStatusKnown();
  const showSyncRing = () => isConnecting() || remoteCommandPending();

  const actions = (): MenuAction[] => [
    {
      label: "this device",
      icon: activeTarget().kind === "local" ? "check" : undefined,
      onClick: () => selectLocalPlaybackTarget(),
    },
    ...(pairedPlayers() ?? []).map((player): MenuAction => {
      const state = presence()[player.node_id];
      const label = state === "stopped" ? `${player.username} (offline)` : player.username;
      return {
        label,
        icon: isActivePlayer(player.node_id) ? "check" : "remotePlayer",
        onClick: () => void selectPlayerPlaybackTarget(player),
      };
    }),
  ];

  return (
    <Show when={(pairedPlayers()?.length ?? 0) > 0}>
      <div class="flex justify-end px-3 py-2">
        <CometBorderRing active={showSyncRing()}>
          <ClickDropdownMenu
            trigger={
              <button
                type="button"
                class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-500)]/20 transition-colors focus:outline-none border"
                data-testid="queue-target-picker"
              >
                <span class="truncate max-w-[10rem]">{currentLabel()}</span>
                <Icon name="remotePlayer" size={16} />
              </button>
            }
            actions={actions()}
            onOpen={refreshPresence}
          />
        </CometBorderRing>
      </div>
    </Show>
  );
}

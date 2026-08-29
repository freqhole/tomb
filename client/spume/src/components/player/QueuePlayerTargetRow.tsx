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
import { createResource, Show } from "solid-js";
import { pairedPlayersVersion, listPairedPlayers } from "../../app/services/players/pairedPlayers";
import { activeTarget } from "../../app/services/players/activeTarget";
import {
  selectLocalPlaybackTarget,
  selectPlayerPlaybackTarget,
} from "../../app/services/players/selectPlaybackTarget";
import { Icon } from "../icons/registry";
import { ClickDropdownMenu, type MenuAction } from "../overlays/ContextMenu";

export function QueuePlayerTargetRow() {
  const [pairedPlayers] = createResource(pairedPlayersVersion, listPairedPlayers);

  const isActivePlayer = (nodeId: string) => {
    const t = activeTarget();
    return t.kind === "player" && t.node_id === nodeId;
  };

  const currentLabel = () => {
    const t = activeTarget();
    return t.kind === "player" ? t.display_name : "this device";
  };

  const actions = (): MenuAction[] => [
    {
      label: "this device",
      icon: activeTarget().kind === "local" ? "check" : undefined,
      onClick: () => selectLocalPlaybackTarget(),
    },
    ...(pairedPlayers() ?? []).map((player): MenuAction => ({
      label: player.display_name,
      icon: isActivePlayer(player.node_id) ? "check" : "remotePlayer",
      onClick: () => void selectPlayerPlaybackTarget(player),
    })),
  ];

  return (
    <Show when={(pairedPlayers()?.length ?? 0) > 0}>
      <div class="flex justify-end px-3 py-2">
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
        />
      </div>
    </Show>
  );
}

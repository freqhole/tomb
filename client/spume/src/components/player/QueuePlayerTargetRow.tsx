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
import {
  currentPlayersVersion,
  listCurrentPlayers,
} from "../../app/services/players/pairedPlayers";
import { activeTarget } from "../../app/services/players/activeTarget";
import {
  selectLocalPlaybackTarget,
  selectPlayerPlaybackTarget,
} from "../../app/services/players/selectPlaybackTarget";
import {
  remoteStatusKnown,
  remoteCommandPending,
  remoteListOutputDevices,
  remoteSetOutputDevice,
  remoteTargetOffline,
} from "../../app/services/players/remotePlaybackControl";
import { listOutputDevices, setOutputDevice } from "../../music/services/audio/player";
import { isOnline, refreshPlayerStatus } from "../../app/services/remotes/remoteHealth";
import { isMobile } from "../../utils/isMobile";
import { Icon } from "../icons/registry";
import { ClickDropdownMenu, type MenuAction } from "../overlays/ContextMenu";
import { CometBorderRing } from "../feedback";

export function QueuePlayerTargetRow() {
  const [pairedPlayers] = createResource(currentPlayersVersion, listCurrentPlayers);

  // shared reactive online map (remoteHealth.ts) - seeded by the app's
  // existing boot-time + periodic health sweep, refreshed again here
  // each time the flyout opens (see refreshPlayerStatus below). keyed
  // by remote_id; undefined means "not probed yet this session" (shown
  // as neither online nor offline).

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
      const online = isOnline(player.remote_id)();
      return {
        label: player.username,
        // reflects the last health-check result, not a live/continuous
        // check - stale info is possible, so this is purely informational
        // (an "offline" badge) and never disables the click, since the
        // player might actually be reachable again.
        badge: online === false ? "offline" : undefined,
        icon: isActivePlayer(player.node_id) ? "check" : "remotePlayer",
        onClick: () => void selectPlayerPlaybackTarget(player),
      };
    }),
  ];

  // narrow mobile playerbar has no room for VolumeControl's own headphones
  // button (see its doc comment), so the active target's output-device
  // picker moves down here instead - same "this device" vs "player" split
  // as `actions()` above, just for audio devices instead of playback
  // targets. always re-queried fresh on open, never cached (devices can be
  // plugged/unplugged at any time).
  const [selectedDevice, setSelectedDevice] = createSignal<string | null>(null);
  const [devices, { refetch: refetchDevices }] = createResource(async () => {
    if (activeTarget().kind === "player") {
      if (remoteTargetOffline()) return [];
      return remoteListOutputDevices();
    }
    return listOutputDevices();
  });

  const pickDevice = (name: string) => {
    setSelectedDevice(name);
    if (activeTarget().kind === "player") {
      void remoteSetOutputDevice(name);
    } else {
      setOutputDevice(name);
    }
  };

  const deviceActions = (): MenuAction[] =>
    (devices() ?? []).map((d) => ({
      label: d.description,
      icon: selectedDevice() === d.name ? "check" : undefined,
      onClick: () => pickDevice(d.name),
    }));

  return (
    // also shown whenever the active target is already a player, even if
    // it hasn't been health-probed as one yet (e.g. right after pairing,
    // before the first refreshPlayerStatus/checkRemoteHealth call lands) -
    // otherwise a brand-new pairing hides this row entirely, with no way
    // back to "this device".
    <Show when={(pairedPlayers()?.length ?? 0) > 0 || activeTarget().kind === "player"}>
      <div class="flex justify-end items-center gap-2 px-3 py-2">
        <Show when={isMobile()}>
          <ClickDropdownMenu
            trigger={
              <button
                type="button"
                class="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-accent-500)]/10 text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-500)]/20 transition-colors focus:outline-none border"
                data-testid="queue-output-device-picker"
                title="audio output device"
                aria-label="audio output device"
              >
                <Icon name="headphones" size={16} />
              </button>
            }
            actions={deviceActions()}
            onOpen={() => {
              setSelectedDevice(null);
              void refetchDevices();
            }}
          />
        </Show>
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
            onOpen={refreshPlayerStatus}
          />
        </CometBorderRing>
      </div>
    </Show>
  );
}

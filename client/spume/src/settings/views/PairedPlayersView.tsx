// settings view for freqhole-player devices paired with this controller.
// "pair a player"/"reconnect" both route through AddRemoteModal (via the
// addRemoteRequest.ts cross-component channel) rather than a separate
// modal - AddRemoteModal is THE pairing entry point (handles the qr scan,
// the pin form, AND the live access check that skips the pin entirely for
// an already-authorized peer - see its own doc comment), so this view has
// no pairing logic of its own beyond triggering it.
import { createResource, createSignal, For, Show } from "solid-js";
import {
  currentPlayersVersion,
  listPairedPlayerRemotes,
  type PairedPlayer,
} from "../../app/services/players/pairedPlayers";
import { deleteRemote, updateRemote } from "../../app/services/remotes/remoteManager";
import { requestAddRemote } from "../../app/services/remotes/addRemoteRequest";
import { Button } from "../../components/buttons/Button";
import { formatDate } from "../../utils/dateTime";

export function PairedPlayersView() {
  const [players, { refetch }] = createResource(currentPlayersVersion, listPairedPlayerRemotes);
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");

  const startRename = (player: PairedPlayer) => {
    setRenamingId(player.node_id);
    setRenameValue(player.username);
  };

  const commitRename = async (player: PairedPlayer) => {
    await updateRemote(player.remote_id, {
      name: renameValue().trim() || player.node_id.slice(0, 8),
    });
    setRenamingId(null);
    await refetch();
  };

  const handleForget = async (player: PairedPlayer) => {
    if (!confirm(`forget "${player.username}"? you'll need to pair again to use it.`)) return;
    await deleteRemote(player.remote_id);
    await refetch();
  };

  return (
    <div class="max-w-2xl mx-auto p-6 space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-[var(--color-text-primary)]">players</h1>
        <Button onClick={() => requestAddRemote("")}>pair a player</Button>
      </div>

      <p class="text-sm text-[var(--color-text-secondary)]">
        freqhole player devices (tvs, speakers) you've paired with by scanning their qr code or
        entering their pin.
      </p>

      <div class="space-y-2">
        <For each={players() ?? []}>
          {(player) => (
            <div class="flex items-center justify-between p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md">
              <div class="min-w-0 flex-1">
                <Show
                  when={renamingId() === player.node_id}
                  fallback={
                    <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {player.username}
                    </p>
                  }
                >
                  <input
                    type="text"
                    value={renameValue()}
                    onInput={(e) => setRenameValue(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitRename(player);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    class="w-full px-2 py-1 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-sm"
                  />
                </Show>
                <p class="text-xs text-[var(--color-text-tertiary)] font-mono truncate">
                  {player.node_id}
                </p>
                <p class="text-xs text-[var(--color-text-tertiary)]">
                  paired {formatDate(player.created_at)}
                </p>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <Show
                  when={renamingId() === player.node_id}
                  fallback={
                    <button
                      type="button"
                      class="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                      onClick={() => startRename(player)}
                    >
                      rename
                    </button>
                  }
                >
                  <button
                    type="button"
                    class="text-xs text-[var(--color-accent-primary)]"
                    onClick={() => void commitRename(player)}
                  >
                    save
                  </button>
                </Show>
                <button
                  type="button"
                  class="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  title="re-enter this player's pairing pin (e.g. if a session expired or trust was revoked)"
                  onClick={() => requestAddRemote(player.node_id)}
                >
                  reconnect
                </button>
                <button
                  type="button"
                  class="text-xs text-[var(--color-status-error)]"
                  onClick={() => void handleForget(player)}
                >
                  forget
                </button>
              </div>
            </div>
          )}
        </For>
        <Show when={players()?.length === 0}>
          <p class="text-sm text-[var(--color-text-tertiary)]">no paired players yet.</p>
        </Show>
      </div>
    </div>
  );
}

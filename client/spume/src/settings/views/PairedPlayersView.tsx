// settings view for freqhole-player devices paired with this controller.
// mirrors RemoteAdminView's list/forget pattern, kept player-scoped (see
// docs/player-remote-site-plan.md phase 5).
import { createResource, createSignal, For, Show } from "solid-js";
import {
  forgetPairedPlayer,
  listPairedPlayers,
  pairedPlayersVersion,
  renamePairedPlayer,
} from "../../app/services/players/pairedPlayers";
import type { PeerNodeWithUser } from "../../app/services/storage/types";
import { PairPlayerModal } from "../../components/modals/PairPlayerModal";
import { Button } from "../../components/buttons/Button";
import { formatDate } from "../../utils/dateTime";

export function PairedPlayersView() {
  const [players, { refetch }] = createResource(pairedPlayersVersion, listPairedPlayers);
  const [showPairModal, setShowPairModal] = createSignal(false);
  const [renamingId, setRenamingId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");

  const startRename = (player: PeerNodeWithUser) => {
    setRenamingId(player.node_id);
    setRenameValue(player.username);
  };

  const commitRename = async (nodeId: string) => {
    await renamePairedPlayer(nodeId, renameValue().trim() || nodeId.slice(0, 8));
    setRenamingId(null);
    await refetch();
  };

  const handleForget = async (player: PeerNodeWithUser) => {
    if (!confirm(`forget "${player.username}"? you'll need to pair again to use it.`)) return;
    await forgetPairedPlayer(player.node_id);
    await refetch();
  };

  return (
    <div class="max-w-2xl mx-auto p-6 space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-[var(--color-text-primary)]">players</h1>
        <Button onClick={() => setShowPairModal(true)}>pair a player</Button>
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
                      if (e.key === "Enter") void commitRename(player.node_id);
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
                    onClick={() => void commitRename(player.node_id)}
                  >
                    save
                  </button>
                </Show>
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

      <PairPlayerModal
        isOpen={showPairModal()}
        onClose={() => setShowPairModal(false)}
        onSuccess={() => void refetch()}
      />
    </div>
  );
}

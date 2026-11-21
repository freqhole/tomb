import { onMount, Show } from "solid-js";
import { Button } from "./buttons/Button";
import { Icon } from "./icons/registry";
import { loadSharedItems, sharedItems } from "../app/services/storage/sharedItems";
import { toast } from "./feedback/Toast";

export interface EmptyStateProps {
  onAddMedia: () => void;
  onAddRemote: () => void;
  onGoToRadio: () => void;
  onGoToPlayer: () => void;
}

export function EmptyState(props: EmptyStateProps) {
  onMount(() => {
    void loadSharedItems().catch((error: unknown) => {
      toast.error(`failed to load saved shares: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
  return (
    <div class="flex-1 h-full overflow-y-auto flex items-start justify-center p-8">
      <div class="text-center max-w-md my-auto">
        <div class="mb-6 flex justify-center">
          <Icon name="freqhole" size={256} color="var(--color-accent-500)" />
        </div>

        <h1 class="text-3xl font-bold text-[var(--color-text-primary)] mb-4">
          welcome to freqhole
        </h1>

        <p class="text-[var(--color-text-secondary)] mb-2">
          get started by adding media, connecting to a remote server, tuning into a radio station,
          or start a jukebox you can control from another device.
        </p>

        <div class="flex flex-col wide:flex-row wide:flex-wrap gap-3 justify-center">
          <Button variant="secondary" onClick={props.onAddMedia}>
            add media
          </Button>

          <Button
            variant="secondary"
            class="wide:bg-[var(--color-accent-500)] wide:hover:bg-[var(--color-accent-400)] wide:text-[var(--color-text-on-accent)]"
            onClick={props.onAddRemote}
          >
            add remote
          </Button>

          <Button variant="secondary" onClick={props.onGoToRadio}>
            listen to radio
          </Button>

          <Button variant="secondary" onClick={props.onGoToPlayer}>
            jukebox
          </Button>
          <Show when={sharedItems().length > 0}>
            <Button variant="secondary" onClick={() => { window.location.hash = "/shared"; }}>
              share'd links
            </Button>
          </Show>
        </div>

        <a
          href="#/settings"
          class="inline-block mt-4 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] italic transition-colors"
        >
          ...or go to settings
        </a>
      </div>
    </div>
  );
}

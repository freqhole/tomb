import { Button } from "./buttons/Button";
import { Icon } from "./icons/registry";

export interface EmptyStateProps {
  onAddMusic: () => void;
  onAddRemote: () => void;
  onGossip: () => void;
  onSettings: () => void;
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div class="flex-1 flex items-center justify-center p-8">
      <div class="text-center max-w-md">
        <div class="mb-6 flex justify-center">
          <Icon name="freqhole" size={256} color="var(--color-accent-500)" />
        </div>

        <h1 class="text-3xl font-bold text-[var(--color-text-primary)] mb-4">
          welcome to freqhole
        </h1>

        <p class="text-[var(--color-text-secondary)] mb-2">
          get started by adding music or connecting to a remote server
        </p>

        <div class="flex gap-3 justify-center">
          <Button variant="secondary" onClick={props.onAddMusic}>
            add music
          </Button>

          <Button variant="secondary" onClick={props.onGossip}>
            gossip
          </Button>

          <Button variant="primary" onClick={props.onAddRemote}>
            add remote
          </Button>
        </div>

        <button
          onClick={props.onSettings}
          class="inline-block mt-4 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer"
        >
          settings
        </button>
      </div>
    </div>
  );
}

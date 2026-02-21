import { Button } from "./buttons/Button";
import { Icon } from "./icons/registry";

export interface EmptyStateProps {
  onAddMusic: () => void;
  onAddRemote: () => void;
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div class="flex-1 flex items-center justify-center p-8">
      <div class="text-center max-w-md">
        <div class="mb-6 flex justify-center">
          <Icon name="music" size={64} color="var(--color-accent-500)" />
        </div>

        <h1 class="text-3xl font-bold text-[var(--color-text-primary)] mb-4">
          welcome to freqhole
        </h1>

        <p class="text-[var(--color-text-secondary)] mb-2">
          get started by adding local files or downloading from urls
        </p>

        <p class="text-sm text-[var(--color-text-tertiary)] mb-8">your music library is empty</p>

        <div class="flex gap-3 justify-center">
          <Button variant="primary" onClick={props.onAddMusic}>
            add music
          </Button>

          <Button variant="secondary" onClick={props.onAddRemote}>
            add remote
          </Button>
        </div>
      </div>
    </div>
  );
}

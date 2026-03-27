// gossip profile setup — modal shown when user has no gossip profile yet.
// lets them pick a display name before entering gossip channels.

import { createSignal, Show } from "solid-js";

export interface GossipProfileSetupProps {
  onSubmit: (displayName: string) => void;
  /** optional: allow dismissing without setting up */
  onSkip?: () => void;
  saving?: boolean;
  error?: string;
}

export function GossipProfileSetup(props: GossipProfileSetupProps) {
  const [name, setName] = createSignal("");
  const canSubmit = () => name().trim().length > 0 && !props.saving;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!canSubmit()) return;
    props.onSubmit(name().trim());
  };

  return (
    <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <form
        class="bg-[var(--color-bg-elevated)] rounded-xl p-6 w-full max-w-sm shadow-xl"
        onSubmit={handleSubmit}
      >
        <h2 class="text-base font-semibold text-[var(--color-text-primary)] mb-1">
          set up gossip profile
        </h2>
        <p class="text-xs text-[var(--color-text-tertiary)] mb-5">
          choose a display name other channel members will see
        </p>

        <label class="block mb-5">
          <span class="text-xs text-[var(--color-text-secondary)] mb-1 block">display name</span>
          <input
            type="text"
            class="w-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] placeholder:text-[var(--color-text-tertiary)]"
            placeholder="your name"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            autofocus
            maxLength={48}
          />
        </label>

        <Show when={props.error}>
          <p class="text-xs text-red-400 mb-3">{props.error}</p>
        </Show>

        <div class="flex justify-end gap-2">
          <Show when={props.onSkip}>
            <button
              type="button"
              class="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
              onClick={() => props.onSkip?.()}
            >
              skip
            </button>
          </Show>
          <button
            type="submit"
            class="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
            classList={{
              "bg-[var(--color-accent-600)] text-white hover:bg-[var(--color-accent-500)]":
                canSubmit(),
              "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] cursor-not-allowed":
                !canSubmit(),
            }}
            disabled={!canSubmit()}
          >
            {props.saving ? "saving..." : "continue"}
          </button>
        </div>
      </form>
    </div>
  );
}

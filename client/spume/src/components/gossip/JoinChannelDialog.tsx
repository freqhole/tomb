import { createSignal, Show } from "solid-js";

export interface JoinChannelDialogProps {
  onJoin: (inviteData: string) => void;
  onCancel: () => void;
  /** error message from failed join attempt */
  error?: string;
}

export function JoinChannelDialog(props: JoinChannelDialogProps) {
  const [inviteText, setInviteText] = createSignal("");
  const canJoin = () => inviteText().trim().length > 0;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!canJoin()) return;
    props.onJoin(inviteText().trim());
  };

  return (
    <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <form
        class="bg-[var(--color-bg-elevated)] rounded-xl p-5 w-full max-w-sm shadow-xl"
        onSubmit={handleSubmit}
      >
        <h2 class="text-base font-semibold text-[var(--color-text-primary)] mb-2">join channel</h2>
        <p class="text-xs text-[var(--color-text-tertiary)] mb-4">
          paste the invite token from a friend to join their channel
        </p>

        <label class="block mb-2">
          <span class="text-xs text-[var(--color-text-secondary)] mb-1 block">invite token</span>
          <textarea
            class="w-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] placeholder:text-[var(--color-text-tertiary)] resize-none font-mono"
            placeholder="paste invite here..."
            value={inviteText()}
            onInput={(e) => setInviteText(e.currentTarget.value)}
            rows={3}
            autofocus
          />
        </label>

        <Show when={props.error}>
          <p class="text-xs text-red-400 mb-3">{props.error}</p>
        </Show>

        <div class="flex justify-end gap-2 mt-4">
          <button
            type="button"
            class="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
            onClick={() => props.onCancel()}
          >
            cancel
          </button>
          <button
            type="submit"
            class="px-4 py-2 text-sm rounded-lg transition-colors"
            classList={{
              "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-400)]":
                canJoin(),
              "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] cursor-not-allowed":
                !canJoin(),
            }}
            disabled={!canJoin()}
          >
            join
          </button>
        </div>
      </form>
    </div>
  );
}

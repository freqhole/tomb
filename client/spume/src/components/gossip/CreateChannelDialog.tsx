import { createSignal } from "solid-js";

export interface CreateChannelDialogProps {
  onSubmit: (name: string, description: string) => void;
  onCancel: () => void;
}

export function CreateChannelDialog(props: CreateChannelDialogProps) {
  const [name, setName] = createSignal("");
  const [desc, setDesc] = createSignal("");
  const canSubmit = () => name().trim().length > 0;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!canSubmit()) return;
    props.onSubmit(name().trim(), desc().trim());
  };

  return (
    <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <form
        class="bg-[var(--color-bg-elevated)] rounded-xl p-5 w-full max-w-sm shadow-xl"
        onSubmit={handleSubmit}
      >
        <h2 class="text-base font-semibold text-[var(--color-text-primary)] mb-4">
          create channel
        </h2>

        <label class="block mb-3">
          <span class="text-xs text-[var(--color-text-secondary)] mb-1 block">name</span>
          <input
            type="text"
            class="w-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] placeholder:text-[var(--color-text-tertiary)]"
            placeholder="jazzy stuff"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            autofocus
            maxLength={64}
          />
        </label>

        <label class="block mb-5">
          <span class="text-xs text-[var(--color-text-secondary)] mb-1 block">
            description (optional)
          </span>
          <textarea
            class="w-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-sm rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-[var(--color-accent-500)] placeholder:text-[var(--color-text-tertiary)] resize-none"
            placeholder="what's this channel about?"
            value={desc()}
            onInput={(e) => setDesc(e.currentTarget.value)}
            rows={2}
            maxLength={256}
          />
        </label>

        <div class="flex justify-end gap-2">
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
                canSubmit(),
              "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] cursor-not-allowed":
                !canSubmit(),
            }}
            disabled={!canSubmit()}
          >
            create
          </button>
        </div>
      </form>
    </div>
  );
}

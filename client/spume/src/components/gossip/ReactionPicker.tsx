import { createSignal, For, Show } from "solid-js";

export interface ReactionPickerProps {
  emojis?: string[];
  onSelect: (emoji: string) => void;
  onClose?: () => void;
}

const defaultEmojis = ["🔥", "💜", "👀", "🎵", "✨", "🙌", "💀", "🤯", "👏", "🎶", "❤️", "😍"];

export function ReactionPicker(props: ReactionPickerProps) {
  const [customMode, setCustomMode] = createSignal(false);
  const [customInput, setCustomInput] = createSignal("");
  const emojis = () => props.emojis ?? defaultEmojis;

  const handleCustomSubmit = () => {
    const val = customInput().trim();
    if (val) {
      props.onSelect(val);
      setCustomInput("");
      setCustomMode(false);
    }
  };

  return (
    <div class="inline-flex flex-col bg-[var(--color-bg-elevated)] rounded-xl shadow-lg p-2 min-w-0">
      <Show
        when={!customMode()}
        fallback={
          <div class="flex items-center gap-1 p-1">
            <input
              type="text"
              class="w-20 bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] text-sm rounded px-2 py-1 outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
              placeholder="emoji"
              value={customInput()}
              onInput={(e) => setCustomInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomSubmit();
                if (e.key === "Escape") setCustomMode(false);
              }}
              autofocus
              maxLength={8}
            />
            <button
              class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] px-1"
              onClick={() => setCustomMode(false)}
            >
              ×
            </button>
          </div>
        }
      >
        <div class="flex flex-wrap gap-0.5 max-w-[240px]">
          <For each={emojis()}>
            {(emoji) => (
              <button
                class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors text-base"
                onClick={() => props.onSelect(emoji)}
                title={emoji}
              >
                {emoji}
              </button>
            )}
          </For>
          <button
            class="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors text-xs text-[var(--color-text-tertiary)]"
            onClick={() => setCustomMode(true)}
            title="custom emoji"
          >
            +
          </button>
        </div>
      </Show>
    </div>
  );
}

import { For, splitProps } from "solid-js";

export interface AlphabetNavProps {
  /** current active letter */
  currentLetter?: string;
  /** set of letters that should be disabled (no items) */
  disabledLetters?: Set<string>;
  /** callback when a letter is clicked */
  onLetterClick: (letter: string) => void;
  /** sort direction affects letter order (default: asc = # first, then A-Z) */
  sortDirection?: "asc" | "desc";
  /** additional CSS classes */
  class?: string;
}

/**
 * alphabet navigation component for jumping to letters in a sorted list
 *
 * - displays A-Z + # in vertical column
 * - highlights current letter
 * - disables letters with no items
 * - click to jump to that letter section
 * - order: asc = #, A-Z | desc = Z-A, #
 *
 * used in: artist list, genre list, any alphabetically sorted list
 */
export function AlphabetNav(props: AlphabetNavProps) {
  const [local, others] = splitProps(props, [
    "currentLetter",
    "disabledLetters",
    "onLetterClick",
    "sortDirection",
    "class",
  ]);

  // generate letter list based on sort direction
  const allLetters = () => {
    const letters = Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode(65 + i),
    );

    if (local.sortDirection === "desc") {
      // Z to A, then # at the end
      return [...letters.reverse(), "#"];
    } else {
      // default: # first, then A to Z
      return ["#", ...letters];
    }
  };

  const handleLetterClick = (letter: string) => {
    const disabled = local.disabledLetters || new Set();
    if (!disabled.has(letter)) {
      local.onLetterClick(letter);
    }
  };

  return (
    <div
      class={`flex flex-col bg-[var(--color-bg-primary)] border-r border-[var(--color-border-default)] w-10 h-full justify-end overflow-hidden ${local.class || ""}`}
      {...others}
    >
      <div class="flex flex-col items-center overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[var(--color-border-default)]">
        <For each={allLetters()}>
          {(letter) => {
            const disabled = local.disabledLetters || new Set();
            const isDisabled = disabled.has(letter);
            const isActive = local.currentLetter === letter;

            return (
              <button
                class={`
                  w-8 h-8 text-sm font-medium transition-all duration-150 rounded
                  flex items-center justify-center flex-shrink-0
                  ${
                    isDisabled
                      ? "text-[var(--color-text-tertiary)] cursor-not-allowed opacity-50"
                      : isActive
                        ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
                        : "text-[var(--color-accent-400)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-accent-500)]/20"
                  }
                `}
                onClick={() => handleLetterClick(letter)}
                disabled={isDisabled}
                title={isDisabled ? "no items" : `jump to ${letter}`}
                aria-label={`jump to ${letter}`}
              >
                {letter}
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

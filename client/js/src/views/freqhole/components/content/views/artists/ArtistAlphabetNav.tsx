import { For } from "solid-js";
import type { ArtistSummary } from "../../../../../../lib/music/schemas";

interface ArtistAlphabetNavProps {
  artists: ArtistSummary[];
  onLetterClick: (letter: string) => void;
  currentLetter?: string;
  disabledLetters?: Set<string>;
  sortDirection?: "asc" | "desc";
  class?: string;
}

export function ArtistAlphabetNav(props: ArtistAlphabetNavProps) {
  // All possible letters - order depends on sort direction
  const allLetters = () => {
    const letters = Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode(65 + i)
    );

    if (props.sortDirection === "desc") {
      // Z to A, then # at the end
      return [...letters.reverse(), "#"];
    } else {
      // Default: # first, then A to Z
      return ["#", ...letters];
    }
  };

  const handleLetterClick = (letter: string) => {
    const disabled = props.disabledLetters || new Set();
    if (!disabled.has(letter)) {
      props.onLetterClick(letter);
    }
  };

  return (
    <div
      class={`flex flex-col bg-black border-r border-magenta-800/30 w-10 md:w-8 h-full ${props.class || ""}`}
    >
      <div class="flex flex-col items-center gap-2 overflow-y-auto flex-1 py-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-magenta-800/50">
        <For each={allLetters()}>
          {(letter) => {
            const disabled = props.disabledLetters || new Set();
            const isDisabled = disabled.has(letter);
            const isActive = props.currentLetter === letter;

            return (
              <button
                class={`
                  w-8 h-8 md:w-6 md:h-6 text-sm md:text-xs font-medium transition-all duration-150 rounded
                  flex items-center justify-center flex-shrink-0
                  ${
                    isDisabled
                      ? "text-gray-600 cursor-not-allowed opacity-50"
                      : isActive
                        ? "bg-magenta-600 text-white"
                        : "text-magenta-300 hover:text-white hover:bg-magenta-600/20"
                  }
                `}
                onClick={() => handleLetterClick(letter)}
                disabled={isDisabled}
                title={isDisabled ? "No artists" : `Jump to ${letter}`}
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

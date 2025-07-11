/* @jsxImportSource solid-js */
import { Show, createSignal, onMount, onCleanup } from "solid-js";
import { CloseIcon } from "../icons";

export const KeyboardHelp = () => {
  const [showHelp, setShowHelp] = createSignal(false);

  // Show help with ? key
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.code === "Slash" && e.shiftKey) {
        // Shift + ? to show help
        e.preventDefault();
        setShowHelp(!showHelp());
      } else if (e.code === "Escape" && showHelp()) {
        e.preventDefault();
        setShowHelp(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  const shortcuts = [
    {
      category: "Player Controls",
      items: [
        { key: "Space", description: "Play / Pause" },
        { key: "Shift + ←", description: "Previous track" },
        { key: "Shift + →", description: "Next track" },
        { key: "←", description: "Seek backward 10s" },
        { key: "→", description: "Seek forward 10s" },
      ],
    },
    {
      category: "Queue",
      items: [
        { key: "Q", description: "Toggle queue panel" },
        { key: "Esc", description: "Close queue (when open)" },
        { key: "M", description: "Toggle mini player" },
      ],
    },
    {
      category: "General",
      items: [
        { key: "Shift + ?", description: "Show this help" },
        { key: "Esc", description: "Close help" },
      ],
    },
  ];

  return (
    <>
      {/* Help Button */}
      <button
        class="fixed bottom-6 right-6 w-12 h-12 bg-black/50 backdrop-blur-sm text-white border border-white/20 rounded-full cursor-pointer transition-all duration-300 flex items-center justify-center hover:bg-black/70 hover:scale-110 z-40"
        onClick={() => setShowHelp(!showHelp())}
        title="Keyboard shortcuts (Shift + ?)"
      >
        ?
      </button>

      {/* Help Modal */}
      <Show when={showHelp()}>
        <div class="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
          <div class="bg-black/90 backdrop-blur-xl border border-white/20 rounded-lg p-6 max-w-md w-full mx-4 animate-slideUp">
            <div class="flex items-center justify-between mb-6">
              <h3 class="text-xl font-medium text-white m-0">
                Keyboard Shortcuts
              </h3>
              <button
                onClick={() => setShowHelp(false)}
                class="bg-white/10 border-none text-white p-2 rounded cursor-pointer transition-all duration-300 hover:bg-white/20 hover:scale-110"
                title="Close help (Esc)"
              >
                <CloseIcon />
              </button>
            </div>

            <div class="space-y-6">
              {shortcuts.map((category) => (
                <div>
                  <h4 class="text-primary-400 font-medium text-sm uppercase tracking-wide mb-3 m-0">
                    {category.category}
                  </h4>
                  <div class="space-y-2">
                    {category.items.map((item) => (
                      <div class="flex items-center justify-between py-2 px-3 bg-white/5 rounded">
                        <span class="text-white/90 text-sm">
                          {item.description}
                        </span>
                        <kbd class="px-2 py-1 bg-white/20 text-white text-xs rounded font-mono">
                          {item.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div class="mt-6 pt-4 border-t border-white/10">
              <p class="text-white/60 text-xs text-center m-0">
                Press{" "}
                <kbd class="px-1 py-0.5 bg-white/20 text-white text-xs rounded font-mono">
                  Shift + ?
                </kbd>{" "}
                anytime to toggle this help
              </p>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
};

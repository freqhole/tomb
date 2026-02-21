import { createSignal, onCleanup, Show } from "solid-js";
import { Icon } from "../icons/registry";

export interface VolumeControlProps {
  /** current volume (0-1) */
  volume: number;
  /** callback when volume changes */
  onVolumeChange: (volume: number) => void;
  /** additional classes */
  class?: string;
}

// volume control with popup vertical slider
export function VolumeControl(props: VolumeControlProps) {
  const [showSlider, setShowSlider] = createSignal(false);
  let hideTimeout: number | null = null;

  const handleMouseEnter = () => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    setShowSlider(true);
  };

  const handleMouseLeave = () => {
    hideTimeout = window.setTimeout(() => {
      setShowSlider(false);
      hideTimeout = null;
    }, 300);
  };

  const toggleSlider = () => {
    setShowSlider(!showSlider());
  };

  const handleVolumeChange = (e: InputEvent) => {
    const target = e.currentTarget as HTMLInputElement;
    const newVolume = parseFloat(target.value);
    props.onVolumeChange(newVolume);
  };

  onCleanup(() => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
    }
  });

  const volumeIcon = () => (props.volume === 0 ? "volumeOff" : "volume");
  const volumePercentage = () => Math.round(props.volume * 100);

  return (
    <div
      class={`relative flex items-center ${props.class || ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        class="p-2 rounded-full hover:bg-[var(--color-accent-500)]/20 transition-colors"
        onClick={toggleSlider}
        title={`volume: ${volumePercentage()}%`}
        aria-label="volume control"
      >
        <Icon
          name={volumeIcon()}
          size={20}
          color="var(--color-accent-500)"
          className="hover:text-[var(--color-text-primary)] transition-colors"
        />
      </button>

      <Show when={showSlider()}>
        <div class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-[var(--color-bg-primary)]/90 backdrop-blur-xl border border-[var(--color-accent-500)]/30 rounded-lg p-3 w-16 shadow-lg z-10">
          <div class="flex flex-col items-center gap-3 h-32">
            <span class="text-xs text-[var(--color-accent-500)] font-medium">
              {volumePercentage()}%
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={props.volume}
              onInput={handleVolumeChange}
              class="flex-1 w-1.5 bg-[var(--color-accent-500)]/20 border-none rounded-full outline-none cursor-pointer hover:w-2 transition-all"
              style={{
                background: `linear-gradient(to top, var(--color-accent-500) 0%, var(--color-accent-500) ${props.volume * 100}%, rgba(255, 26, 158, 0.2) ${props.volume * 100}%, rgba(255, 26, 158, 0.2) 100%)`,
                "writing-mode": "vertical-lr",
                direction: "rtl",
                "-webkit-appearance": "slider-vertical",
              }}
              aria-label="volume slider"
            />
          </div>
          {/* tooltip arrow */}
          <div class="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-[var(--color-accent-500)]/30" />
        </div>
      </Show>
    </div>
  );
}

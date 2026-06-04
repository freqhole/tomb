import { createSignal, For, Show } from "solid-js";

export interface SimTuningValues {
  albumArtistDistance: number;
  albumArtistStrength: number;
  relatedArtistDistance: number;
  relatedArtistStrength: number;
  artistHubDistance: number;
  artistHubStrength: number;
  albumCollide: number;
  artistCollide: number;
  clusterCohesion: number;
  artistCharge: number;
  albumCharge: number;
  gravity: number;
}

export const DEFAULT_TUNING: SimTuningValues = {
  albumArtistDistance: 0.7,
  albumArtistStrength: 1.5,
  relatedArtistDistance: 2,
  relatedArtistStrength: 1,
  artistHubDistance: 1,
  artistHubStrength: 1,
  albumCollide: 2,
  artistCollide: 1,
  clusterCohesion: 0.4,
  artistCharge: 1,
  albumCharge: 1,
  gravity: 0.25,
};

type Knob = {
  key: keyof SimTuningValues;
  label: string;
  min: number;
  max: number;
  step: number;
};

const KNOBS: Knob[] = [
  {
    key: "gravity",
    label: "gravity (pack toward layout)",
    min: 0.2,
    max: 5,
    step: 0.05,
  },
  {
    key: "albumArtistDistance",
    label: "album↔artist distance",
    min: 0.05,
    max: 4,
    step: 0.025,
  },
  {
    key: "albumArtistStrength",
    label: "album↔artist strength",
    min: 0,
    max: 5,
    step: 0.05,
  },
  {
    key: "albumCollide",
    label: "album collide radius",
    min: 0.1,
    max: 2,
    step: 0.025,
  },
  {
    key: "artistCollide",
    label: "artist collide radius",
    min: 0.1,
    max: 2,
    step: 0.025,
  },
  {
    key: "clusterCohesion",
    label: "cluster cohesion (artist+albums)",
    min: 0,
    max: 1.5,
    step: 0.01,
  },
  {
    key: "artistCharge",
    label: "artist repulsion (cluster spacing)",
    min: 0.2,
    max: 10,
    step: 0.1,
  },
  {
    key: "albumCharge",
    label: "album repulsion (between clusters)",
    min: 0.2,
    max: 10,
    step: 0.1,
  },
  {
    key: "relatedArtistDistance",
    label: "related-artist distance",
    min: 0.2,
    max: 4,
    step: 0.05,
  },
  {
    key: "relatedArtistStrength",
    label: "related-artist strength",
    min: 0,
    max: 3,
    step: 0.05,
  },
  {
    key: "artistHubDistance",
    label: "artist↔hub distance",
    min: 0.2,
    max: 4,
    step: 0.05,
  },
  {
    key: "artistHubStrength",
    label: "artist↔hub strength",
    min: 0,
    max: 3,
    step: 0.05,
  },
];

export interface SimTuningOverlayProps {
  values: () => SimTuningValues;
  onChange: (next: SimTuningValues) => void;
  onClose: () => void;
}

export function SimTuningOverlay(props: SimTuningOverlayProps) {
  const [collapsed, setCollapsed] = createSignal(false);
  const set = (key: keyof SimTuningValues, n: number) => {
    props.onChange({ ...props.values(), [key]: n });
  };
  return (
    <div
      class="absolute top-3 right-3 z-30 w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-amber-400/40 bg-[var(--color-bg-elevated)]/95 backdrop-blur-sm shadow-xl text-xs text-white/85 pointer-events-auto"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div class="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/10">
        <div class="flex items-center gap-1.5">
          <span class="text-amber-300 font-mono text-[10px] uppercase tracking-wider">debug</span>
          <span class="text-white/70">sim tuning</span>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="px-1.5 py-0.5 rounded text-[10px] border border-white/15 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white cursor-pointer"
            onClick={() => props.onChange({ ...DEFAULT_TUNING })}
            title="reset all knobs to defaults"
          >
            reset
          </button>
          <button
            type="button"
            class="px-1.5 py-0.5 rounded text-[10px] border border-white/15 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white cursor-pointer"
            onClick={() => setCollapsed(!collapsed())}
          >
            {collapsed() ? "expand" : "collapse"}
          </button>
          <button
            type="button"
            class="px-1.5 py-0.5 rounded text-[10px] border border-white/15 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white cursor-pointer"
            onClick={props.onClose}
            title="hide overlay (toggle with shift + d)"
          >
            ✕
          </button>
        </div>
      </div>
      <Show when={!collapsed()}>
        <div class="flex flex-col gap-2 p-3">
          <For each={KNOBS}>
            {(k) => {
              const val = () => props.values()[k.key];
              return (
                <div class="flex flex-col gap-0.5">
                  <div class="flex items-center justify-between text-[10px]">
                    <span class="text-white/65">{k.label}</span>
                    <span class="font-mono text-amber-200">{val().toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={k.min}
                    max={k.max}
                    step={k.step}
                    value={val()}
                    onInput={(e) => set(k.key, parseFloat(e.currentTarget.value))}
                    onDblClick={() => set(k.key, DEFAULT_TUNING[k.key])}
                    class="w-full accent-amber-400 cursor-pointer"
                  />
                </div>
              );
            }}
          </For>
          <div class="text-[10px] text-white/40 mt-1">
            multipliers apply on top of baked-in defaults. double-click a slider to reset. try:
            collide ↓ + cohesion ↑ to clump artist + albums.
          </div>
        </div>
      </Show>
    </div>
  );
}

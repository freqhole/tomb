// GraphForceTuningPanel — debug overlay for live-tuning force-graph
// constants without a code change.
//
// usage: click the bottom-right node/edge chip to open; drag sliders
// to adjust; copy the json output and paste back into forceTuning.ts
// once the layout looks right.
//
// this component owns the tuning signal state. on every slider change
// it calls props.sendTuning with a full overrides object so the worker
// rebuilds the sim. a "reset" button restores all sliders to the
// compiled-in defaults from forceTuning.ts.

import { createSignal, For, Show, type Accessor } from "solid-js";
import type { TuningOverrides } from "./worker/graphWorkerClient";

// -------------------------------------------------------------------
// compiled-in defaults mirrored from forceTuning.ts so the reset
// button and initial slider positions are correct without importing
// the worker-side module here.
// -------------------------------------------------------------------
const DEFAULTS = {
  linkDistanceMul: 2.05,
  linkStrengthBase: 0.24,
  linkStrengthSlope: 0.52,
  chargePerNodeSize: -8.6,
  relationHubChargeMul: 0.25,
  valueHubChargeMul: 0.5,
  hubLinkDistRemoteToRelation: 0.22,
  hubLinkDistKindToKind: 0.45,
  remoteHubLinkStrengthBump: 2.2,
  hubRingRadiusSqrtFactor: 1.4,
  remoteRadiusFactor: 1.0,
  remoteStrength: 0.22,
  relationRadiusFactor: 1.0,
  relationStrength: 0.22,
  valueRadiusFactor: 1.3,
  valueStrength: 0.14,
  entityOutwardWedgeHalfDeg: 60,
  entityOutwardRadiusFactor: 1.6,
  entityOutwardStrength: 0.05,
  velocityDecay: 0.46,
  centerGravityStrength: 0,
  alphaDecay: 0, // 0 = use density-based auto
} as const;

type TuningKey = keyof typeof DEFAULTS;

/** approximate d3-force bare defaults: link distance ≈ 30px, charge = -30
 *  per node, velocity decay 0.4, and all custom hub + fan-out forces set to
 *  neutral / zero. useful as a quick sanity-check against the tuned values. */
const D3_DEFAULTS: Record<TuningKey, number> = {
  linkDistanceMul: 0.5, // ≈ 30px / 56px default node size
  linkStrengthBase: 0.7, // rough 1/min(degree) for a moderate graph
  linkStrengthSlope: 0.0, // d3 doesn't vary by weight
  chargePerNodeSize: -0.5, // ≈ -30 / 56px, clamped to slider max
  relationHubChargeMul: 1.0, // no special hub charge
  valueHubChargeMul: 1.0,
  hubLinkDistRemoteToRelation: 1.0, // neutral hub-to-hub scaling
  hubLinkDistKindToKind: 1.0,
  remoteHubLinkStrengthBump: 1.0, // no spring bump
  hubRingRadiusSqrtFactor: 0.1, // min value — ring force effectively off
  remoteRadiusFactor: 1.0,
  remoteStrength: 0.0, // all directional forces off
  relationRadiusFactor: 1.0,
  relationStrength: 0.0,
  valueRadiusFactor: 1.0,
  valueStrength: 0.0,
  entityOutwardWedgeHalfDeg: 90,
  entityOutwardRadiusFactor: 1.0,
  entityOutwardStrength: 0.0, // fan-out off
  velocityDecay: 0.4, // d3 default
  centerGravityStrength: 0.04, // weak gravity keeps lightly-linked hubs from drifting
  alphaDecay: 0.023, // d3 default ≈ 0.0228; lower = sim runs longer
};

interface SliderSpec {
  key: TuningKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

interface SliderGroup {
  heading: string;
  sliders: SliderSpec[];
}

const GROUPS: SliderGroup[] = [
  {
    heading: "link + spring",
    sliders: [
      { key: "linkDistanceMul", label: "link dist mul", min: 0.3, max: 6, step: 0.05 },
      { key: "linkStrengthBase", label: "strength base", min: 0, max: 2, step: 0.01 },
      { key: "linkStrengthSlope", label: "strength slope", min: 0, max: 4, step: 0.01 },
    ],
  },
  {
    heading: "charge / repulsion",
    sliders: [
      { key: "chargePerNodeSize", label: "charge / px", min: -30, max: -0.5, step: 0.1 },
      { key: "relationHubChargeMul", label: "hub charge mul", min: 0.02, max: 1.5, step: 0.01 },
      { key: "valueHubChargeMul", label: "value hub charge mul", min: 0.02, max: 1.5, step: 0.01 },
    ],
  },
  {
    heading: "hub scaffold spacing",
    sliders: [
      {
        key: "hubLinkDistRemoteToRelation",
        label: "remote→relation dist",
        min: 0.02,
        max: 2,
        step: 0.01,
      },
      { key: "hubLinkDistKindToKind", label: "kind→kind dist", min: 0.02, max: 2, step: 0.01 },
      {
        key: "remoteHubLinkStrengthBump",
        label: "remote spring bump",
        min: 0.1,
        max: 8,
        step: 0.05,
      },
      {
        key: "hubRingRadiusSqrtFactor",
        label: "ring radius √ factor",
        min: 0.1,
        max: 6,
        step: 0.05,
      },
    ],
  },
  {
    heading: "hub directional pull",
    sliders: [
      { key: "remoteRadiusFactor", label: "remote radius ×", min: 0.1, max: 4, step: 0.05 },
      { key: "remoteStrength", label: "remote strength", min: 0, max: 1, step: 0.01 },
      { key: "relationRadiusFactor", label: "relation radius ×", min: 0.1, max: 4, step: 0.05 },
      { key: "relationStrength", label: "relation strength", min: 0, max: 1, step: 0.01 },
      { key: "valueRadiusFactor", label: "value radius ×", min: 0.1, max: 5, step: 0.05 },
      { key: "valueStrength", label: "value strength", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    heading: "entity fan-out (phase 20)",
    sliders: [
      { key: "entityOutwardWedgeHalfDeg", label: "wedge half (°)", min: 5, max: 180, step: 1 },
      { key: "entityOutwardRadiusFactor", label: "radius ×", min: 0.3, max: 6, step: 0.05 },
      { key: "entityOutwardStrength", label: "outward strength", min: 0, max: 0.6, step: 0.005 },
    ],
  },
  {
    heading: "sim dynamics",
    sliders: [
      { key: "velocityDecay", label: "velocity decay", min: 0.1, max: 0.95, step: 0.01 },
      { key: "centerGravityStrength", label: "center gravity", min: 0, max: 0.15, step: 0.005 },
      { key: "alphaDecay", label: "alpha decay", min: 0, max: 0.1, step: 0.001 },
    ],
  },
];

export interface GraphForceTuningPanelProps {
  nodeCount: Accessor<number>;
  edgeCount: Accessor<number>;
  selectionCount?: Accessor<number>;
  /** sendTuning from the GraphCanvas api signal. */
  sendTuning: Accessor<((overrides: TuningOverrides) => void) | undefined>;
  /** call to do a full viz reset (re-seeds positions, restarts sim). */
  onFullReset?: () => void;
}

export function GraphForceTuningPanel(props: GraphForceTuningPanelProps) {
  const [open, setOpen] = createSignal(false);

  // one signal per tuning key, seeded from defaults
  const vals = Object.fromEntries(
    (Object.keys(DEFAULTS) as TuningKey[]).map((k) => {
      const [get, set] = createSignal(DEFAULTS[k]);
      return [k, { get, set }] as const;
    })
  ) as unknown as Record<TuningKey, { get: Accessor<number>; set: (v: number) => void }>;

  function buildOverrides(): TuningOverrides {
    return Object.fromEntries(
      (Object.keys(DEFAULTS) as TuningKey[]).map((k) => [k, vals[k].get()])
    ) as TuningOverrides;
  }

  function applyAll() {
    props.sendTuning()?.(buildOverrides());
  }

  function handleSlider(key: TuningKey, rawValue: string) {
    vals[key].set(Number(rawValue));
    applyAll();
  }

  function resetAll() {
    for (const k of Object.keys(DEFAULTS) as TuningKey[]) {
      vals[k].set(DEFAULTS[k]);
    }
    props.sendTuning()?.({});
    props.onFullReset?.();
  }

  function applyPreset(preset: Record<TuningKey, number>) {
    for (const k of Object.keys(DEFAULTS) as TuningKey[]) {
      vals[k].set(preset[k]);
    }
    applyAll();
  }

  function copyJson() {
    const out = buildOverrides();
    const lines = (Object.keys(DEFAULTS) as TuningKey[]).map((k) => `  "${k}": ${out[k]}`);
    navigator.clipboard.writeText("{\n" + lines.join(",\n") + "\n}").catch(() => undefined);
  }

  return (
    <div class="absolute bottom-3 right-3 z-10">
      {/* collapsed chip — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="px-2 py-1 rounded bg-[var(--color-bg-elevated)]/85 backdrop-blur-sm border border-white/10 text-[11px] text-white/70 leading-tight whitespace-nowrap cursor-pointer hover:border-white/25 transition-colors"
        title="click to open force tuning panel"
      >
        <span class="text-white/90 font-medium">{props.nodeCount()}</span>
        <span class="text-white/50"> nodes</span>
        <span class="text-white/30 mx-1.5">·</span>
        <span class="text-white/90 font-medium">{props.edgeCount()}</span>
        <span class="text-white/50"> edges</span>
        <Show when={(props.selectionCount?.() ?? 0) > 0}>
          <span class="text-white/30 mx-1.5">·</span>
          <span class="text-[var(--color-accent-500,#ff1a9e)] font-medium">
            {props.selectionCount!()}
          </span>
          <span class="text-white/50"> selected</span>
        </Show>
        <span class="text-white/30 ml-1.5">{open() ? "▲" : "▼"}</span>
      </button>

      {/* expanded tuning panel */}
      <Show when={open()}>
        <div class="absolute bottom-[calc(100%+6px)] right-0 w-80 max-h-[70vh] overflow-y-auto overflow-x-hidden rounded-lg bg-[var(--color-bg-elevated)]/95 backdrop-blur-md border border-white/15 shadow-2xl text-[11px] text-white/80">
          {/* header */}
          <div class="sticky top-0 flex items-center justify-between px-3 py-2 bg-[var(--color-bg-elevated)]/95 border-b border-white/10 z-10">
            <span class="font-semibold text-white/90 text-[12px]">force tuning</span>
            <div class="flex gap-2">
              <button
                type="button"
                onClick={copyJson}
                class="px-2 py-0.5 rounded text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors"
                title="copy current values as json"
              >
                copy json
              </button>
              <button
                type="button"
                onClick={() => applyPreset(D3_DEFAULTS)}
                class="px-2 py-0.5 rounded text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors"
                title="apply approximate d3-force bare defaults (no custom hub/fan-out forces)"
              >
                d3
              </button>
              <button
                type="button"
                onClick={resetAll}
                class="px-2 py-0.5 rounded text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors"
                title="reset all to compiled-in defaults + full viz reset"
              >
                reset
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                class="w-5 h-5 rounded flex items-center justify-center text-white/50 hover:text-white/90 hover:bg-white/10 transition-colors"
                aria-label="close"
              >
                ×
              </button>
            </div>
          </div>

          {/* groups */}
          <div class="px-3 pb-3 space-y-3 pt-2">
            <For each={GROUPS}>
              {(group) => (
                <div>
                  <div class="text-white/40 uppercase tracking-widest text-[9px] mb-1.5 mt-1">
                    {group.heading}
                  </div>
                  <div class="space-y-1.5">
                    <For each={group.sliders}>
                      {(spec) => (
                        <div class="flex items-center gap-2">
                          <span class="w-28 shrink-0 text-white/60 truncate" title={spec.key}>
                            {spec.label}
                          </span>
                          <input
                            type="range"
                            min={spec.min}
                            max={spec.max}
                            step={spec.step}
                            value={vals[spec.key].get()}
                            onInput={(e) => handleSlider(spec.key, e.currentTarget.value)}
                            class="flex-1 accent-[var(--color-accent-500,#ff1a9e)] cursor-pointer"
                          />
                          <span class="w-10 text-right text-white/80 tabular-nums shrink-0">
                            {vals[spec.key]
                              .get()
                              .toFixed(spec.step < 0.01 ? 3 : spec.step < 0.1 ? 2 : 1)}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>

          {/* copy-paste hint */}
          <div class="px-3 pb-2.5 pt-0 text-white/30 text-[9px] leading-snug border-t border-white/10 mt-1">
            drag sliders → sim rebuilds live. "copy json" → paste into forceTuning.ts constants once
            layout looks right.
          </div>
        </div>
      </Show>
    </div>
  );
}

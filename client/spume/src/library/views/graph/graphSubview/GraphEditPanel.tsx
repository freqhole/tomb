// floating edit panel shown in the graph view when edit mode is on
// and the selection resolves to one-or-more album(s) (directly or
// via artist fan-out). suppresses the regular album/artist detail
// popovers — those are for browsing, this is for editing.

import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { BulkAlbumTaxonsEditor } from "../../../../components/taxonomy/BulkAlbumTaxonsEditor";
import type { TaxonKindOption } from "../../../../components/taxonomy/TaxonChipsGrid";
import type { Remote } from "../../../../app/services/storage/schemas/remote";

export interface GraphEditSelectionSummary {
  artists: string[];
  albums: string[];
}

export interface GraphEditPanelProps {
  remote: Accessor<Remote | null>;
  /** resolved album ids the editor will fan-out across. */
  albumIds: Accessor<string[]>;
  /** descriptive summary of what's selected — drives the header. */
  summary: Accessor<GraphEditSelectionSummary>;
  /** kinds to render; caller usually fetches once at the parent. */
  kinds?: Accessor<TaxonKindOption[]>;
  onClose: () => void;
  onAfterMutate?: () => void | Promise<void>;
  x?: number;
  y?: number;
}

export function GraphEditPanel(props: GraphEditPanelProps) {
  const positioned = () => props.x !== undefined && props.y !== undefined;
  const remote = () => props.remote();
  const sum = () => props.summary();
  const headerText = () => {
    const s = sum();
    const bits: string[] = [];
    if (s.artists.length > 0) {
      bits.push(`${s.artists.length} artist${s.artists.length === 1 ? "" : "s"}`);
    }
    if (s.albums.length > 0) {
      bits.push(`${s.albums.length} album${s.albums.length === 1 ? "" : "s"}`);
    }
    return bits.join(" + ") || "selection";
  };
  return (
    <Show when={remote() && props.albumIds().length > 0}>
      <div
        class="rounded-lg bg-[var(--color-bg-elevated)] border border-pink-500/40 shadow-xl text-[var(--color-text)] w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-var(--nav-height,56px)-var(--player-bar-height,0px)-3.5rem)] overflow-y-auto flex flex-col"
        style={
          positioned()
            ? {
                position: "absolute",
                left: `${props.x}px`,
                top: `${props.y}px`,
                "pointer-events": "auto",
                "z-index": 20,
              }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex items-start gap-2 p-3 pb-2">
          <div class="flex-1 min-w-0">
            <div class="text-[10px] uppercase tracking-wide text-pink-300/85">
              editing · {remote()?.name}
            </div>
            <div class="font-semibold text-sm leading-tight mt-0.5">{headerText()}</div>
            <Show when={sum().artists.length > 0 || sum().albums.length > 0}>
              <SelectionPreview summary={sum()} />
            </Show>
          </div>
          <button
            type="button"
            class="text-white/50 hover:text-white/85 cursor-pointer leading-none px-1"
            aria-label="exit edit panel"
            title="clear selection"
            onClick={(e) => {
              e.stopPropagation();
              props.onClose();
            }}
          >
            ×
          </button>
        </div>

        <div class="px-3 pb-3">
          <BulkAlbumTaxonsEditor
            remote={remote()!}
            albumIds={props.albumIds()}
            kinds={props.kinds?.()}
            onAfterMutate={props.onAfterMutate}
          />
        </div>
      </div>
    </Show>
  );
}

function SelectionPreview(p: { summary: GraphEditSelectionSummary }) {
  const items = () => {
    const out: string[] = [];
    for (const a of p.summary.artists.slice(0, 3)) out.push(a);
    for (const a of p.summary.albums.slice(0, 3)) out.push(a);
    return out;
  };
  const more = () => {
    const shown = Math.min(p.summary.artists.length, 3) + Math.min(p.summary.albums.length, 3);
    const total = p.summary.artists.length + p.summary.albums.length;
    return Math.max(0, total - shown);
  };
  return (
    <div class="mt-1 text-[11px] text-white/65 leading-tight">
      <For each={items()}>
        {(label, i) => (
          <>
            <Show when={i() > 0}>
              <span class="text-white/30">, </span>
            </Show>
            <span class="text-white/80">{label}</span>
          </>
        )}
      </For>
      <Show when={more() > 0}>
        <span class="text-white/45"> +{more()} more</span>
      </Show>
    </div>
  );
}

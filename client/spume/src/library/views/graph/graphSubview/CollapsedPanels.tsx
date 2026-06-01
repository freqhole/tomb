import { Show } from "solid-js";
import { Icon } from "../../../../components/icons/registry";
import type { AlbumNodeData, ArtistNodeData } from "../../../../components/graph/types";

export function CollapsedAlbumButton(props: { album: AlbumNodeData; onRestore: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onRestore}
      title={`${props.album.title ?? ""} — ${props.album.artistName ?? ""}`}
      class="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-[11px] text-white/80 hover:text-white hover:border-white/30 cursor-pointer pointer-events-auto max-w-[min(280px,calc(100%-1.5rem))]"
    >
      <Icon name="chevronUp" size={12} />
      <span class="truncate">{props.album.title ?? "album"}</span>
      <Show when={props.album.artistName}>
        <span class="text-white/40 truncate">— {props.album.artistName}</span>
      </Show>
    </button>
  );
}

export function CollapsedArtistButton(props: { artist: ArtistNodeData; onRestore: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onRestore}
      title={props.artist.name ?? "artist"}
      class="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-[11px] text-white/80 hover:text-white hover:border-white/30 cursor-pointer pointer-events-auto max-w-[min(280px,calc(100%-1.5rem))]"
    >
      <Icon name="chevronUp" size={12} />
      <span class="truncate">{props.artist.name ?? "artist"}</span>
    </button>
  );
}

export function CollapsedTaxonButton(props: {
  label: string;
  swatch: string | null;
  onRestore: () => void;
  pager?: {
    pageIndex: () => number;
    pageCount: () => number;
    consumed: () => number;
    total: () => number;
    canPrev: () => boolean;
    canNext: () => boolean;
    onPrev: () => void;
    onNext: () => void;
  };
}) {
  return (
    <div class="absolute bottom-3 left-3 z-10 inline-flex items-stretch rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm pointer-events-auto max-w-[min(360px,calc(100%-1.5rem))] overflow-hidden">
      <button
        type="button"
        onClick={props.onRestore}
        title={props.label}
        class="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] text-white/80 hover:text-white hover:bg-white/5 cursor-pointer min-w-0"
      >
        <Icon name="chevronUp" size={12} />
        <Show when={props.swatch}>
          <span
            class="inline-block w-3 h-3 rounded-sm border border-white/20 flex-shrink-0"
            style={{ background: props.swatch! }}
          />
        </Show>
        <span class="truncate">{props.label}</span>
      </button>
      <Show when={props.pager}>
        {(pagerAccessor) => {
          const p = pagerAccessor();
          return (
            <div class="flex items-center border-l border-white/10">
              <button
                type="button"
                class="w-6 h-full inline-flex items-center justify-center text-white/70 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="previous page"
                aria-label="previous page"
                disabled={!p.canPrev()}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onPrev();
                }}
              >
                ‹
              </button>
              <div class="px-1.5 text-center text-[10px] text-white/60 tabular-nums leading-tight border-x border-white/10">
                <div>
                  {p.pageIndex() + 1}/{p.pageCount()}
                </div>
                <div class="text-white/40">
                  {p.consumed()}/{p.total()}
                </div>
              </div>
              <button
                type="button"
                class="w-6 h-full inline-flex items-center justify-center text-white/70 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                title="next page"
                aria-label="next page"
                disabled={!p.canNext()}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onNext();
                }}
              >
                ›
              </button>
            </div>
          );
        }}
      </Show>
    </div>
  );
}

export function CollapsedRemoteButton(props: { label: string; onRestore: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onRestore}
      title={props.label}
      class="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-[11px] text-white/80 hover:text-white hover:border-white/30 cursor-pointer pointer-events-auto max-w-[min(280px,calc(100%-1.5rem))]"
    >
      <Icon name="chevronUp" size={12} />
      <span class="truncate">{props.label}</span>
    </button>
  );
}

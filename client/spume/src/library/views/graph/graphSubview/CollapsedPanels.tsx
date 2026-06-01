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
}) {
  return (
    <button
      type="button"
      onClick={props.onRestore}
      title={props.label}
      class="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm text-[11px] text-white/80 hover:text-white hover:border-white/30 cursor-pointer pointer-events-auto max-w-[min(280px,calc(100%-1.5rem))]"
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

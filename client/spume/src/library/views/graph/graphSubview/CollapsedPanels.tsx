import { Show } from "solid-js";
import { Icon, IconNames } from "../../../../components/icons/registry";
import { ActionButton } from "../../../../components/graph/AlbumDetailPopover";
import type { AlbumNodeData, ArtistNodeData } from "../../../../components/graph/types";

// shared classes for the collapsed-panel pill — a restore button (chevron
// + truncated title) paired with a row of icon-only quick-action buttons.
// the container is allowed to grow (up to a generous cap) so the actions
// get their own un-truncated space; the title still truncates via
// `min-w-0 truncate` on its own flex-1 slot when space is tight.
const PILL_CONTAINER_CLASS =
  "absolute bottom-3 left-3 z-10 inline-flex items-stretch rounded border border-white/15 bg-[var(--color-bg-elevated)]/90 backdrop-blur-sm pointer-events-auto max-w-[min(420px,calc(100%-1.5rem))] overflow-hidden";
const PILL_RESTORE_BUTTON_CLASS =
  "flex-1 min-w-0 inline-flex items-center gap-1.5 px-2 py-1 text-[11px] text-white/80 hover:text-white hover:bg-white/5 cursor-pointer";
const PILL_ACTIONS_ROW_CLASS =
  "shrink-0 flex items-center gap-0.5 pl-1 pr-1.5 border-l border-white/10";

export function CollapsedVideoButton(props: {
  title: string;
  onRestore: () => void;
  /** quick-action buttons — all optional, and vary by call site (plain
   *  video has no shuffle; video_series / video_season do). */
  onPlay?: () => void;
  onShuffle?: () => void;
  onAddToQueue?: () => void;
  onViewVideo?: () => void;
  isLoadingPlay?: boolean;
}) {
  return (
    <div class={PILL_CONTAINER_CLASS}>
      <button
        type="button"
        onClick={props.onRestore}
        title={props.title}
        class={PILL_RESTORE_BUTTON_CLASS}
      >
        <Icon name="chevronUp" size={12} />
        <span class="truncate">{props.title}</span>
      </button>
      <Show when={props.onPlay || props.onShuffle || props.onAddToQueue || props.onViewVideo}>
        <div class={PILL_ACTIONS_ROW_CLASS}>
          <Show when={props.onPlay}>
            <ActionButton
              icon={props.isLoadingPlay ? IconNames.loader : IconNames.play}
              label={props.isLoadingPlay ? "loading..." : "play"}
              onClick={() => !props.isLoadingPlay && props.onPlay?.()}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onShuffle}>
            <ActionButton
              icon={IconNames.shuffle}
              label="shuffle"
              iconOnly
              onClick={() => !props.isLoadingPlay && props.onShuffle?.()}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onAddToQueue}>
            <ActionButton
              icon={IconNames.queue}
              label="queue"
              iconOnly
              onClick={() => !props.isLoadingPlay && props.onAddToQueue?.()}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onViewVideo}>
            <ActionButton
              icon={IconNames.video}
              label="open"
              iconOnly
              onClick={() => props.onViewVideo?.()}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

export function CollapsedAlbumButton(props: {
  album: AlbumNodeData;
  onRestore: () => void;
  onPlay?: () => void;
  onShuffle?: () => void;
  onAddToQueue?: () => void;
  onViewAlbum?: () => void;
  isLoadingPlay?: boolean;
}) {
  return (
    <div class={PILL_CONTAINER_CLASS}>
      <button
        type="button"
        onClick={props.onRestore}
        title={`${props.album.title ?? ""} — ${props.album.artistName ?? ""}`}
        class={PILL_RESTORE_BUTTON_CLASS}
      >
        <Icon name="chevronUp" size={12} />
        <span class="truncate">{props.album.title ?? "album"}</span>
        <Show when={props.album.artistName}>
          <span class="text-white/40 truncate">— {props.album.artistName}</span>
        </Show>
      </button>
      <Show when={props.onPlay || props.onShuffle || props.onAddToQueue || props.onViewAlbum}>
        <div class={PILL_ACTIONS_ROW_CLASS}>
          <Show when={props.onPlay}>
            <ActionButton
              icon={props.isLoadingPlay ? IconNames.loader : IconNames.play}
              label={props.isLoadingPlay ? "loading..." : "play"}
              onClick={() => !props.isLoadingPlay && props.onPlay?.()}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onShuffle}>
            <ActionButton
              icon={IconNames.shuffle}
              label="shuffle"
              iconOnly
              onClick={() => !props.isLoadingPlay && props.onShuffle?.()}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onAddToQueue}>
            <ActionButton
              icon={IconNames.queue}
              label="queue"
              iconOnly
              onClick={() => !props.isLoadingPlay && props.onAddToQueue?.()}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onViewAlbum}>
            <ActionButton
              icon={IconNames.album}
              label="open"
              iconOnly
              onClick={() => props.onViewAlbum?.()}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

export function CollapsedArtistButton(props: {
  artist: ArtistNodeData;
  onRestore: () => void;
  onPlay?: () => void;
  onShuffle?: () => void;
  onAddToQueue?: () => void;
  onViewArtist?: () => void;
  isLoadingPlay?: boolean;
}) {
  return (
    <div class={PILL_CONTAINER_CLASS}>
      <button
        type="button"
        onClick={props.onRestore}
        title={props.artist.name ?? "artist"}
        class={PILL_RESTORE_BUTTON_CLASS}
      >
        <Icon name="chevronUp" size={12} />
        <span class="truncate">{props.artist.name ?? "artist"}</span>
      </button>
      <Show when={props.onPlay || props.onShuffle || props.onAddToQueue || props.onViewArtist}>
        <div class={PILL_ACTIONS_ROW_CLASS}>
          <Show when={props.onPlay}>
            <ActionButton
              icon={props.isLoadingPlay ? IconNames.loader : IconNames.play}
              label={props.isLoadingPlay ? "loading..." : "play"}
              onClick={() => !props.isLoadingPlay && props.onPlay?.()}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onShuffle}>
            <ActionButton
              icon={IconNames.shuffle}
              label="shuffle"
              iconOnly
              onClick={() => !props.isLoadingPlay && props.onShuffle?.()}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onAddToQueue}>
            <ActionButton
              icon={IconNames.queue}
              label="queue"
              iconOnly
              onClick={() => !props.isLoadingPlay && props.onAddToQueue?.()}
              disabled={props.isLoadingPlay}
            />
          </Show>
          <Show when={props.onViewArtist}>
            <ActionButton
              icon={IconNames.artist}
              label="open"
              iconOnly
              onClick={() => props.onViewArtist?.()}
            />
          </Show>
        </div>
      </Show>
    </div>
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

export function CollapsedRemoteButton(props: {
  label: string;
  onRestore: () => void;
  onBrowse?: () => void;
  onBrowseVideo?: () => void;
}) {
  return (
    <div class={PILL_CONTAINER_CLASS}>
      <button
        type="button"
        onClick={props.onRestore}
        title={props.label}
        class={PILL_RESTORE_BUTTON_CLASS}
      >
        <Icon name="chevronUp" size={12} />
        <span class="truncate">{props.label}</span>
      </button>
      <Show when={props.onBrowse || props.onBrowseVideo}>
        <div class={PILL_ACTIONS_ROW_CLASS}>
          <Show when={props.onBrowse}>
            <ActionButton
              icon={IconNames.album}
              label="browse albums"
              iconOnly
              onClick={() => props.onBrowse?.()}
            />
          </Show>
          <Show when={props.onBrowseVideo}>
            <ActionButton
              icon={IconNames.video}
              label="browse video"
              iconOnly
              onClick={() => props.onBrowseVideo?.()}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

import { createSignal, For, Show, Switch, Match } from "solid-js";
import type { MusicReference } from "../../../stories/gossip/mockGossipData";
import { MusicIcon, PlayIcon } from "../icons/registry";
import { AlbumIcon, ArtistIcon, PlaylistIcon, GenreIcon } from "../icons/navigation";
import { entityColors } from "../../design-system/colors";

export interface MusicRefCardProps {
  item: MusicReference;
  onPlay?: (item: MusicReference) => void;
  onKnock?: (item: MusicReference) => void;
  onFavorite?: (item: MusicReference) => void;
  onAddToQueue?: (item: MusicReference) => void;
  onAddToPlaylist?: (item: MusicReference) => void;
  /** whether the current user has access to this remote */
  hasAccess?: boolean;
}

/** format seconds as h:mm:ss or m:ss */
function fmtDuration(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** map ref_type to entityColors key */
function typeColor(refType: string): string {
  const map: Record<string, string> = {
    Song: entityColors.song,
    Album: entityColors.album,
    Artist: entityColors.artist,
    Playlist: entityColors.playlist,
    Genre: entityColors.genre,
  };
  return map[refType] ?? "var(--color-text-tertiary)";
}

/** render a music reference card for gossip messages */
export function MusicRefCard(props: MusicRefCardProps) {
  const typeLabel = () => props.item.ref_type.toLowerCase();
  const hasAccess = () => props.hasAccess ?? true;
  const [favorited, setFavorited] = createSignal(false);
  const [showMenu, setShowMenu] = createSignal(false);
  const [isHovered, setIsHovered] = createSignal(false);

  const handleFavorite = (e: MouseEvent) => {
    e.stopPropagation();
    setFavorited((v) => !v);
    props.onFavorite?.(props.item);
  };

  const handleMenuAction = (action: string) => {
    setShowMenu(false);
    if (action === "queue") props.onAddToQueue?.(props.item);
    if (action === "playlist") props.onAddToPlaylist?.(props.item);
  };

  return (
    <div
      class="flex gap-3 p-2 rounded-lg bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-tertiary)] transition-colors group min-w-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowMenu(false);
      }}
    >
      {/* thumbnail — doubles as play button on hover */}
      <div
        class="w-[88px] h-[88px] rounded-md bg-[var(--color-bg-tertiary)] flex-shrink-0 flex items-center justify-center overflow-hidden relative cursor-pointer"
        onClick={() => (hasAccess() ? props.onPlay?.(props.item) : props.onKnock?.(props.item))}
      >
        <Show
          when={props.item.thumbnail_url || props.item.thumbnails.length > 0}
          fallback={
            <span style={{ color: typeColor(props.item.ref_type) }}>
              <Switch>
                <Match when={props.item.ref_type === "Song"}>
                  <MusicIcon size={32} />
                </Match>
                <Match when={props.item.ref_type === "Album"}>
                  <AlbumIcon size={32} />
                </Match>
                <Match when={props.item.ref_type === "Artist"}>
                  <ArtistIcon size={32} />
                </Match>
                <Match when={props.item.ref_type === "Playlist"}>
                  <PlaylistIcon size={32} />
                </Match>
                <Match when={props.item.ref_type === "Genre"}>
                  <GenreIcon size={32} />
                </Match>
              </Switch>
            </span>
          }
        >
          <img
            src={props.item.thumbnail_url ?? `data:image/webp;base64,${props.item.thumbnails[0]}`}
            alt=""
            class="w-full h-full object-cover"
            loading="lazy"
          />
        </Show>
        {/* play overlay on hover */}
        <Show when={hasAccess()}>
          <div
            class="absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity rounded-md"
            style={{ opacity: isHovered() ? "1" : "0" }}
          >
            <div class="w-10 h-10 rounded-full bg-[var(--color-accent-500)] flex items-center justify-center">
              <PlayIcon size={18} />
            </div>
          </div>
        </Show>
        <Show when={!hasAccess()}>
          <div
            class="absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity rounded-md"
            style={{ opacity: isHovered() ? "1" : "0" }}
          >
            <span class="text-xs font-medium text-[var(--color-accent-500)]">knock</span>
          </div>
        </Show>
      </div>

      {/* info */}
      <div class="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        {/* type badge */}
        <div class="flex items-center gap-2">
          <span
            class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium"
            style={{
              color: typeColor(props.item.ref_type),
              "background-color": `color-mix(in srgb, ${typeColor(props.item.ref_type)} 15%, transparent)`,
            }}
          >
            {typeLabel()}
          </span>
          <Show when={props.item.source_name}>
            <span class="text-[10px] text-[var(--color-text-tertiary)] truncate">
              from {props.item.source_name}
            </span>
          </Show>
        </div>

        <Switch>
          <Match when={props.item.ref_type === "Song"}>
            <div class="text-sm text-[var(--color-text-primary)] font-medium truncate leading-tight">
              {props.item.title}
            </div>
            <div class="text-xs text-[var(--color-text-secondary)] truncate">
              {props.item.track_artist}
              <Show when={props.item.album_title}>
                <span class="text-[var(--color-text-tertiary)]"> · {props.item.album_title}</span>
              </Show>
            </div>
            <div class="text-[11px] text-[var(--color-text-tertiary)] truncate flex items-center gap-1.5">
              <Show when={props.item.duration}>
                <span>{fmtDuration(props.item.duration!)}</span>
              </Show>
              <Show when={props.item.track_number}>
                <span>track {props.item.track_number}</span>
              </Show>
            </div>
          </Match>

          <Match when={props.item.ref_type === "Album"}>
            <div class="text-sm text-[var(--color-text-primary)] font-medium truncate leading-tight">
              {props.item.title}
            </div>
            <div class="text-xs text-[var(--color-text-secondary)] truncate">
              {props.item.artist_name}
              <Show when={props.item.release_date}>
                <span class="text-[var(--color-text-tertiary)]">
                  {" "}
                  · {props.item.release_date?.slice(0, 4)}
                </span>
              </Show>
            </div>
            <div class="text-[11px] text-[var(--color-text-tertiary)] truncate flex items-center gap-1.5">
              <Show when={props.item.song_count}>
                <span>{props.item.song_count} tracks</span>
              </Show>
              <Show when={props.item.total_duration}>
                <span>{fmtDuration(props.item.total_duration!)}</span>
              </Show>
              <Show when={props.item.album_type}>
                <span>{props.item.album_type}</span>
              </Show>
            </div>
            <Show when={props.item.genres && props.item.genres!.length > 0}>
              <div class="flex flex-wrap gap-1 mt-0.5">
                <For each={props.item.genres!.slice(0, 3)}>
                  {(genre) => (
                    <span class="text-[10px] px-1.5 py-px rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]">
                      {genre}
                    </span>
                  )}
                </For>
              </div>
            </Show>
          </Match>

          <Match when={props.item.ref_type === "Artist"}>
            <div class="text-sm text-[var(--color-text-primary)] font-medium truncate leading-tight">
              {props.item.name}
            </div>
            <Show when={props.item.bio}>
              <div class="text-xs text-[var(--color-text-secondary)] line-clamp-2">
                {props.item.bio}
              </div>
            </Show>
          </Match>

          <Match when={props.item.ref_type === "Playlist"}>
            <div class="text-sm text-[var(--color-text-primary)] font-medium truncate leading-tight">
              {props.item.title}
            </div>
            <Show when={props.item.description}>
              <div class="text-xs text-[var(--color-text-secondary)] truncate">
                {props.item.description}
              </div>
            </Show>
            <div class="text-[11px] text-[var(--color-text-tertiary)] truncate flex items-center gap-1.5">
              <Show when={props.item.song_count}>
                <span>{props.item.song_count} songs</span>
              </Show>
              <Show when={props.item.duration}>
                <span>{fmtDuration(props.item.duration!)}</span>
              </Show>
            </div>
          </Match>

          <Match when={props.item.ref_type === "Genre"}>
            <div class="text-sm text-[var(--color-text-primary)] font-medium truncate leading-tight">
              {props.item.name}
            </div>
            <div class="text-xs text-[var(--color-text-secondary)]">genre</div>
          </Match>
        </Switch>
      </div>

      {/* actions column: favorite + context menu */}
      <div class="flex flex-col items-center justify-center gap-2 flex-shrink-0 w-8">
        <button
          class="w-7 h-7 flex items-center justify-center rounded-full transition-colors"
          classList={{
            "text-red-500": favorited(),
            "text-[var(--color-text-tertiary)] hover:text-red-400": !favorited(),
          }}
          onClick={handleFavorite}
          title={favorited() ? "unfavorite" : "favorite"}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill={favorited() ? "currentColor" : "none"}
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
        <div class="relative">
          <button
            class="w-7 h-7 flex items-center justify-center rounded-full text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu((v) => !v);
            }}
            title="more actions"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <line x1="12" y1="5" x2="12" y2="5.01" />
              <line x1="12" y1="12" x2="12" y2="12.01" />
              <line x1="12" y1="19" x2="12" y2="19.01" />
            </svg>
          </button>
          <Show when={showMenu()}>
            <div class="absolute right-0 top-8 z-50 w-40 py-1 rounded-lg bg-[var(--color-bg-elevated)] shadow-lg border border-[var(--color-border-primary)]">
              <button
                class="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                onClick={() => handleMenuAction("queue")}
              >
                add to queue
              </button>
              <button
                class="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                onClick={() => handleMenuAction("playlist")}
              >
                add to playlist...
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

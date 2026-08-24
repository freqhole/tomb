// video card — mirrors CollectionCard's shape (see
// components/cards/CollectionCard.tsx) but simplified for the video MVP:
// poster thumbnail, title, duration, and an "E{n}" episode badge when
// available. no favorite toggle / genres row (not in scope for this pass).
import { createEffect, createSignal, JSX, onCleanup, Show, type Accessor } from "solid-js";
import { PlayIcon } from "../../components/icons/registry";
import { MediaImage } from "../../components/media/MediaImage";
import { MarqueeText } from "../../components/text/MarqueeText";
import { formatDuration } from "../../utils/formatDuration";
import { readVideoPosterFromOPFS } from "../services/opfs/helpers";
import type { VideoSummary } from "../data/types";

/** resolves a local (opfs-backed) poster path to an object url, revoking
 * the previous url whenever the path changes or the component unmounts. */
export function useLocalVideoPosterUrl(
  path: Accessor<string | null | undefined>
): Accessor<string | null> {
  const [url, setUrl] = createSignal<string | null>(null);

  createEffect(() => {
    const p = path();
    if (!p) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void readVideoPosterFromOPFS(p)
      .then((file) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    onCleanup(() => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    });
  });

  return url;
}

export interface VideoCardProps {
  video: VideoSummary;
  size?: "small" | "medium" | "large";
  onClick?: (video: VideoSummary) => void;
  onPlay?: (video: VideoSummary) => void;
  class?: string;
}

export function VideoCard(props: VideoCardProps): JSX.Element {
  const localPosterUrl = useLocalVideoPosterUrl(() =>
    props.video.source_type === "local" ? props.video.poster_opfs_path : null
  );

  const badge = () =>
    props.video.episode_number != null ? `E${props.video.episode_number}` : null;

  const titleClass = () =>
    props.size === "large"
      ? "text-sm font-medium leading-tight"
      : "text-xs font-medium leading-tight";
  const metaClass = "text-xs leading-tight";

  const handleClick = () => props.onClick?.(props.video);
  const handlePlay = (e: MouseEvent) => {
    e.stopPropagation();
    props.onPlay?.(props.video);
  };

  return (
    <div class={`group cursor-pointer flex flex-col ${props.class || ""}`} onClick={handleClick}>
      {/* poster area */}
      <div class="w-full aspect-square bg-[var(--color-bg-base)] rounded-lg mb-2 relative overflow-hidden transition-all duration-300 group-hover:rounded-none">
        <Show
          when={props.video.source_type === "remote"}
          fallback={
            <Show
              when={localPosterUrl()}
              fallback={
                <div class="w-full h-full flex items-center justify-center text-[var(--color-text-tertiary)]">
                  <PlayIcon size={28} />
                </div>
              }
            >
              {(url) => (
                <img src={url()} alt={props.video.title} class="w-full h-full object-cover" />
              )}
            </Show>
          }
        >
          <MediaImage
            remoteBlobId={props.video.poster_blob_id}
            remoteServerId={props.video.remote_server_id}
            alt={props.video.title}
            showFallback={true}
            thumbnailSize={200}
            class="w-full h-full rounded-lg group-hover:rounded-none"
          />
        </Show>

        <Show when={badge()}>
          <span class="absolute top-2 left-2 z-10 px-1.5 py-0.5 text-[10px] font-medium rounded bg-black/60 text-white">
            {badge()}
          </span>
        </Show>

        {/* hover overlay with play button - z-40 keeps it above MediaImage's
            internal layers (fallback icon z-20 / loaded img z-30), which
            otherwise intercept clicks meant for this button since they carry
            explicit z-index while this overlay previously had none (auto) */}
        <div class="absolute inset-0 z-40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            class="w-12 h-12 rounded-full bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-400)] text-[var(--color-text-on-accent)] flex items-center justify-center transition-colors"
            onClick={handlePlay}
            title="play video"
          >
            <PlayIcon size={24} className="ml-1" />
          </button>
        </div>
      </div>

      {/* title + duration */}
      <div class="space-y-0.5 min-w-0">
        <MarqueeText
          text={props.video.title}
          class={`text-[var(--color-text-primary)] ${titleClass()} group-hover:text-[var(--color-accent-500)] transition-colors`}
        />
        <Show when={props.video.duration_seconds != null}>
          <div class={`text-[var(--color-text-tertiary)]/65 ${metaClass}`}>
            {formatDuration(props.video.duration_seconds)}
          </div>
        </Show>
      </div>
    </div>
  );
}

export default VideoCard;

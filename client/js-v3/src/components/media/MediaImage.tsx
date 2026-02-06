import { createEffect, createMemo, createSignal, JSX, on, Show } from "solid-js";
import { getBlobObjectURL } from "../../music/services/storage/blobs";
import type { ImageMetadata } from "../../music/services/storage/types";
import { Icon } from "../icons/registry";

// inject pan animation styles once globally
let panStylesInjected = false;
function injectPanStyles() {
  if (panStylesInjected) return;
  panStylesInjected = true;
  const style = document.createElement("style");
  style.id = "media-image-pan-styles";
  style.textContent = `
    @keyframes pan-image {
      0%, 100% { object-position: center top; }
      50% { object-position: center bottom; }
    }
    .group:hover .pan-on-hover img {
      animation: pan-image 4s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
}

// handle IDB data that may have 'type' instead of 'blob_type'
type ImageData = ImageMetadata & { type?: string };

function pickBestImage(images?: ImageData[]): ImageData | null {
  if (!images || images.length === 0) return null;

  // spread to unwrap SolidJS store proxies
  const arr = [...images];
  if (arr.length === 0) return null;

  const getType = (img: ImageData) => img.blob_type || img.type;

  // priority: primary thumbnail/original → any thumbnail → any original → waveform
  const primary = arr.find(
    (img) => img.is_primary && (getType(img) === "thumbnail" || getType(img) === "original")
  );
  if (primary) return primary;

  const thumbnail = arr.find((img) => getType(img) === "thumbnail");
  if (thumbnail) return thumbnail;

  const original = arr.find((img) => getType(img) === "original");
  if (original) return original;

  // fallback to waveform as last resort
  const waveform = arr.find((img) => getType(img) === "waveform");
  if (waveform) return waveform;

  // fallback to first available
  return arr[0] || null;
}

interface MediaImageProps {
  images?: ImageMetadata[];
  blobId?: string | null;
  imageUrl?: string | null;
  alt: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  class?: string;
  enableAlbumHover?: boolean;
  showFallback?: boolean;
  domainType?: "song" | "album" | "artist" | "genre" | "playlist";
}

export function MediaImage(props: MediaImageProps): JSX.Element {
  // inject pan animation styles on first use
  if (props.enableAlbumHover) {
    injectPanStyles();
  }

  // compute initial image source synchronously to avoid first-render flicker
  const getInitialSource = () => {
    const bestImage = pickBestImage(props.images as ImageData[]);
    const blobId = bestImage?.local_blob_id || props.blobId;
    const remoteUrl = bestImage?.remote_url || props.imageUrl;
    return { blobId, remoteUrl };
  };
  const initialSource = getInitialSource();

  // initialize resolvedUrl with remoteUrl if no blobId needs async lookup
  const initialUrl =
    !initialSource.blobId && initialSource.remoteUrl ? initialSource.remoteUrl : null;

  const [imageError, setImageError] = createSignal(false);
  const [imageLoaded, setImageLoaded] = createSignal(false);
  const [resolvedUrl, setResolvedUrl] = createSignal<string | null>(initialUrl);
  const [isLoading, setIsLoading] = createSignal(initialSource.blobId ? true : false);

  // compute the image source (blobId or url) - this is what we actually track
  const imageSource = createMemo(() => {
    const bestImage = pickBestImage(props.images as ImageData[]);
    const blobId = bestImage?.local_blob_id || props.blobId;
    const remoteUrl = bestImage?.remote_url || props.imageUrl;
    return { blobId, remoteUrl };
  });

  // only re-run when blobId or remoteUrl actually changes (not when array reference changes)
  createEffect(
    on(
      () => ({ blobId: imageSource().blobId, remoteUrl: imageSource().remoteUrl }),
      (source, prevSource) => {
        // skip if nothing actually changed
        if (
          prevSource &&
          source.blobId === prevSource.blobId &&
          source.remoteUrl === prevSource.remoteUrl
        ) {
          return;
        }

        // only clear the current image if we're switching to a different source
        // this prevents flicker when the same image is being reloaded
        if (source.blobId) {
          setIsLoading(true);
          getBlobObjectURL(source.blobId).then((objectUrl) => {
            if (objectUrl) {
              setResolvedUrl(objectUrl);
            } else {
              setResolvedUrl(null);
            }
            setIsLoading(false);
          });
        } else if (source.remoteUrl) {
          setResolvedUrl(source.remoteUrl);
          setIsLoading(false);
        } else {
          setResolvedUrl(null);
          setIsLoading(false);
        }
      },
      { defer: false }
    )
  );

  createEffect((prev) => {
    const url = resolvedUrl();
    if (url !== prev) {
      setImageError(false);
      setImageLoaded(false);
    }
    return url;
  });

  // note: blob URL cleanup is handled by the blobs.ts cache, no need to cleanup here

  const getSizeClasses = (): string => {
    switch (props.size) {
      case "xs":
        return "w-8 h-8";
      case "sm":
        return "w-12 h-12";
      case "md":
        return "w-16 h-16";
      case "lg":
        return "w-24 h-24";
      case "xl":
        return "w-32 h-32";
      default:
        return "";
    }
  };

  const getFallbackIcon = () => {
    const iconProps = { class: "w-12 h-12" };
    switch (props.domainType) {
      case "song":
        return <Icon name="music" {...iconProps} />;
      case "album":
        return <Icon name="album" {...iconProps} />;
      case "artist":
        return <Icon name="artist" {...iconProps} />;
      case "genre":
        return <Icon name="genre" {...iconProps} />;
      case "playlist":
        return <Icon name="playlist" {...iconProps} />;
      default:
        return <Icon name="music" {...iconProps} />;
    }
  };

  const shouldShowFallbackIcon = () => {
    return props.showFallback !== false && !imageLoaded() && (imageError() || !resolvedUrl());
  };

  return (
    <div
      class={`relative overflow-hidden bg-gray-800/50 flex items-center justify-center ${
        props.enableAlbumHover
          ? "transition-transform duration-300 group-hover:scale-105 pan-on-hover"
          : ""
      } ${getSizeClasses()} ${props.class || ""}`}
    >
      <Show when={isLoading()}>
        <div class="absolute inset-0 bg-gray-700/30 animate-pulse z-10" />
      </Show>

      <Show when={shouldShowFallbackIcon()}>
        <div class="absolute inset-0 flex items-center justify-center text-gray-400 z-20">
          {getFallbackIcon()}
        </div>
      </Show>

      <Show when={resolvedUrl()}>
        <img
          src={resolvedUrl()!}
          alt={props.alt}
          class="absolute inset-0 w-full h-full object-cover z-30"
          onLoad={() => {
            setImageLoaded(true);
            setImageError(false);
          }}
          onError={() => {
            setImageError(true);
            setImageLoaded(false);
          }}
        />
      </Show>
    </div>
  );
}

export default MediaImage;

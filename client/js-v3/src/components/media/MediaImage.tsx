import { createEffect, createSignal, JSX, Show, onCleanup } from "solid-js";
import { getBlobObjectURL } from "../../music/services/storage/blobs";
import type { ImageMetadata } from "../../music/services/storage/types";
import { Icon } from "../icons/registry";

function pickBestImage(images?: ImageMetadata[]): ImageMetadata | null {
  if (!images || images.length === 0) return null;
  const primary = images.find(img => img.is_primary && img.type === 'thumbnail');
  if (primary) return primary;
  const thumbnail = images.find(img => img.type === 'thumbnail');
  if (thumbnail) return thumbnail;
  return images[0];
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
  const [imageError, setImageError] = createSignal(false);
  const [imageLoaded, setImageLoaded] = createSignal(false);
  const [resolvedUrl, setResolvedUrl] = createSignal<string | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  
  let blobUrlToCleanup: string | null = null;
  
  createEffect(() => {
    const bestImage = pickBestImage(props.images);
    const blobId = bestImage?.local_blob_id || props.blobId;
    const remoteUrl = bestImage?.remote_url || props.imageUrl;
    
    if (blobUrlToCleanup) {
      URL.revokeObjectURL(blobUrlToCleanup);
      blobUrlToCleanup = null;
    }
    
    setResolvedUrl(null);
    
    if (blobId) {
      setIsLoading(true);
      getBlobObjectURL(blobId).then(blob => {
        if (blob) {
          const newBlobUrl = URL.createObjectURL(blob);
          blobUrlToCleanup = newBlobUrl;
          setResolvedUrl(newBlobUrl);
        }
        setIsLoading(false);
      });
    } else if (remoteUrl) {
      setResolvedUrl(remoteUrl);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  });
  
  createEffect((prev) => {
    const url = resolvedUrl();
    if (url !== prev) {
      setImageError(false);
      setImageLoaded(false);
    }
    return url;
  });
  
  onCleanup(() => {
    if (blobUrlToCleanup) {
      URL.revokeObjectURL(blobUrlToCleanup);
    }
  });

  const getSizeClasses = (): string => {
    switch (props.size) {
      case "xs": return "w-8 h-8";
      case "sm": return "w-12 h-12";
      case "md": return "w-16 h-16";
      case "lg": return "w-24 h-24";
      case "xl": return "w-32 h-32";
      default: return "";
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
        props.enableAlbumHover ? "bg-cover transition-all duration-300 group-hover:bg-contain group-hover:scale-105" : ""
      } ${getSizeClasses()} ${props.class || ""}`}
      style={{
        "background-image": resolvedUrl() && !imageError() && imageLoaded() ? `url(${resolvedUrl()})` : undefined,
        "background-size": "cover",
        "background-position": "center",
        "background-repeat": "no-repeat",
      }}
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
          class={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 z-30 ${
            imageLoaded() && !imageError() ? "opacity-100" : "opacity-0"
          }`}
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

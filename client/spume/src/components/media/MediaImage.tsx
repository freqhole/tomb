import { createEffect, createMemo, createSignal, JSX, on, Show } from "solid-js";
import { getBlobObjectURL, getCachedBlobObjectURL } from "../../music/services/storage/blobs";
import {
  resolveBlobUrl,
  isP2PRemote,
  getCachedP2PBlobUrl,
} from "../../music/services/storage/blobResolver";
import type { ImageMetadata } from "../../music/services/storage/types";
import { pickBestImage } from "../../utils/images";
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
  onError?: () => void;
  onLoad?: () => void;
}

export function MediaImage(props: MediaImageProps): JSX.Element {
  // inject pan animation styles on first use
  if (props.enableAlbumHover) {
    injectPanStyles();
  }

  // compute initial image source synchronously to avoid first-render flicker
  const getInitialSource = () => {
    const bestImage = pickBestImage(props.images);
    const blobId = bestImage?.local_blob_id || props.blobId;
    const remoteUrl = bestImage?.remote_url || props.imageUrl;
    const remoteBlobId = bestImage?.remote_blob_id;
    const remoteServerId = bestImage?.remote_server_id;
    return { blobId, remoteUrl, remoteBlobId, remoteServerId };
  };
  const initialSource = getInitialSource();

  // compute initial URL synchronously:
  // - local blob: check OPFS cache
  // - P2P: check activeBlobUrls cache
  // - HTTP: use URL directly
  const getInitialUrl = (): string | null => {
    // priority 1: local blob (OPFS cache)
    if (initialSource.blobId) {
      return getCachedBlobObjectURL(initialSource.blobId);
    }
    // priority 2: P2P remote - check sync cache
    if (initialSource.remoteBlobId && initialSource.remoteServerId) {
      return getCachedP2PBlobUrl(initialSource.remoteBlobId, initialSource.remoteServerId);
    }
    // priority 3: HTTP remote URL
    if (initialSource.remoteUrl) {
      return initialSource.remoteUrl;
    }
    return null;
  };
  const initialUrl = getInitialUrl();

  const [imageError, setImageError] = createSignal(false);
  const [imageLoaded, setImageLoaded] = createSignal(false);
  const [resolvedUrl, setResolvedUrl] = createSignal<string | null>(initialUrl);
  // only need async loading if we have a source but no cached URL
  const [isLoading, setIsLoading] = createSignal(
    (initialSource.blobId || initialSource.remoteServerId) && !initialUrl
  );

  // compute the image source (blobId or url) - this is what we actually track
  const imageSource = createMemo(() => {
    const bestImage = pickBestImage(props.images);
    const blobId = bestImage?.local_blob_id || props.blobId;
    const remoteUrl = bestImage?.remote_url || props.imageUrl;
    const remoteBlobId = bestImage?.remote_blob_id;
    const remoteServerId = bestImage?.remote_server_id;
    return { blobId, remoteUrl, remoteBlobId, remoteServerId };
  });

  // only re-run when source properties actually change (not when array reference changes)
  createEffect(
    on(
      () => ({
        blobId: imageSource().blobId,
        remoteUrl: imageSource().remoteUrl,
        remoteBlobId: imageSource().remoteBlobId,
        remoteServerId: imageSource().remoteServerId,
      }),
      async (source, prevSource) => {
        // skip if nothing actually changed
        if (
          prevSource &&
          source.blobId === prevSource.blobId &&
          source.remoteUrl === prevSource.remoteUrl &&
          source.remoteBlobId === prevSource.remoteBlobId &&
          source.remoteServerId === prevSource.remoteServerId
        ) {
          return;
        }

        // priority 1: local blob ID (from OPFS)
        if (source.blobId) {
          setIsLoading(true);
          try {
            const objectUrl = await getBlobObjectURL(source.blobId);
            setResolvedUrl(objectUrl ?? null);
          } catch {
            setResolvedUrl(null);
          }
          setIsLoading(false);
          return;
        }

        // priority 2: P2P remote (has remote_server_id)
        if (source.remoteBlobId && source.remoteServerId) {
          setIsLoading(true);
          try {
            // check if this remote uses P2P transport
            const isP2P = await isP2PRemote(source.remoteServerId);
            if (isP2P) {
              const url = await resolveBlobUrl(source.remoteBlobId, source.remoteServerId);
              setResolvedUrl(url);
            } else {
              // HTTP remote - use the remote_url directly
              setResolvedUrl(source.remoteUrl ?? null);
            }
          } catch (err) {
            console.error("failed to resolve P2P image:", err);
            setResolvedUrl(null);
          }
          setIsLoading(false);
          return;
        }

        // priority 3: HTTP remote URL
        if (source.remoteUrl) {
          setResolvedUrl(source.remoteUrl);
          setIsLoading(false);
          return;
        }

        // no source
        setResolvedUrl(null);
        setIsLoading(false);
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
          class={`${props.class || ""} "absolute inset-0 w-full h-full object-cover z-30"`}
          onLoad={() => {
            setImageLoaded(true);
            setImageError(false);
            props.onLoad?.();
          }}
          onError={() => {
            setImageError(true);
            setImageLoaded(false);
            props.onError?.();
          }}
        />
      </Show>
    </div>
  );
}

export default MediaImage;

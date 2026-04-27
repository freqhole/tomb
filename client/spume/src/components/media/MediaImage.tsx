import { createEffect, createMemo, createSignal, JSX, on, Show } from "solid-js";
import {
  getCachedP2PBlobUrl,
  isP2PRemoteSync,
  resolveBlobUrl,
  type ThumbnailSize,
} from "../../music/services/storage/blobResolver";
import { getBlobObjectURL, getCachedBlobObjectURL } from "../../music/services/storage/blobs";
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
  /** remote blob id for P2P fetch (use with remoteServerId) */
  remoteBlobId?: string | null;
  /** remote server id for P2P fetch (typically peer_addr) */
  remoteServerId?: string | null;
  alt: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** request a specific thumbnail size (50 or 200px) instead of original */
  thumbnailSize?: ThumbnailSize;
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

  const withThumb = (url: string, size?: ThumbnailSize): string => {
    if (!size) return url;
    const lower = url.toLowerCase();
    // blob/data/asset urls are already concrete objects and cannot serve
    // `/thumb/:size` paths.
    if (lower.startsWith("blob:") || lower.startsWith("data:") || lower.startsWith("asset://")) {
      return url;
    }
    // known external placeholder/image services don't support our `/thumb/:size`
    // path convention — they're already-resolved image urls. used by storybook
    // demos and any consumer passing in third-party image urls.
    if (
      lower.includes("picsum.photos") ||
      lower.includes("placehold.co") ||
      lower.includes("placekitten.com") ||
      lower.includes("images.unsplash.com")
    ) {
      return url;
    }
    return `${url}/thumb/${size}`;
  };

  // compute initial image source synchronously to avoid first-render flicker
  const getInitialSource = () => {
    const bestImage = pickBestImage(props.images);
    const blobId = bestImage?.local_blob_id || props.blobId;
    const remoteUrl = bestImage?.remote_url || props.imageUrl;
    const remoteBlobId = bestImage?.remote_blob_id || props.remoteBlobId;
    const remoteServerId = bestImage?.remote_server_id || props.remoteServerId;
    return { blobId, remoteUrl, remoteBlobId, remoteServerId };
  };
  const initialSource = getInitialSource();

  // compute initial URL synchronously:
  // - local blob: check OPFS cache
  // - remote: check transport type to decide HTTP vs P2P path
  const getInitialUrl = (): string | null => {
    const thumbSize = props.thumbnailSize;
    // priority 1: local blob (OPFS cache) - thumbnails not supported locally yet
    if (initialSource.blobId) {
      return getCachedBlobObjectURL(initialSource.blobId);
    }
    // priority 2: remote with server ID - check transport type
    if (initialSource.remoteBlobId && initialSource.remoteServerId) {
      const isP2P = isP2PRemoteSync(initialSource.remoteServerId);
      if (isP2P === true) {
        // known P2P remote - check blob cache only
        return getCachedP2PBlobUrl(
          initialSource.remoteBlobId,
          initialSource.remoteServerId,
          thumbSize
        );
      } else if (isP2P === false) {
        // known HTTP remote - use URL directly
        if (initialSource.remoteUrl) {
          return withThumb(initialSource.remoteUrl, thumbSize);
        }
      }
      // unknown transport (isP2P === undefined) - try P2P cache, else use URL optimistically
      const cached = getCachedP2PBlobUrl(
        initialSource.remoteBlobId,
        initialSource.remoteServerId,
        thumbSize
      );
      if (cached) return cached;
      // no P2P cache - use remote_url if available (works for HTTP, async will handle P2P)
      if (initialSource.remoteUrl) {
        return withThumb(initialSource.remoteUrl, thumbSize);
      }
      return null;
    }
    // priority 3: just remote URL (no server ID) - use directly
    if (initialSource.remoteUrl) {
      return withThumb(initialSource.remoteUrl, thumbSize);
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
    const remoteBlobId = bestImage?.remote_blob_id || props.remoteBlobId;
    const remoteServerId = bestImage?.remote_server_id || props.remoteServerId;
    return { blobId, remoteUrl, remoteBlobId, remoteServerId };
  });

  // track P2P cached URL reactively - will update when pre-caching completes
  const p2pCachedUrl = createMemo(() => {
    const source = imageSource();
    if (source.remoteBlobId && source.remoteServerId) {
      return getCachedP2PBlobUrl(source.remoteBlobId, source.remoteServerId, props.thumbnailSize);
    }
    return null;
  });

  // only re-run when source properties or P2P cache changes
  createEffect(
    on(
      () => ({
        blobId: imageSource().blobId,
        remoteUrl: imageSource().remoteUrl,
        remoteBlobId: imageSource().remoteBlobId,
        remoteServerId: imageSource().remoteServerId,
        p2pCached: p2pCachedUrl(),
        thumbnailSize: props.thumbnailSize,
      }),
      async (source, prevSource) => {
        // skip if nothing actually changed
        if (
          prevSource &&
          source.blobId === prevSource.blobId &&
          source.remoteUrl === prevSource.remoteUrl &&
          source.remoteBlobId === prevSource.remoteBlobId &&
          source.remoteServerId === prevSource.remoteServerId &&
          source.p2pCached === prevSource.p2pCached &&
          source.thumbnailSize === prevSource.thumbnailSize
        ) {
          return;
        }

        const thumbSize = source.thumbnailSize;

        // priority 1: local blob ID (from OPFS) - thumbnails not supported locally yet
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

        // priority 2: remote with server ID - check transport type
        if (source.remoteBlobId && source.remoteServerId) {
          const isP2P = isP2PRemoteSync(source.remoteServerId);

          // known HTTP remote - use URL directly
          if (isP2P === false && source.remoteUrl) {
            setResolvedUrl(withThumb(source.remoteUrl, thumbSize));
            setIsLoading(false);
            return;
          }

          // P2P cached URL available
          if (source.p2pCached) {
            setResolvedUrl(source.p2pCached);
            setIsLoading(false);
            return;
          }

          // P2P remote (or unknown) - async resolution will determine transport
          setIsLoading(true);
          try {
            const url = await resolveBlobUrl(
              source.remoteBlobId,
              source.remoteServerId,
              "image",
              undefined,
              thumbSize
            );
            setResolvedUrl(url);
          } catch (err) {
            console.error("failed to resolve remote image:", err);
            setResolvedUrl(null);
          }
          setIsLoading(false);
          return;
        }

        // priority 3: just remote URL (no server ID) - use directly
        if (source.remoteUrl) {
          setResolvedUrl(withThumb(source.remoteUrl, thumbSize));
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

  createEffect((prev: string | null | undefined) => {
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
          draggable={false}
          class={`${props.class || ""} "absolute inset-0 w-full h-full object-cover z-30"`}
          style={{ "user-select": "none" }}
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

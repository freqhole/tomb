import { Show, createSignal, createEffect } from "solid-js";
import { apiClient } from "../../../../lib/api-client";

interface MediaImageProps {
  /** Direct image URL (can be null) */
  imageUrl?: string | null;
  /** Alt text for accessibility */
  alt: string;
  /** Size variant */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Additional CSS classes */
  class?: string;
  /** Enable hover zoom effect */
  enableHover?: boolean;
  /** Show fallback icon when no image */
  showFallback?: boolean;
  /** Domain type for appropriate fallback icon */
  domainType?: "song" | "album" | "artist" | "genre" | "playlist";
}

export function MediaImage(props: MediaImageProps) {
  const [imageError, setImageError] = createSignal(false);
  const [imageLoaded, setImageLoaded] = createSignal(false);

  // Reset error state when image source changes
  createEffect(() => {
    if (props.imageUrl) {
      setImageError(false);
      setImageLoaded(false);
    }
  });

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
        return "w-16 h-16";
    }
  };

  const getIconSize = (): string => {
    switch (props.size) {
      case "xs":
        return "w-3 h-3";
      case "sm":
        return "w-4 h-4";
      case "md":
        return "w-6 h-6";
      case "lg":
        return "w-8 h-8";
      case "xl":
        return "w-12 h-12";
      default:
        return "w-6 h-6";
    }
  };

  const getFallbackIcon = () => {
    const iconClass = `${getIconSize()} text-magenta-400`;

    switch (props.domainType) {
      case "album":
        return (
          <svg class={iconClass} fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
          </svg>
        );
      case "artist":
        return (
          <svg class={iconClass} fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 3.5C14.5 3.18 13.9 3.18 13.4 3.5L7 7V9C7 9.55 7.45 10 8 10S9 9.55 9 9V8.25L12 6.5L15 8.25V9C15 9.55 15.45 10 16 10S17 9.55 17 9V7.75L20 9.5L21 9ZM17.75 17.5C18.5 17.5 19.13 16.87 19.13 16.13C19.13 15.38 18.5 14.75 17.75 14.75C17 14.75 16.38 15.38 16.38 16.13C16.38 16.87 17 17.5 17.75 17.5ZM8 12C6.9 12 6 12.9 6 14V22H8V14H16V22H18V14C18 12.9 17.1 12 16 12H8Z" />
          </svg>
        );
      case "playlist":
        return (
          <svg class={iconClass} fill="currentColor" viewBox="0 0 24 24">
            <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
          </svg>
        );
      case "genre":
        return (
          <svg class={iconClass} fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6zm-2 13c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45-1-1 1z" />
          </svg>
        );
      case "song":
      default:
        return (
          <svg class={iconClass} fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        );
    }
  };

  const imageUrl = props.imageUrl;
  const sizeClasses = getSizeClasses();
  const hoverClasses = props.enableHover
    ? "transition-transform hover:scale-105"
    : "";
  const baseClasses = `${sizeClasses} bg-magenta-800/30 rounded-none overflow-hidden ${hoverClasses} ${props.class || ""}`;

  return (
    <div class={baseClasses}>
      <Show
        when={imageUrl && !imageError()}
        fallback={
          <Show
            when={props.showFallback !== false}
            fallback={<div class="w-full h-full bg-magenta-800/30" />}
          >
            <div class="w-full h-full flex items-center justify-center">
              {getFallbackIcon()}
            </div>
          </Show>
        }
      >
        <div class="relative w-full h-full">
          {/* Loading placeholder */}
          <Show when={!imageLoaded()}>
            <div class="absolute inset-0 bg-magenta-800/30 animate-pulse" />
          </Show>

          {/* Actual image */}
          <img
            src={imageUrl!}
            alt={props.alt}
            class={`w-full h-full object-cover transition-opacity duration-200 ${
              imageLoaded() ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        </div>
      </Show>
    </div>
  );
}

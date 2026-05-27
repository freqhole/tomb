// Import all icon components
import { createMemo } from "solid-js";
import { Dynamic } from "solid-js/web";
import {
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
  StopIcon,
  VolumeHighIcon,
  VolumeIcon,
  VolumeLowIcon,
  VolumeOffIcon,
} from "./player";

// Re-export commonly used player icons
export { PlayIcon, PauseIcon } from "./player";

// Re-export commonly used navigation icons
export { MusicIcon } from "./navigation";

import {
  AlbumIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArtistIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  DiscoverIcon,
  FilterIcon,
  GenreIcon,
  GridIcon,
  HomeIcon,
  LibraryIcon,
  ListIcon,
  MenuIcon,
  MusicIcon,
  PlaylistIcon,
  RecentIcon,
  SearchIcon,
  SortIcon,
  ZoomInIcon,
  ZoomOutIcon,
  FitIcon,
  SelectSingleIcon,
  SelectMultiIcon,
  LassoIcon,
  EyeIcon,
  EyeOffIcon,
} from "./navigation";

import type { IconProps } from "./types";

// Base icon wrapper for consistent behavior
const BaseIcon = (props: IconProps & { children: any; defaultSize?: number }) => {
  const size = () => props.size ?? props.defaultSize ?? 16;
  const color = () => props.color ?? "currentColor";

  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill={color()}
      class={props.className}
      aria-label={props["aria-label"]}
      role="img"
      style={{
        "flex-shrink": 0,
        transition: "color 0.2s ease",
      }}
    >
      {props.children}
    </svg>
  );
};

// Stroke-based icon wrapper for outline icons
const StrokeBaseIcon = (
  props: IconProps & { children: any; defaultSize?: number; strokeWidth?: number }
) => {
  const size = () => props.size ?? props.defaultSize ?? 16;
  const color = () => props.color ?? "currentColor";
  const strokeWidth = () => props.strokeWidth ?? 2;

  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color()}
      stroke-width={strokeWidth()}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.className}
      aria-label={props["aria-label"]}
      role="img"
      style={{
        "flex-shrink": 0,
        transition: "color 0.2s ease",
      }}
    >
      {props.children}
    </svg>
  );
};

// UI Action Icons
export const CloseIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Close"}>
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </BaseIcon>
);

export const AddIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={14} aria-label={props["aria-label"] ?? "Add"}>
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
  </BaseIcon>
);

export const EditIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={14} aria-label={props["aria-label"] ?? "Edit"}>
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
  </BaseIcon>
);

export const DeleteIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={14} aria-label={props["aria-label"] ?? "Delete"}>
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
  </BaseIcon>
);

export const CopyIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={14} aria-label={props["aria-label"] ?? "Copy"}>
    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
  </BaseIcon>
);

export const DragIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={14} aria-label={props["aria-label"] ?? "Drag to reorder"}>
    <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
  </BaseIcon>
);

export const MoreIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={14} aria-label={props["aria-label"] ?? "More options"}>
    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
  </BaseIcon>
);

export const FavoriteIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Favorite"}>
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </BaseIcon>
);

export const FavoriteOutlineIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Add to favorites"}>
    <path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zM12.1 18.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z" />
  </BaseIcon>
);

export const StarIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Star"}>
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </BaseIcon>
);

export const StarOutlineIcon = (props: IconProps) => {
  const size = () => props.size ?? 16;
  const color = () => props.color ?? "currentColor";

  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color()}
      stroke-width="2"
      class={props.className}
      aria-label={props["aria-label"] ?? "Star outline"}
      role="img"
      style={{
        "flex-shrink": 0,
        transition: "color 0.2s ease",
      }}
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
};

export const TagIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Tag"}>
    <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z" />
  </BaseIcon>
);

// Auth Icons
export const LogoutIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Logout"}>
    <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
  </BaseIcon>
);

export const UserIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "User"}>
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
  </BaseIcon>
);

// System Icons
export const SettingsIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Settings"}>
    <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z" />
  </BaseIcon>
);

export const InfoIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Information"}>
    <path d="M12,2C6.48,2,2,6.48,2,12s4.48,10,10,10s10-4.48,10-10S17.52,2,12,2z M13,17h-2v-6h2V17z M13,9h-2V7h2V9z" />
  </BaseIcon>
);

export const UploadIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Upload"}>
    <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
  </BaseIcon>
);

export const ImageIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Image"}>
    <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
  </BaseIcon>
);

export const SendIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Send"}>
    <path d="M2,21L23,12L2,3V10L17,12L2,14V21Z" />
  </BaseIcon>
);

export const ShareIcon = (props: IconProps) => (
  <StrokeBaseIcon {...props} aria-label={props["aria-label"] ?? "Share"}>
    {/* paper airplane: outer hull + fold crease */}
    <path d="M21.5 2.5L2 10.5l7.5 3 3 7.5 9-18.5z" />
    <path d="M21.5 2.5L9.5 13.5" />
  </StrokeBaseIcon>
);

export const CheckIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Check"}>
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </BaseIcon>
);

export const XIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Close"}>
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </BaseIcon>
);

export const AlertTriangleIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Warning"}>
    <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
  </BaseIcon>
);

// Auto download icon: pill-shaped "AUTO" badge
export const AutoDownloadIcon = (props: IconProps) => {
  const heightNum = () => (typeof props.size === "number" ? props.size : 16);
  const width = () => Math.round(heightNum() * 2.2); // wider than tall for pill shape
  const color = () => props.color ?? "currentColor";

  return (
    <svg
      width={width()}
      height={heightNum()}
      viewBox="0 0 44 20"
      fill="none"
      class={props.className}
      aria-label={props["aria-label"] ?? "Auto download"}
      role="img"
      style={{ "flex-shrink": 0 }}
    >
      {/* pill background */}
      <rect
        x="0.5"
        y="0.5"
        width="43"
        height="19"
        rx="9.5"
        stroke={color()}
        stroke-width="1"
        fill="none"
      />
      {/* AUTO text */}
      <text
        x="22"
        y="14.5"
        text-anchor="middle"
        fill={color()}
        font-size="11"
        font-weight="600"
        font-family="system-ui, -apple-system, sans-serif"
        letter-spacing="0.5"
      >
        AUTO
      </text>
    </svg>
  );
};

export const LoaderIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Loading"}>
    <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z" />
  </BaseIcon>
);

export const DatabaseIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Storage"}>
    <path d="M12,3C7.58,3 4,4.79 4,7C4,9.21 7.58,11 12,11C16.42,11 20,9.21 20,7C20,4.79 16.42,3 12,3M4,9V12C4,14.21 7.58,16 12,16C16.42,16 20,14.21 20,12V9C20,11.21 16.42,13 12,13C7.58,13 4,11.21 4,9M4,14V17C4,19.21 7.58,21 12,21C16.42,21 20,19.21 20,17V14C20,16.21 16.42,18 12,18C7.58,18 4,16.21 4,14Z" />
  </BaseIcon>
);

export const HeadphonesIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Headphones"}>
    <path d="M12 3C7.03 3 3 7.03 3 12v7c0 1.1.9 2 2 2h2v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-2v8h2c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z" />
  </BaseIcon>
);

export const RadioTowerIcon = (props: IconProps) => (
  <StrokeBaseIcon {...props} aria-label={props["aria-label"] ?? "Radio tower"}>
    <circle cx="12" cy="4" r="1.5" />
    <path d="M12 6v12" />
    <path d="M9 18h6" />
    <path d="M8 21h8" />
    <path d="M7 8.5a7 7 0 0 0 0 7" />
    <path d="M17 8.5a7 7 0 0 1 0 7" />
    <path d="M4.5 6.5a10 10 0 0 0 0 11" />
    <path d="M19.5 6.5a10 10 0 0 1 0 11" />
  </StrokeBaseIcon>
);

export const CarouselIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Image carousel"}>
    {/* merry-go-round: conical top, center pole, platform, hanging elements */}
    <path d="M12 2L4 10h16L12 2z" />
    <rect x="11" y="10" width="2" height="10" />
    <rect x="4" y="20" width="16" height="2" rx="1" />
    <rect x="6" y="12" width="2" height="5" rx="1" />
    <rect x="16" y="12" width="2" height="5" rx="1" />
    <rect x="11" y="12" width="2" height="4" rx="1" />
  </BaseIcon>
);

export const ExternalLinkIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "External link"}>
    <path
      d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <polyline
      points="15 3 21 3 21 9"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <line
      x1="10"
      y1="14"
      x2="21"
      y2="3"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </BaseIcon>
);

// Stroke-based icon variants (for consistent stroke rendering)
export const AddStrokeIcon = (props: IconProps) => (
  <StrokeBaseIcon {...props} aria-label={props["aria-label"] ?? "Add"}>
    <path d="M12 4v16m8-8H4" />
  </StrokeBaseIcon>
);

export const ChevronDownStrokeIcon = (props: IconProps) => (
  <StrokeBaseIcon {...props} aria-label={props["aria-label"] ?? "Expand"}>
    <path d="M19 9l-7 7-7-7" />
  </StrokeBaseIcon>
);

export const FavoriteStrokeIcon = (props: IconProps) => (
  <StrokeBaseIcon {...props} aria-label={props["aria-label"] ?? "Add to favorites"}>
    <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </StrokeBaseIcon>
);

export const TagStrokeIcon = (props: IconProps) => (
  <StrokeBaseIcon {...props} aria-label={props["aria-label"] ?? "Tag"}>
    <path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
  </StrokeBaseIcon>
);

export const CheckCircleIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Complete"}>
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
  </BaseIcon>
);

// freqhole Brand Icon
export const FreqholeIcon = (props: IconProps & { class?: string }) => (
  <svg
    width={props.size ?? 20}
    height={props.size ?? 20}
    viewBox="0 0 500 500"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class={props.class ?? props.className}
    aria-label={props["aria-label"] ?? "freqhole"}
    role="img"
    style={{
      "flex-shrink": 0,
      transition: "transform 0.2s ease",
    }}
  >
    <path
      d="M250 405L125 155L375 155L303.611 340.714L250 405Z"
      fill={props.color ?? "var(--color-accent-500)"}
    />
  </svg>
);

// Icon registry for dynamic icon usage (organized by category)
export const IconRegistry = {
  // Player controls
  play: PlayIcon,
  pause: PauseIcon,
  previous: PrevIcon,
  next: NextIcon,
  stop: StopIcon,

  // Volume controls
  volume: VolumeIcon,
  volumeOff: VolumeOffIcon,
  volumeLow: VolumeLowIcon,
  volumeHigh: VolumeHighIcon,

  // Playback modes
  shuffle: ShuffleIcon,
  repeat: RepeatIcon,
  repeatOne: RepeatOneIcon,
  queue: QueueIcon,

  // Navigation
  music: MusicIcon,
  album: AlbumIcon,
  artist: ArtistIcon,
  playlist: PlaylistIcon,
  library: LibraryIcon,
  genre: GenreIcon,
  home: HomeIcon,
  discover: DiscoverIcon,
  recent: RecentIcon,
  search: SearchIcon,
  zoomIn: ZoomInIcon,
  zoomOut: ZoomOutIcon,
  fit: FitIcon,
  selectSingle: SelectSingleIcon,
  selectMulti: SelectMultiIcon,
  lasso: LassoIcon,
  eye: EyeIcon,
  eyeOff: EyeOffIcon,

  // Layout & view
  menu: MenuIcon,
  grid: GridIcon,
  list: ListIcon,
  filter: FilterIcon,
  sort: SortIcon,

  // Arrows & navigation
  arrowUp: ArrowUpIcon,
  arrowDown: ArrowDownIcon,
  arrowLeft: ArrowLeftIcon,
  arrowRight: ArrowRightIcon,
  chevronUp: ChevronUpIcon,
  chevronDown: ChevronDownIcon,
  chevronLeft: ChevronLeftIcon,
  chevronRight: ChevronRightIcon,

  // Actions
  add: AddIcon,
  edit: EditIcon,
  delete: DeleteIcon,
  copy: CopyIcon,
  close: CloseIcon,
  drag: DragIcon,
  more: MoreIcon,
  favorite: FavoriteIcon,
  favoriteOutline: FavoriteOutlineIcon,
  star: StarIcon,
  starOutline: StarOutlineIcon,
  tag: TagIcon,

  // Auth & user
  logout: LogoutIcon,
  user: UserIcon,

  // System
  settings: SettingsIcon,
  info: InfoIcon,
  upload: UploadIcon,
  image: ImageIcon,
  send: SendIcon,
  share: ShareIcon,
  check: CheckIcon,
  x: XIcon,
  alertTriangle: AlertTriangleIcon,
  loader: LoaderIcon,
  database: DatabaseIcon,
  headphones: HeadphonesIcon,
  radioTower: RadioTowerIcon,
  carousel: CarouselIcon,
  externalLink: ExternalLinkIcon,
  autoDownload: AutoDownloadIcon,

  // Stroke variants
  addStroke: AddStrokeIcon,
  chevronDownStroke: ChevronDownStrokeIcon,
  favoriteStroke: FavoriteStrokeIcon,
  tagStroke: TagStrokeIcon,
  checkCircle: CheckCircleIcon,

  // Brand
  freqhole: FreqholeIcon,
} as const;

export type IconName = keyof typeof IconRegistry;

// icon name constants for use in code without type casting
// usage: IconNames.play, IconNames.pause, etc.
export const IconNames = {
  // Player controls
  play: "play",
  pause: "pause",
  previous: "previous",
  next: "next",
  stop: "stop",

  // Volume controls
  volume: "volume",
  volumeOff: "volumeOff",
  volumeLow: "volumeLow",
  volumeHigh: "volumeHigh",

  // Playback modes
  shuffle: "shuffle",
  repeat: "repeat",
  repeatOne: "repeatOne",
  queue: "queue",

  // Navigation
  music: "music",
  album: "album",
  artist: "artist",
  playlist: "playlist",
  library: "library",
  genre: "genre",
  home: "home",
  discover: "discover",
  recent: "recent",
  search: "search",
  zoomIn: "zoomIn",
  zoomOut: "zoomOut",
  fit: "fit",
  selectSingle: "selectSingle",
  selectMulti: "selectMulti",
  lasso: "lasso",
  eye: "eye",
  eyeOff: "eyeOff",

  // Layout & view
  menu: "menu",
  grid: "grid",
  list: "list",
  filter: "filter",
  sort: "sort",

  // Arrows & navigation
  arrowUp: "arrowUp",
  arrowDown: "arrowDown",
  arrowLeft: "arrowLeft",
  arrowRight: "arrowRight",
  chevronUp: "chevronUp",
  chevronDown: "chevronDown",
  chevronLeft: "chevronLeft",
  chevronRight: "chevronRight",

  // Actions
  add: "add",
  edit: "edit",
  delete: "delete",
  copy: "copy",
  close: "close",
  drag: "drag",
  more: "more",
  favorite: "favorite",
  favoriteOutline: "favoriteOutline",
  star: "star",
  starOutline: "starOutline",
  tag: "tag",

  // Auth & user
  logout: "logout",
  user: "user",

  // System
  settings: "settings",
  info: "info",
  upload: "upload",
  image: "image",
  send: "send",
  share: "share",
  check: "check",
  x: "x",
  alertTriangle: "alertTriangle",
  loader: "loader",
  database: "database",
  headphones: "headphones",
  radioTower: "radioTower",
  carousel: "carousel",
  externalLink: "externalLink",
  autoDownload: "autoDownload",

  // Stroke variants
  addStroke: "addStroke",
  chevronDownStroke: "chevronDownStroke",
  favoriteStroke: "favoriteStroke",
  tagStroke: "tagStroke",
  checkCircle: "checkCircle",

  // Brand
  freqhole: "freqhole",
} as const satisfies Record<IconName, IconName>;

// Dynamic icon component
export const Icon = (props: IconProps & { name: IconName }) => {
  return (
    <Dynamic
      component={
        IconRegistry[props.name] ??
        (() => {
          console.warn(`Icon "${props.name}" not found in registry`);
          return null;
        })
      }
      {...props}
    />
  );
};

// Preset icon sizes for consistency
export const IconSizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  "2xl": 32,
} as const;

export type IconSize = keyof typeof IconSizes;

// Helper component for commonly used icon patterns
export const IconButton = (
  props: IconProps & {
    name: IconName;
    onClick?: () => void;
    disabled?: boolean;
    variant?: "default" | "ghost" | "outline";
  }
) => {
  const baseClasses =
    "inline-flex items-center justify-center rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2";
  const variantClasses = {
    default: "bg-gray-100 hover:bg-gray-200 focus:ring-gray-500",
    ghost: "hover:bg-gray-100 focus:ring-gray-500",
    outline: "border border-gray-300 hover:bg-gray-50 focus:ring-gray-500",
  };

  const variant = createMemo(() => props.variant ?? "ghost");
  const size = createMemo(() => props.size ?? IconSizes.md);
  const padding = createMemo(() => {
    const s = size();
    return typeof s === "number" && s <= 16 ? "p-1" : "p-2";
  });

  return (
    <button
      type="button"
      class={`${baseClasses} ${variantClasses[variant()]} ${padding()} ${props.className ?? ""}`}
      onClick={() => props.onClick?.()}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
    >
      <Icon {...props} className="" />
    </button>
  );
};

// Import all icon components
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  StopIcon,
  QueueIcon,
  ShuffleIcon,
  RepeatIcon,
  RepeatOneIcon,
  VolumeIcon,
  VolumeOffIcon,
  VolumeLowIcon,
  VolumeHighIcon,
} from "./player.js";

import {
  MusicIcon,
  AlbumIcon,
  ArtistIcon,
  PlaylistIcon,
  LibraryIcon,
  GenreIcon,
  HomeIcon,
  DiscoverIcon,
  RecentIcon,
  SearchIcon,
  MenuIcon,
  GridIcon,
  ListIcon,
  FilterIcon,
  SortIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "./navigation.js";

import type { IconProps } from "./index.js";

// Base icon wrapper for consistent behavior
const BaseIcon = (
  props: IconProps & { children: any; defaultSize?: number }
) => {
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

// UI Action Icons
export const CloseIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Close"}>
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </BaseIcon>
);

export const AddIcon = (props: IconProps) => (
  <BaseIcon
    {...props}
    defaultSize={14}
    aria-label={props["aria-label"] ?? "Add"}
  >
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
  </BaseIcon>
);

export const EditIcon = (props: IconProps) => (
  <BaseIcon
    {...props}
    defaultSize={14}
    aria-label={props["aria-label"] ?? "Edit"}
  >
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
  </BaseIcon>
);

export const DeleteIcon = (props: IconProps) => (
  <BaseIcon
    {...props}
    defaultSize={14}
    aria-label={props["aria-label"] ?? "Delete"}
  >
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
  </BaseIcon>
);

export const DragIcon = (props: IconProps) => (
  <BaseIcon
    {...props}
    defaultSize={14}
    aria-label={props["aria-label"] ?? "Drag to reorder"}
  >
    <path d="M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
  </BaseIcon>
);

export const MoreIcon = (props: IconProps) => (
  <BaseIcon
    {...props}
    defaultSize={14}
    aria-label={props["aria-label"] ?? "More options"}
  >
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

// Freqhole Brand Icon
export const FreqholeIcon = (props: IconProps & { class?: string }) => (
  <svg
    width={props.size ?? 20}
    height={props.size ?? 20}
    viewBox="0 0 500 500"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class={props.class ?? props.className}
    aria-label={props["aria-label"] ?? "Freqhole"}
    role="img"
    style={{
      "flex-shrink": 0,
      transition: "transform 0.2s ease",
    }}
  >
    <path
      d="M250 405L125 155L375 155L303.611 340.714L250 405Z"
      fill={props.color ?? "#FF00FF"}
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
  close: CloseIcon,
  drag: DragIcon,
  more: MoreIcon,
  favorite: FavoriteIcon,
  favoriteOutline: FavoriteOutlineIcon,

  // Auth & user
  logout: LogoutIcon,
  user: UserIcon,

  // System
  settings: SettingsIcon,
  info: InfoIcon,

  // Brand
  freqhole: FreqholeIcon,
} as const;

export type IconName = keyof typeof IconRegistry;

// Dynamic icon component
export const Icon = (props: IconProps & { name: IconName }) => {
  const IconComponent = IconRegistry[props.name];
  if (!IconComponent) {
    console.warn(`Icon "${props.name}" not found in registry`);
    return null;
  }
  return <IconComponent {...props} />;
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

  const variant = props.variant ?? "ghost";
  const size = props.size ?? IconSizes.md;
  const padding = typeof size === "number" && size <= 16 ? "p-1" : "p-2";

  return (
    <button
      type="button"
      class={`${baseClasses} ${variantClasses[variant]} ${padding} ${props.className ?? ""}`}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
    >
      <Icon {...props} className="" />
    </button>
  );
};

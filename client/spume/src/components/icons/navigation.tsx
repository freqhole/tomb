import type { IconProps } from "./types";

// Base icon wrapper for consistent behavior
const BaseIcon = (props: IconProps & { children: any; defaultSize?: number }) => {
  const size = () => props.size ?? props.defaultSize ?? 24;
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

// Music Navigation Icons
export const MusicIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Music"}>
    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
  </BaseIcon>
);

export const AlbumIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Albums"}>
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5s2.01-4.5 4.5-4.5 4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
  </BaseIcon>
);

export const ArtistIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Artists"}>
    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
  </BaseIcon>
);

export const PlaylistIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Playlists"}>
    <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z" />
  </BaseIcon>
);

export const LibraryIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Library"}>
    <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
  </BaseIcon>
);

export const GenreIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Genres"}>
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </BaseIcon>
);

// Navigation Actions
export const SearchIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={20} aria-label={props["aria-label"] ?? "Search"}>
    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
  </BaseIcon>
);

// magnifying glass with a + in the center
export const ZoomInIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={20} aria-label={props["aria-label"] ?? "Zoom in"}>
    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM10 7H9v2H7v1h2v2h1v-2h2V9h-2z" />
  </BaseIcon>
);

// magnifying glass with a − in the center
export const ZoomOutIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={20} aria-label={props["aria-label"] ?? "Zoom out"}>
    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM7 9h5v1H7z" />
  </BaseIcon>
);

// four L-corner brackets framing an empty interior — classic
// "fit to view" / "center content in viewport" affordance.
export const FitIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Fit to view"}>
    <path d="M3 3h7v2H5v5H3V3zm11 0h7v7h-2V5h-5V3zM3 14h2v5h5v2H3v-7zm16 0h2v7h-7v-2h5v-5z" />
  </BaseIcon>
);

// single node marker for single-select mode.
export const SelectSingleIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Single select"}>
    <circle cx="12" cy="12" r="3" />
  </BaseIcon>
);

// clustered node markers for multi-select mode.
export const SelectMultiIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Multi select"}>
    <circle cx="8" cy="8" r="2" />
    <circle cx="16" cy="8" r="2" />
    <circle cx="12" cy="15.5" r="2" />
  </BaseIcon>
);

// freeform loop with a dangling tail + knot bead — distinct from a
// marquee/rectangle selection and from a checkmark.
export const LassoIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Lasso"}>
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M12 3c4.97 0 9 2.91 9 6.5S16.97 16 12 16s-9-2.91-9-6.5S7.03 3 12 3zm0 2C8.13 5 5 7.01 5 9.5S8.13 14 12 14s7-2.01 7-4.5S15.87 5 12 5z"
    />
    <path d="M17.2 14.5l1.7-1.05 2.6 4.3-1.7 1.05z" />
    <circle cx="20.5" cy="20.5" r="1.7" />
  </BaseIcon>
);

export const EyeIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={20} aria-label={props["aria-label"] ?? "Show"}>
    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
  </BaseIcon>
);

export const EyeOffIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={20} aria-label={props["aria-label"] ?? "Hide"}>
    <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" />
  </BaseIcon>
);

export const HomeIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Home"}>
    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
  </BaseIcon>
);

export const DiscoverIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Discover"}>
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
  </BaseIcon>
);

export const RecentIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Recently played"}>
    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
    <path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
  </BaseIcon>
);

// Menu and Layout Icons
export const MenuIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={20} aria-label={props["aria-label"] ?? "Menu"}>
    <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
  </BaseIcon>
);

export const GridIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Grid view"}>
    <path d="M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z" />
  </BaseIcon>
);

export const ListIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "List view"}>
    <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
  </BaseIcon>
);

export const FilterIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Filter"}>
    <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
  </BaseIcon>
);

export const SortIcon = (props: IconProps) => (
  <BaseIcon {...props} aria-label={props["aria-label"] ?? "Sort"}>
    <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" />
  </BaseIcon>
);

// Arrow Icons
export const ArrowUpIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={16} aria-label={props["aria-label"] ?? "Arrow up"}>
    <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
  </BaseIcon>
);

export const ArrowDownIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={16} aria-label={props["aria-label"] ?? "Arrow down"}>
    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
  </BaseIcon>
);

export const ArrowLeftIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={16} aria-label={props["aria-label"] ?? "Arrow left"}>
    <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" />
  </BaseIcon>
);

export const ArrowRightIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={16} aria-label={props["aria-label"] ?? "Arrow right"}>
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
  </BaseIcon>
);

export const ChevronUpIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={16} aria-label={props["aria-label"] ?? "Chevron up"}>
    <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
  </BaseIcon>
);

export const ChevronDownIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={16} aria-label={props["aria-label"] ?? "Chevron down"}>
    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
  </BaseIcon>
);

export const ChevronLeftIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={16} aria-label={props["aria-label"] ?? "Chevron left"}>
    <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z" />
  </BaseIcon>
);

export const ChevronRightIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={16} aria-label={props["aria-label"] ?? "Chevron right"}>
    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z" />
  </BaseIcon>
);

// graph-specific "go to parent" affordance.
// shape: two-segment guide line from upper-right with an arrow pointing down-left.
export const GraphBackIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={16} aria-label={props["aria-label"] ?? "Graph back"}>
    <path
      d="M19 5L13 10L8 15"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M8 15V11M8 15H12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </BaseIcon>
);

export const ExpandIcon = (props: IconProps) => (
  <BaseIcon {...props} defaultSize={16} aria-label={props["aria-label"] ?? "Expand"}>
    <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
    <path d="M6 6h2v2H6zM6 16h2v2H6zM16 16h2v2h-2zM16 6h2v2h-2z" />
  </BaseIcon>
);

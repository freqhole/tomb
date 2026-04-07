// layout constants for the bin widget.
// slot dimensions vary by layout mode.

// -- grid mode (square tiles) ------------------------------------------------

/** grid cell size in pixels (square) */
export const GRID_CELL_SIZE = 96;

/** padding between cells in grid mode */
export const GRID_GAP = 4;

/** max characters for the filename label under grid cells */
export const GRID_LABEL_MAX_CHARS = 24;

/** font size for grid cell labels */
export const GRID_LABEL_FONT_SIZE = 9;

/** height reserved for the label text under grid cells */
export const GRID_LABEL_HEIGHT = 16;

// -- shelf mode (vertical spines) --------------------------------------------

/** shelf slot width (narrow vertical) */
export const SHELF_SLOT_W = 28;

/** shelf slot height */
export const SHELF_SLOT_H = 96;

/** gap between shelf slots */
export const SHELF_GAP = 2;

/** font size for shelf spine text (rotated) */
export const SHELF_FONT_SIZE = 8;

// -- crate mode (horizontal rows) --------------------------------------------

/** crate slot width */
export const CRATE_SLOT_W = 96;

/** crate slot height (narrow horizontal) */
export const CRATE_SLOT_H = 28;

/** gap between crate rows */
export const CRATE_GAP = 2;

/** small thumbnail size in crate mode */
export const CRATE_THUMB_SIZE = 20;

/** font size for crate row text */
export const CRATE_FONT_SIZE = 9;

// -- drawer mode (full-width rows) -------------------------------------------

/** drawer row height (taller than crate for better readability) */
export const DRAWER_ROW_H = 36;

/** gap between drawer rows */
export const DRAWER_GAP = 2;

/** font size for drawer row text */
export const DRAWER_FONT_SIZE = 10;

// -- endcap thumbnails -------------------------------------------------------

/** height of the thumbnail endcap at the top of each shelf spine */
export const SHELF_ENDCAP_H = 24;

// -- shared ------------------------------------------------------------------

/** padding around the content area inside the bin widget */
export const BIN_PADDING = 4;

/** header height for the bin title bar / action buttons */
export const BIN_HEADER_HEIGHT = 24;

/** font size for the bin header title */
export const BIN_HEADER_FONT_SIZE = 10;

/** border radius for slot highlight overlays */
export const SLOT_HIGHLIGHT_RADIUS = 3;

// -- colors ------------------------------------------------------------------

/** background color for empty slots */
export const SLOT_EMPTY_BG = 0x1a1a1a;

/** border color for slot outlines */
export const SLOT_BORDER_COLOR = 0x2a2a2a;

/** highlight color for drop target slot */
export const SLOT_HIGHLIGHT_COLOR = 0xff1a9e;

/** default accent color when CompactInfo.accentColor is not provided */
export const DEFAULT_ACCENT_COLOR = 0x3a3a4a;

/** text color for labels */
export const TEXT_COLOR = 0xe0e0e0;

/** muted text color for secondary info */
export const TEXT_MUTED = 0x666666;

/** header background color */
export const HEADER_BG = 0x141414;

/** action button background */
export const ACTION_BTN_BG = 0x2a2a2a;

/** action button hover */
export const ACTION_BTN_HOVER = 0x3a3a3a;

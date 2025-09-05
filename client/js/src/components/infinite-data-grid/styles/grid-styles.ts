// Tailwind class utilities for dark theme grid styling
export const GRID_STYLES = {
  // Base container classes
  container: "h-full flex flex-col bg-black text-white",
  scrollContainer: "flex-1 overflow-auto min-h-0",
  contentContainer: "relative",

  // Header classes
  header: "flex-shrink-0 bg-black bg-opacity-90 sticky top-0 z-40",
  headerRow: "flex items-center border-b border-gray-700",
  headerCell:
    "px-3 py-3 text-sm font-medium text-gray-300 overflow-hidden text-ellipsis whitespace-nowrap",
  sortableHeader: "cursor-pointer hover:bg-gray-800 hover:bg-opacity-50",
  sortIndicator: "ml-2 text-magenta-400",

  // Row classes
  row: "absolute inset-x-0 flex items-center transition-colors",
  rowDefault: "bg-black bg-opacity-90 hover:bg-opacity-70",
  rowSelected: "bg-magenta-500 bg-opacity-30",
  rowSelectedBorder: "shadow-[inset_0_0_0_2px_rgb(217,70,239)]",
  rowFocused: "",
  rowHover: "hover:bg-black hover:bg-opacity-70",

  // Cell classes
  cell: "px-3 py-0 text-sm overflow-hidden text-ellipsis whitespace-nowrap",
  cellEditable: "cursor-pointer",
  cellHeader: "font-medium text-gray-300",
  cellText: "text-white",
  cellMuted: "text-gray-400",

  // Status bar classes
  statusBar:
    "sticky bottom-0 z-10 flex items-center justify-between px-3 py-2 text-xs bg-black bg-opacity-90 border-t border-gray-700",
  statusText: "text-gray-400",
  statusHighlight: "text-magenta-400",
  statusMuted: "text-gray-600",

  // Loading states
  loadingSpinner:
    "w-3 h-3 border border-magenta-500 border-t-transparent animate-spin",
  loadingText: "text-gray-400",

  // Input/edit states
  editInput:
    "bg-black text-white px-2 py-1 text-sm border border-magenta-500 outline-none",
  editInputFocus: "ring-2 ring-magenta-400 ring-opacity-50",

  // Selection indicators
  checkbox: "w-4 h-4 text-magenta-500 bg-gray-900 border-gray-600 rounded-none",
  checkboxChecked: "accent-magenta-500",

  // Scroll indicators
  scrollIndicator:
    "absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-600",
  scrollThumb: "bg-gray-600",
  scrollTrack: "bg-gray-800",
} as const;

// Row state class combinations
export const getRowClasses = (
  isSelected: boolean,
  isFocused: boolean,
  isHovered: boolean = false
) => {
  const base = GRID_STYLES.row;
  const states: string[] = [GRID_STYLES.rowDefault];

  if (isSelected) {
    states.push(GRID_STYLES.rowSelected);
    states.push(GRID_STYLES.rowSelectedBorder);
  }

  if (isFocused) {
    states.push(GRID_STYLES.rowFocused);
  }

  if (!isSelected && isHovered) {
    states.push(GRID_STYLES.rowHover);
  }

  return [base, ...states].join(" ");
};

// Cell class combinations
export const getCellClasses = (
  column: { editable?: boolean; className?: string; cellClassName?: string },
  isHeader: boolean = false
) => {
  const base = GRID_STYLES.cell;
  const states: string[] = [];

  if (isHeader) {
    states.push(GRID_STYLES.cellHeader);
  } else {
    states.push(GRID_STYLES.cellText);
  }

  if (column.editable) {
    states.push(GRID_STYLES.cellEditable);
  }

  if (column.cellClassName) {
    states.push(column.cellClassName);
  }

  return [base, ...states].join(" ");
};

// Header class combinations
export const getHeaderClasses = (column: {
  sortable?: boolean;
  headerClassName?: string;
}) => {
  const base = GRID_STYLES.headerCell;
  const states: string[] = [];

  if (column.sortable) {
    states.push(GRID_STYLES.sortableHeader);
  }

  if (column.headerClassName) {
    states.push(column.headerClassName);
  }

  return [base, ...states].join(" ");
};

// Animation classes
export const ANIMATIONS = {
  fadeIn: "animate-in fade-in duration-200",
  fadeOut: "animate-out fade-out duration-200",
  slideIn: "animate-in slide-in-from-top-2 duration-200",
  slideOut: "animate-out slide-out-to-top-2 duration-200",
  spin: "animate-spin",
} as const;

// Focus and accessibility classes
export const ACCESSIBILITY = {
  focusVisible:
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-magenta-400",
  screenReaderOnly: "sr-only",
  ariaLabel: "aria-label",
  role: "role",
} as const;

import {
  BIN_HEADER_HEIGHT,
  BIN_PADDING,
  CRATE_GAP,
  CRATE_SLOT_H,
  CRATE_SLOT_W,
  DRAWER_GAP,
  DRAWER_ROW_H,
  GRID_CELL_SIZE,
  GRID_GAP,
  GRID_LABEL_HEIGHT,
  SHELF_GAP,
  SHELF_SLOT_H,
  SHELF_SLOT_W,
  SLOT_SCALE_MULTIPLIERS,
  type SlotScale,
} from "./bin-constants";

/** a layout mode supported by the bin widget */
export type BinMode = "grid" | "shelf" | "crate" | "drawer";

/** slot position in the grid (col, row) */
export interface SlotPosition {
  col: number;
  row: number;
}

/** options that affect slot dimensions */
export interface SlotSizeOptions {
  /** scale multiplier (default 1.0) — applied to base slot dimensions */
  scale?: number;
  /** override shelf slot height to match the container's visible height.
   *  when set, shelf spines stretch to fill the bin vertically. */
  shelfHeight?: number;
}

/** pixel coordinates of a slot's top-left corner (relative to content area) */
export interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** get the slot dimensions (width, height) for a given mode, optionally scaled */
export function slotSize(
  mode: BinMode,
  options?: SlotSizeOptions
): { width: number; height: number } {
  const s = options?.scale ?? 1.0;
  switch (mode) {
    case "grid":
      return {
        width: Math.round(GRID_CELL_SIZE * s),
        height: Math.round(GRID_CELL_SIZE * s) + GRID_LABEL_HEIGHT,
      };
    case "shelf":
      return {
        width: Math.round(SHELF_SLOT_W * s),
        height: options?.shelfHeight ?? Math.round(SHELF_SLOT_H * s),
      };
    case "crate":
      return {
        width: Math.round(CRATE_SLOT_W * s),
        height: Math.round(CRATE_SLOT_H * s),
      };
    case "drawer":
      return { width: 0, height: Math.round(DRAWER_ROW_H * s) };
  }
}

/** get the gap between slots for a given mode */
export function slotGap(mode: BinMode): number {
  switch (mode) {
    case "grid":
      return GRID_GAP;
    case "shelf":
      return SHELF_GAP;
    case "crate":
      return CRATE_GAP;
    case "drawer":
      return DRAWER_GAP;
  }
}

/** compute the number of rows needed for the given item count and column count */
export function computeRows(itemCount: number, cols: number): number {
  if (itemCount === 0) return 1;
  return Math.ceil(itemCount / Math.max(1, cols));
}

/**
 * auto-compute the number of columns that fit in the given content width
 * based on the slot dimensions for the current mode and scale.
 * drawer mode always returns 1.
 */
export function autoFitCols(
  mode: BinMode,
  contentWidth: number,
  options?: SlotSizeOptions
): number {
  if (mode === "drawer") return 1;

  const size = slotSize(mode, options);
  const gap = slotGap(mode);

  if (size.width <= 0) return 1;
  return Math.max(1, Math.floor((contentWidth + gap) / (size.width + gap)));
}

/**
 * get the pixel rect for a given slot position (relative to the content area origin).
 * the content area starts below the header.
 */
export function slotRect(
  mode: BinMode,
  slot: SlotPosition,
  contentWidth: number,
  options?: SlotSizeOptions
): SlotRect {
  const size = slotSize(mode, options);
  const gap = slotGap(mode);

  if (mode === "drawer") {
    // drawer: full width rows stacked vertically
    return {
      x: 0,
      y: slot.row * (size.height + gap),
      width: contentWidth,
      height: size.height,
    };
  }

  return {
    x: slot.col * (size.width + gap),
    y: slot.row * (size.height + gap),
    width: size.width,
    height: size.height,
  };
}

/**
 * find the first empty slot given the current items and grid dimensions.
 * returns null if the grid is full.
 */
export function firstEmptySlot(
  occupied: SlotPosition[],
  cols: number,
  rows: number
): SlotPosition | null {
  const occupiedSet = new Set(occupied.map((s) => `${s.col},${s.row}`));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!occupiedSet.has(`${c},${r}`)) {
        return { col: c, row: r };
      }
    }
  }
  return null;
}

/**
 * hit-test: given a pointer position relative to the content area,
 * return the slot position it falls in, or null if outside the grid.
 */
export function hitTestSlot(
  mode: BinMode,
  px: number,
  py: number,
  cols: number,
  rows: number,
  contentWidth: number,
  options?: SlotSizeOptions
): SlotPosition | null {
  const size = slotSize(mode, options);
  const gap = slotGap(mode);

  if (mode === "drawer") {
    const row = Math.floor(py / (size.height + gap));
    if (row < 0 || row >= rows) return null;
    if (px < 0 || px > contentWidth) return null;
    return { col: 0, row };
  }

  const col = Math.floor(px / (size.width + gap));
  const row = Math.floor(py / (size.height + gap));

  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;

  // snap to nearest cell when pointer is in the gap between cells.
  // this makes drop targeting more forgiving — instead of returning null
  // (which causes the highlight to jump to the first empty slot), we
  // keep the highlight on the nearest cell.
  const cellX = px - col * (size.width + gap);
  const cellY = py - row * (size.height + gap);

  // if we're past the cell in X, try the next column
  if (cellX > size.width && col + 1 < cols) {
    return { col: col + 1, row };
  }
  // if we're past the cell in Y, try the next row
  if (cellY > size.height && row + 1 < rows) {
    return { col, row: row + 1 };
  }
  // if both are past, we're in a diagonal gap — just use the computed col/row
  return { col, row };
}

/**
 * compute the total content area dimensions for the current layout.
 * does not include header height or padding -- those are added by the caller.
 */
export function contentDimensions(
  mode: BinMode,
  cols: number,
  rows: number,
  contentWidth: number,
  options?: SlotSizeOptions
): { width: number; height: number } {
  const size = slotSize(mode, options);
  const gap = slotGap(mode);

  if (mode === "drawer") {
    return {
      width: contentWidth,
      height: rows * (size.height + gap) - (rows > 0 ? gap : 0),
    };
  }

  return {
    width: cols * (size.width + gap) - (cols > 0 ? gap : 0),
    height: rows * (size.height + gap) - (rows > 0 ? gap : 0),
  };
}

/**
 * compute the ideal widget frame size for the bin given the current layout.
 * includes header height and padding.
 */
export function idealBinSize(
  mode: BinMode,
  cols: number,
  rows: number,
  contentWidth: number,
  options?: SlotSizeOptions
): { width: number; height: number } {
  const content = contentDimensions(mode, cols, rows, contentWidth, options);
  return {
    width: content.width + BIN_PADDING * 2,
    height: content.height + BIN_HEADER_HEIGHT + BIN_PADDING * 2,
  };
}

/** resolve a SlotScale name to its numeric multiplier */
export function resolveScale(scaleName?: SlotScale | string): number {
  if (!scaleName) return 1.0;
  return SLOT_SCALE_MULTIPLIERS[scaleName as SlotScale] ?? 1.0;
}

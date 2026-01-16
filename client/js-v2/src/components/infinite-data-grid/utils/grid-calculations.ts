// Pure calculation functions for grid layout and virtualization
export interface GridDimensions {
  containerWidth: number;
  containerHeight: number;
  rowHeight: number;
  headerHeight: number;
  totalItems: number;
}

export interface ViewportInfo {
  startIndex: number;
  endIndex: number;
  visibleCount: number;
  totalHeight: number;
  offsetY: number;
}

export function calculateViewport(
  scrollTop: number,
  dimensions: GridDimensions,
  bufferSize: number = 5
): ViewportInfo {
  const { containerHeight, rowHeight, totalItems } = dimensions;

  // calculate visible range with buffer
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / rowHeight) - bufferSize
  );

  const visibleRowCount = Math.ceil(containerHeight / rowHeight);
  const endIndex = Math.min(
    totalItems,
    startIndex + visibleRowCount + bufferSize * 2
  );

  const visibleCount = endIndex - startIndex;
  const totalHeight = totalItems * rowHeight;
  const offsetY = startIndex * rowHeight;

  return {
    startIndex,
    endIndex,
    visibleCount,
    totalHeight,
    offsetY,
  };
}

export function calculateColumnWidths(
  columns: Array<{ width?: number | string; minWidth?: number; maxWidth?: number }>,
  containerWidth: number
): number[] {
  const fixedColumns: number[] = [];
  const flexColumns: number[] = [];
  let totalFixedWidth = 0;

  // separate fixed and flexible columns
  columns.forEach((column, index) => {
    if (typeof column.width === "number") {
      fixedColumns.push(index);
      totalFixedWidth += column.width;
    } else {
      flexColumns.push(index);
    }
  });

  const availableWidth = containerWidth - totalFixedWidth;
  const flexWidth = Math.max(0, availableWidth / flexColumns.length);

  // calculate final widths
  return columns.map((column, index) => {
    if (fixedColumns.includes(index)) {
      return column.width as number;
    }

    let width = flexWidth;

    if (column.minWidth && width < column.minWidth) {
      width = column.minWidth;
    }

    if (column.maxWidth && width > column.maxWidth) {
      width = column.maxWidth;
    }

    return Math.floor(width);
  });
}

export function isScrollNearBottom(
  scrollTop: number,
  containerHeight: number,
  totalHeight: number,
  threshold: number = 200
): boolean {
  if (containerHeight <= 0 || totalHeight <= 0) return false;

  const scrollBottom = scrollTop + containerHeight;
  const distanceFromBottom = totalHeight - scrollBottom;

  return distanceFromBottom <= threshold;
}

export function clampIndex(index: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, index));
}

export function getRowPosition(index: number, rowHeight: number): {
  top: number;
  height: number;
} {
  return {
    top: index * rowHeight,
    height: rowHeight,
  };
}

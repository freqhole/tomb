import { createSignal } from "solid-js";

export type ViewMode = "compact" | "default" | "detailed";

export interface ViewModeConfig {
  rowHeight: number;
  showThumbnails: boolean;
  maxColumns: number;
  fontSize: string;
  padding: string;
  thumbnailSize: number;
}

export interface UseViewModesReturn {
  viewMode: () => ViewMode;
  setViewMode: (mode: ViewMode) => void;
  getViewModeConfig: () => ViewModeConfig;
  getRowHeight: () => number;
}

const VIEW_MODE_CONFIGS: Record<ViewMode, ViewModeConfig> = {
  compact: {
    rowHeight: 32,
    showThumbnails: false,
    maxColumns: 4,
    fontSize: "11px",
    padding: "4px 8px",
    thumbnailSize: 24,
  },
  default: {
    rowHeight: 50,
    showThumbnails: true,
    maxColumns: 8,
    fontSize: "13px",
    padding: "8px 12px",
    thumbnailSize: 32,
  },
  detailed: {
    rowHeight: 70,
    showThumbnails: true,
    maxColumns: 12,
    fontSize: "14px",
    padding: "12px 16px",
    thumbnailSize: 50,
  },
};

export function useViewModes(initialMode: ViewMode = "default"): UseViewModesReturn {
  const [viewMode, setViewMode] = createSignal<ViewMode>(initialMode);

  const getViewModeConfig = () => VIEW_MODE_CONFIGS[viewMode()];

  const getRowHeight = () => getViewModeConfig().rowHeight;

  return {
    viewMode,
    setViewMode,
    getViewModeConfig,
    getRowHeight,
  };
}

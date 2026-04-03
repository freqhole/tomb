export interface SkeinTheme {
  stageBg: number;
  stageGrid: number;
  frameHeaderBg: number;
  frameHeaderText: number;
  frameBorder: number;
  frameBorderSelected: number;
  frameBorderHover: number;
  frameResizeHandle: number;
  selectionFill: number;
  selectionFillAlpha: number;
  selectionStroke: number;
  accent: number;
  error: number;
  warning: number;
  toolbarBg: number;
  toolbarBorder: number;
  fontFamily: string;
  fontSize: number;
  fontSizeSmall: number;
  frameHeaderHeight: number;
  resizeHandleSize: number;
  frameCornerRadius: number;

  /** resolution multiplier for Text objects — ensures crisp rendering on HiDPI displays */
  textResolution: number;
}

// black canvas with magenta/fuchsia accents
export const defaultTheme: SkeinTheme = {
  stageBg: 0x000000,
  stageGrid: 0x0d0d0d,
  frameHeaderBg: 0x141414,
  frameHeaderText: 0xb0b0b0,
  frameBorder: 0x2a2a2a,
  frameBorderSelected: 0xd946ef,
  frameBorderHover: 0x3d3d3d,
  frameResizeHandle: 0xd946ef,
  selectionFill: 0xd946ef,
  selectionFillAlpha: 0.12,
  selectionStroke: 0xd946ef,
  accent: 0xd946ef,
  error: 0xef4444,
  warning: 0xf59e0b,
  toolbarBg: 0x0a0a0a,
  toolbarBorder: 0x1f1f1f,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 14,
  fontSizeSmall: 11,
  frameHeaderHeight: 28,
  resizeHandleSize: 8,
  frameCornerRadius: 6,
  textResolution: 2,
};

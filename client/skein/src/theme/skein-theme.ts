/**
 * theme definition for the skein canvas.
 * contains colors, dimensions, and font settings
 * used by the canvas chrome (frames, toolbar, stage).
 */
export interface SkeinTheme {
  /** stage background color */
  stageBg: number;
  /** subtle grid/dot pattern color on the stage */
  stageGrid: number;

  /** widget frame header background */
  frameHeaderBg: number;
  /** widget frame header text color */
  frameHeaderText: number;
  /** widget frame border color (default state) */
  frameBorder: number;
  /** widget frame border color (selected) */
  frameBorderSelected: number;
  /** widget frame border color (hovered) */
  frameBorderHover: number;
  /** resize handle color */
  frameResizeHandle: number;

  /** selection rectangle fill (with alpha) */
  selectionFill: number;
  selectionFillAlpha: number;
  /** selection rectangle stroke */
  selectionStroke: number;

  /** primary accent color */
  accent: number;
  /** error/crash indicator color */
  error: number;
  /** warning color */
  warning: number;

  /** default font family */
  fontFamily: string;
  /** default font size */
  fontSize: number;
  /** small font size (labels, metadata) */
  fontSizeSmall: number;

  /** widget frame header height in pixels */
  frameHeaderHeight: number;
  /** resize handle size in pixels */
  resizeHandleSize: number;
  /** corner radius for widget frames */
  frameCornerRadius: number;
}

/**
 * the default dark theme for skein.
 */
export const defaultTheme: SkeinTheme = {
  stageBg: 0x1a1a2e,
  stageGrid: 0x252540,

  frameHeaderBg: 0x2a2a3e,
  frameHeaderText: 0xc8c8d8,
  frameBorder: 0x3a3a50,
  frameBorderSelected: 0x6366f1,
  frameBorderHover: 0x4a4a65,
  frameResizeHandle: 0x6366f1,

  selectionFill: 0x6366f1,
  selectionFillAlpha: 0.1,
  selectionStroke: 0x6366f1,

  accent: 0x6366f1,
  error: 0xef4444,
  warning: 0xf59e0b,

  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 14,
  fontSizeSmall: 11,

  frameHeaderHeight: 28,
  resizeHandleSize: 8,
  frameCornerRadius: 6,
};

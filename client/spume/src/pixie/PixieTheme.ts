// color palette matching the design system theme.css
// all values are PixiJS hex numbers (0xRRGGBB)

export const PixieTheme = {
  // backgrounds
  bgPrimary: 0x000000,
  bgSecondary: 0x0a0a0a,
  bgTertiary: 0x141414,
  bgElevated: 0x1a1a1a,
  bgHover: 0x242424,

  // borders
  borderSubtle: 0x1a1a1a,
  borderDefault: 0x2a2a2a,
  borderStrong: 0x444444,

  // text
  textPrimary: 0xffffff,
  textSecondary: 0xe0e0e0,
  textTertiary: 0x999999,
  textMuted: 0x666666,

  // accent (magenta)
  accent300: 0xff8fe0,
  accent400: 0xff4db8,
  accent500: 0xff1a9e,
  accent600: 0xe6007a,
  accent700: 0xcc0066,

  // semantic
  success: 0x00ff88,
  warning: 0xffaa00,
  error: 0xff3355,
  info: 0x00aaff,

  // as css strings for pixi Text styles
  css: {
    textPrimary: "#ffffff",
    textSecondary: "#e0e0e0",
    textTertiary: "#999999",
    textMuted: "#666666",
    accent500: "#ff1a9e",
    accent600: "#e6007a",
    error: "#ff3355",
  },

  // font config for crisp text rendering
  fontFamily: "'Atkinson Hyperlegible Next', sans-serif",
  // render text at 2x for retina sharpness (pixi defaults to 1x)
  textResolution: typeof window !== "undefined" ? Math.max(window.devicePixelRatio, 2) : 2,
} as const;

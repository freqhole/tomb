/**
 * preload custom fonts so PixiJS Text objects render correctly on first use.
 * must be called early in the boot sequence — before any widgets are mounted.
 */

const CUSTOM_FONTS = [
  "Space Grotesk",
  "Space Mono",
  "Caveat",
  "Permanent Marker",
  "Silkscreen",
  "Playfair Display",
  "Atkinson Hyperlegible Next",
  "JetBrains Mono",
];

/** preload all custom fonts. resolves when all fonts are ready (or after timeout). */
export async function preloadFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;

  const promises = CUSTOM_FONTS.map((family) =>
    document.fonts.load(`400 16px "${family}"`).catch((err) => {
      console.warn(`[fonts] failed to preload "${family}":`, err);
    })
  );

  // wait for all fonts with a 3-second timeout so boot isn't blocked forever
  await Promise.race([
    Promise.allSettled(promises),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);

  console.log("[fonts] custom fonts preloaded");
}

/**
 * the list of all available font families for widget font selectors.
 * includes both system defaults and custom loaded fonts.
 */
export const FONT_OPTIONS = [
  "system-ui, sans-serif",
  "Georgia, serif",
  "Courier New, monospace",
  "cursive",
  "Space Grotesk",
  "Space Mono",
  "Caveat",
  "Permanent Marker",
  "Silkscreen",
  "Playfair Display",
  "Atkinson Hyperlegible Next",
  "JetBrains Mono",
];

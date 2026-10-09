import autoprefixer from "autoprefixer";
import postcssPresetEnv from "postcss-preset-env";
import tailwindcss from "@tailwindcss/postcss";

// @tailwindcss/postcss's default palette/opacity-modifier output leans
// heavily on modern CSS color functions - oklch() colors (confirmed 81
// occurrences) AND color-mix() (opacity modifiers like bg-red-500/50,
// confirmed 450(!) occurrences) AND @property (confirmed 72 occurrences,
// used for gradient/animation utilities) - none of which Catalina's
// WebKit can parse. unparseable CSS values/at-rules are silently
// DROPPED rather than erroring (confirmed real symptom 2026-10-07: "lots
// of missing styles", not a crash). postcss-preset-env bundles the full
// csstools downlevel-polyfill set (oklab-function, color-mix-function,
// custom-properties-from-@property, etc.) and auto-enables whichever
// ones the given `browsers` target actually lacks - far less
// whack-a-mole than hand-picking individual @csstools/* plugins one
// newly-discovered function at a time. only applied for the one build
// that actually needs it (see vite.config.ts's needsLegacySafariTarget).
const needsLegacySafariTarget = !!process.env.VITE_LEGACY_SAFARI_TARGET;

// tailwind's neutral palette uses "none" for oklch()'s hue component on
// pure grays (oklch(97% 0 none) - hue is meaningless at zero chroma).
// the oklab-function transform (bundled inside postcss-preset-env)
// doesn't accept the "none" keyword there and leaves those declarations
// untouched (confirmed real 2026-10-07) - swap it for a literal 0 first
// (chroma is 0 either way, so the angle is inert) so the parser
// downstream has only numbers to deal with.
function oklchNoneFallbackPlugin() {
  return {
    postcssPlugin: "oklch-none-fallback",
    Once(root) {
      root.walkDecls((decl) => {
        if (decl.value?.includes("oklch(") && decl.value.includes("none")) {
          decl.value = decl.value.replace(/(oklch\([^)]*)\bnone\b([^)]*\))/g, "$10$2");
        }
      });
    },
  };
}
oklchNoneFallbackPlugin.postcss = true;

export default {
  plugins: [
    tailwindcss(),
    ...(needsLegacySafariTarget
      ? [
        oklchNoneFallbackPlugin(),
        postcssPresetEnv({
          browsers: "safari >= 13",
          preserve: false,
          // color-mix()'s arguments are often `var(--color-*)` refs
          // (tailwind's opacity-modifier utilities, e.g. bg-red-500/50)
          // - color-mix-function can't compute a static rgb() fallback
          // without a concrete color, so it's a no-op unless custom
          // property values are inlined first too. confirmed safe here:
          // this app's own @theme tokens (design-system/theme.css) are
          // plain hex, single-valued, never reassigned via a `.dark`
          // selector or `prefers-color-scheme` query - only Tailwind's
          // built-in default palette (used by ad-hoc utility classes)
          // is oklch-based, so inlining loses no actual theming
          // flexibility here.
          features: { "custom-properties": { preserve: false } },
        }),
      ]
      : []),
    autoprefixer(),
  ],
};

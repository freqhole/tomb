import { defineMain } from "storybook-solidjs-vite";

export default defineMain({
  framework: {
    name: "storybook-solidjs-vite",
    // storybook-solidjs-vite's docgen transform matches any .jsx/.tsx file
    // vite serves individually (no node_modules exclusion), including
    // @solidjs/router's dist/index.jsx (a pure `export *` barrel with no
    // local bindings). its docgen manager resolves `A` (the router's real
    // <A> component, re-exported transitively) as one of the barrel's
    // exports and appends `A.__docgenInfo = ...` onto index.jsx itself,
    // where `A` was never a local identifier -> ReferenceError at runtime.
    // disabling docgen avoids this upstream bug entirely.
    options: { docgen: false },
  },
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-links",
    "@storybook/addon-vitest",
  ],
  stories: ["../stories/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
});

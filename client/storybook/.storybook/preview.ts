import addonA11y from "@storybook/addon-a11y";
import addonDocs from "@storybook/addon-docs";
import { definePreview } from "storybook-solidjs-vite";
import "./global.css";

export default definePreview({
  addons: [addonDocs(), addonA11y()],
  parameters: {
    // dark theme for storybook UI
    docs: {
      theme: {
        base: "dark",
        colorPrimary: "#d946ef",
        colorSecondary: "#d946ef",
        appBg: "#202124",
        appContentBg: "#202124",
        appBorderColor: "#3c4043",
        textColor: "#ffffff",
        textInverseColor: "#202124",
        barTextColor: "#ffffff",
        barSelectedColor: "#d946ef",
        barBg: "#202124",
        inputBg: "#3c4043",
        inputBorder: "#5f6368",
        inputTextColor: "#ffffff",
      },
    },
    // automatically create action args for all props that start with 'on'
    actions: {
      argTypesRegex: "^on.*",
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: "todo",
    },
    // dark theme by default
    backgrounds: {
      default: "dark",
      options: {
        dark: { name: "dark", value: "#202124" },
        light: { name: "light", value: "#ffffff" },
      },
    },
  },
  // All components will have an automatically generated Autodocs entry: https://storybook.js.org/docs/writing-docs/autodocs
  // tags: ['autodocs'],
});

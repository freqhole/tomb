/** @type {import('tailwindcss').Config} */
export default {
  content: [
    // Current directory (src/views/freqhole-music-admin)
    "./**/*.{js,jsx,ts,tsx}",
    // Go up to src and scan everything
    "../../**/*.{js,jsx,ts,tsx}",
  ],

  theme: {
    extend: {
      colors: {
        magenta: {
          50: "#fdf4ff",
          100: "#fae8ff",
          200: "#f5d0fe",
          300: "#f0abfc",
          400: "#e879f9",
          500: "#d946ef", // Primary magenta
          600: "#c026d3",
          700: "#a21caf",
          800: "#86198f",
          900: "#701a75",
        },
        // Keep existing dark theme colors
        dark: {
          50: "#f8f9fa",
          100: "#f1f3f4",
          200: "#e8eaed",
          300: "#dadce0",
          400: "#bdc1c6",
          500: "#9aa0a6",
          600: "#80868b",
          700: "#5f6368",
          800: "#3c4043",
          900: "#202124",
        },
      },
      animation: {
        slideInRight: "slideInRight 0.3s ease-out",
        slideDown: "slideDown 0.3s ease-out",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        slideInRight: {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        slideDown: {
          from: { transform: "translateY(-100%)" },
          to: { transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

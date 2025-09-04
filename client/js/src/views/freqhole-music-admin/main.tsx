/* @jsxImportSource solid-js */
import { render } from "solid-js/web";
import FreqHoleMusicAdmin from "./index.js";

// Get API base URL from environment or default to current origin
const getApiBaseUrl = () => {
  // Check if we're in development mode
  const isDev = import.meta.env.DEV;

  if (isDev) {
    // In development, try to connect to local server
    return import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
  }

  // In production, use current origin
  return window.location.origin;
};

// Initialize and render the app
const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found. Make sure there's a div with id='root' in your HTML.");
}

// Clear loading state
root.innerHTML = "";

// Render the FreqHole Music Admin app
render(() => (
  <FreqHoleMusicAdmin
    apiBaseUrl={getApiBaseUrl()}
    theme="dark"
    debug={import.meta.env.DEV}
  />
), root);

console.log("FreqHole Music Admin initialized with:", {
  apiBaseUrl: getApiBaseUrl(),
  isDev: import.meta.env.DEV,
  mode: import.meta.env.MODE,
});

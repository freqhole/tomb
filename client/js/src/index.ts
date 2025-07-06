// Main Client JS exports - re-export everything from the lib directory
export * from "./lib/index.js";

// Search hooks exports
export * from "./hooks/search/index.js";

// Note: Web components are available in src/web-components/ but not exported here
// to keep the core library separate from UI components.
//
// To use web components, import them directly:
// import './src/web-components/websocket-demo.js';
//
// Or build them separately using the web component build process.

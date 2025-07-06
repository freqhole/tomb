import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

interface ComponentTemplate {
  name: string;
  title: string;
  description: string;
  element: string;
  attributes: Record<string, string>;
  instructions: string[];
  styles?: string;
}

const COMPONENT_TEMPLATES: Record<string, ComponentTemplate> = {
  webauthn: {
    name: "webauthn-auth",
    title: "WebAuthn Component Test",
    description: "🔐 WebAuthn Authentication Testing",
    element: "webauthn-auth",
    attributes: {
      "base-url": "http://localhost:8080",
      theme: "dark",
    },
    instructions: [
      "Make sure your server is running on <code>http://localhost:8080</code>",
      "Click register to create a new WebAuthn credential",
      "Try logging in with your registered credential",
    ],
  },
  websocket: {
    name: "websocket-components",
    title: "WebSocket Components Test",
    description: "🔌 WebSocket Connection Testing",
    element: "websocket-handler",
    attributes: {
      websocketUrl: "ws://localhost:8080/ws",
      autoConnect: "false",
      showDebugLog: "true",
    },
    instructions: [
      "Make sure your WebSocket server is running on <code>ws://localhost:8080/ws</code>",
      "Click connect to establish WebSocket connection",
      "Try sending messages and observe the debug log",
    ],
    styles: `
      .websocket-status {
        margin: 20px 0;
      }
    `,
  },
  "websocket-demo": {
    name: "websocket-demo",
    title: "WebSocket Demo - Modular Components",
    description: "🚀 Complete WebSocket Demo with All Components",
    element: "websocket-demo",
    attributes: {
      websocketUrl: "ws://localhost:8080/ws",
      autoConnect: "false",
      showDebugLog: "true",
    },
    instructions: [
      "Make sure your server is running on <code>localhost:8080</code>",
      "Components demonstrate full WebSocket functionality",
      "Try uploading files and watch real-time updates",
    ],
  },
  "websocket-feed-demo": {
    name: "websocket-feed-demo",
    title: "WebSocket Feed Demo - Real-time Media Blob Feed",
    description: "🔄 Real-time Media Blob Feed with WebSocket Notifications",
    element: "websocket-feed-demo",
    attributes: {
      "ws-url": "ws://localhost:8080/ws",
      channels: '["MediaBlobs"]',
      debug: "true",
      "auto-connect": "true",
      "item-mode": "default",
      "max-height": "500px",
      "show-controls": "true",
      "show-stats": "true",
    },
    instructions: [
      "Make sure your server is running on <code>localhost:8080</code> with WebSocket support",
      "The demo automatically connects and subscribes to media blob notifications",
      "Try uploading files through the API to see real-time feed updates",
      "No more polling - updates happen instantly via WebSocket!",
    ],
  },

  "sync-demo": {
    name: "sync-demo",
    title: "Sync Demo - Media Blob Sync System",
    description: "🔄 Media Blob Sync System - End-to-End Component Testing",
    element: "sync-demo",
    attributes: {
      "api-base-url": "http://localhost:8080",
      "client-id": "standalone-demo",
      "auto-connect": "true",
    },
    instructions: [
      "Make sure your API server is running on <code>http://localhost:8080</code>",
      "Components will auto-connect and show real sync status",
      "Try starting a sync operation to see live progress updates",
      "Note: Polling has been removed in favor of WebSocket notifications",
    ],
  },

  "infinite-data-grid": {
    name: "infinite-data-grid",
    title: "Employee Data Grid Demo",
    description: "🚀 Employee Data Grid with Filtering & Sorting",
    element: "infinite-data-grid",
    attributes: {},
    instructions: [
      "Click column headers to sort data",
      "Use filter toggle to show/hide side panel",
      "Search by name, filter by department/status",
      "Scroll through 10,000 employee rows with virtual scrolling",
      "Built with reusable GenericInfiniteGrid component",
    ],
    styles: `
      body { margin: 0; padding: 0; overflow: hidden; }
      .container { max-width: none; margin: 0; }
    `,
  },

  "freqhole-demo": {
    name: "freqhole-demo",
    title: "Freqhole Demo - MediaBlob Data Grid",
    description: "🔍 MediaBlob Data Grid with Panels and WebSocket Feed",
    element: "freqhole-demo",
    attributes: {
      "ws-url": "ws://localhost:8080/ws",
      "api-base-url": "http://localhost:8080",
      "auto-connect": "true",
    },
    instructions: [
      "Make sure your server is running on <code>localhost:8080</code>",
      "Browse panel (left) for name search",
      "Filter panel (right) with controls - test resizing!",
      "Real-time WebSocket updates for media blobs",
      "Modular architecture with reusable components",
    ],
    styles: `
      body { margin: 0; padding: 0; overflow: hidden; }
      .container { max-width: none; margin: 0; }
    `,
  },

  "websocket-thumbnail-demo": {
    name: "websocket-thumbnail-demo",
    title: "WebSocket Thumbnail Demo",
    description: "🖼️ WebSocket Thumbnail Binary Data Demo",
    element: "websocket-thumbnail-demo",
    attributes: {
      "ws-url": "ws://localhost:8080/ws",
      "api-base-url": "http://localhost:8080",
      title: "WebSocket Thumbnail Demo",
    },
    instructions: [
      "Make sure your server is running on <code>localhost:8080</code>",
      "This demo shows how thumbnail binary data flows through WebSocket",
      "Click Connect → Load Blobs → Get Thumbnails to see the pattern",
      "Only shows media blobs that have thumbnails (small binary data)",
      "Perfect for understanding the sync system's thumbnail data flow",
    ],
  },

  "unified-sync-demo": {
    name: "unified-sync-demo",
    title: "Unified Sync System Demo - Phase 4",
    description: "🚀 Unified Sync System with Auto-Sync & Service Worker",
    element: "unified-sync-demo",
    attributes: {
      "api-base-url": "http://localhost:8080",
      "auto-connect": "true",
      "enable-service-worker": "true",
      "enable-auto-sync": "true",
      "enable-user-notifications": "true",
    },
    instructions: [
      "Make sure your Axum server is running on <code>localhost:8080</code> (API) and WebSocket on <code>localhost:8080</code>",
      "Phase 4: Complete unified sync system with single 'Sync All' button",
      "Features auto-connect, service worker background sync, and real-time notifications",
      "Uses the new clean sync/ system instead of sync-legacy/",
      "Toggle service worker and auto-sync features to see the system in action",
    ],
  },

  "search-demo": {
    name: "search-demo",
    title: "Search Demo - Modular Search Components",
    description: "🔍 Search Demo with Autocomplete, Filters, and Results",
    element: "search-demo",
    attributes: {
      "api-base-url": "http://localhost:8080",
      "auto-connect": "true",
    },
    instructions: [
      "Make sure your server is running on <code>localhost:8080</code>",
      "Phase 3: Modular search components with autocomplete suggestions",
      "Features standalone SearchBox, SearchSuggestions, and SearchFilters",
      "Components are hook-driven and easily portable to other applications",
      "Try searching and using the filter panel to see the system in action",
    ],
  },

  "product-data-grid-demo": {
    name: "product-data-grid-demo",
    title: "Product Catalog Grid Demo",
    description: "🛍️ Product Catalog with Generic Infinite Grid",
    element: "product-data-grid-demo",
    attributes: {},
    instructions: [
      "Example of GenericInfiniteGrid with different data type",
      "Click column headers to sort products",
      "Custom renderers for price, stock, and ratings",
      "Scroll through 5,000 product rows smoothly",
      "Shows reusability of the grid component",
    ],
    styles: `
      body { margin: 0; padding: 0; overflow: hidden; }
      .container { max-width: none; margin: 0; }
    `,
  },
};

function generateHtmlTemplate(
  template: ComponentTemplate,
  jsCode: string
): string {
  const attributesStr = Object.entries(template.attributes)
    .map(([key, value]) => {
      // Escape quotes in attribute values
      const escapedValue = value.replace(/"/g, "&quot;");
      return `${key}="${escapedValue}"`;
    })
    .join(" ");

  return `<!--
${template.title}
${template.description}

${template.instructions.join("\n        ")}
-->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${template.title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0px;
      padding: 0px;
      background-color: black;
      color: white;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
    }
    ${template.styles || ""}
  </style>
</head>
<body>
  <div class="container">
    <${template.element} ${attributesStr}></${template.element}>
  </div>

  <script type="module">
${jsCode}
  </script>
</body>
</html>`;
}

function generateStandaloneFiles(): import("vite").Plugin {
  return {
    name: "generate-standalone-files",
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).filter(
        (file): file is import("rollup").OutputChunk =>
          file.type === "chunk" && typeof file.code === "string"
      );

      for (const chunk of chunks) {
        // Map JS file names back to template keys
        const nameMapping: Record<string, string> = {
          "webauthn-auth.js": "webauthn",
          "websocket-components.js": "websocket",
          "websocket-demo.js": "websocket-demo",
          "websocket-feed-demo.js": "websocket-feed-demo",
          "sync-demo.js": "sync-demo",
          "infinite-data-grid.js": "infinite-data-grid",
          "product-data-grid-demo.js": "product-data-grid-demo",
          "freqhole-demo.js": "freqhole-demo",
          "websocket-thumbnail-demo.js": "websocket-thumbnail-demo",
          "unified-sync-demo.js": "unified-sync-demo",
          "search-demo.js": "search-demo",
        };

        const templateKey = nameMapping[chunk.fileName];
        const template = templateKey ? COMPONENT_TEMPLATES[templateKey] : null;

        if (!template) {
          // Skip chunks that don't have templates (shared dependencies, etc)
          continue;
        }

        // Generate standalone HTML
        const html = generateHtmlTemplate(template, chunk.code);
        this.emitFile({
          type: "asset",
          fileName: `${template.name}-standalone.html`,
          source: html,
        });

        // Generate standalone JS
        this.emitFile({
          type: "asset",
          fileName: `${template.name}-standalone.js`,
          source: chunk.code,
        });

        console.log(`✅ Generated standalone files for: ${template.name}`);
      }

      // Generate all components standalone JS
      const allComponentsChunk = chunks.find((chunk) =>
        chunk.fileName.includes("all-components")
      );

      if (allComponentsChunk) {
        this.emitFile({
          type: "asset",
          fileName: "all-components-standalone.js",
          source: allComponentsChunk.code,
        });
        console.log("✅ Generated all-components standalone file");
      }

      console.log("🎉 All standalone files generated successfully!");
    },
  };
}

export default defineConfig({
  plugins: [
    solid({
      typescript: true,
      jsx: "preserve",
    }),
    generateStandaloneFiles(),
  ],
  build: {
    outDir: "dist",
    target: "esnext",
    minify: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        webauthn: "./src/web-components/webauthn-component.tsx",
        websocket: "./src/web-components/websocket-handler.tsx",
        "websocket-demo": "./src/web-components/websocket-demo.tsx",
        "websocket-feed-demo": "./src/web-components/websocket-feed-demo.tsx",
        "sync-demo": "./src/web-components/sync-demo.tsx",
        "infinite-data-grid": "./src/web-components/infinite-data-grid.tsx",
        "product-data-grid-demo":
          "./src/web-components/product-data-grid-demo.tsx",
        "freqhole-demo": "./src/web-components/freqhole-demo.tsx",
        "websocket-thumbnail-demo":
          "./src/web-components/websocket-thumbnail-demo.tsx",
        "unified-sync-demo": "./src/web-components/unified-sync-demo.tsx",
        "search-demo": "./src/web-components/search-demo.tsx",
        "all-components": "./src/web-components/index.tsx",
      },
      output: {
        entryFileNames: (chunkInfo) => {
          const nameMap: Record<string, string> = {
            webauthn: "webauthn-auth.js",
            websocket: "websocket-components.js",
            "websocket-demo": "websocket-demo.js",
            "websocket-feed-demo": "websocket-feed-demo.js",
            "sync-demo": "sync-demo.js",
            "infinite-data-grid": "infinite-data-grid.js",
            "product-data-grid-demo": "product-data-grid-demo.js",
            "freqhole-demo": "freqhole-demo.js",
            "websocket-thumbnail-demo": "websocket-thumbnail-demo.js",
            "unified-sync-demo": "unified-sync-demo.js",
            "search-demo": "search-demo.js",
            "all-components": "all-components.js",
          };
          return nameMap[chunkInfo.name] || "[name].js";
        },
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "[name]-[hash].[ext]",
      },
    },
  },
});

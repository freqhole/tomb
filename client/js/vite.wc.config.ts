import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

// Component-specific attributes configuration
const COMPONENT_ATTRIBUTES: Record<string, Record<string, string>> = {
  "webauthn-auth": {
    "base-url": "http://localhost:8080",
    theme: "dark",
  },
  "websocket-handler": {
    websocketUrl: "ws://localhost:8080/ws",
    autoConnect: "false",
    showDebugLog: "true",
  },
  "websocket-demo": {
    websocketUrl: "ws://localhost:8080/ws",
    autoConnect: "false",
    showDebugLog: "true",
  },
  "websocket-feed-demo": {
    "ws-url": "ws://localhost:8080/ws",
    channels: '["MediaBlobs"]',
    debug: "true",
    "auto-connect": "true",
    "item-mode": "default",
    "max-height": "500px",
    "show-controls": "true",
    "show-stats": "true",
  },
  "infinite-data-grid": {},
  "product-data-grid-demo": {},
  "freqhole-demo": {
    "ws-url": "ws://localhost:8080/ws",
    "api-base-url": "http://localhost:8080",
    "auto-connect": "true",
  },
  "unified-sync-demo": {
    "api-base-url": "http://localhost:8080",
    "auto-connect": "true",
    "enable-service-worker": "true",
    "enable-auto-sync": "true",
    "enable-user-notifications": "true",
  },
  "search-demo": {
    "api-base-url": "http://localhost:8080",
    "auto-connect": "true",
  },
  "zune-demo": {
    "api-base-url": "http://localhost:8080",
    "auto-connect": "true",
  },
  "playlistz-app": {},
};

// Dynamically discover web components
function discoverWebComponents(): Record<string, string> {
  const webComponentsDir = path.resolve("src/web-components");
  const files = fs.readdirSync(webComponentsDir);

  const components: Record<string, string> = {};

  files.forEach((file) => {
    if (file.endsWith(".tsx") && file !== "index.tsx") {
      const name = file.replace(".tsx", "");
      components[name] = `./src/web-components/${file}`;
    }
  });

  console.log("🔍 Discovered web components:", Object.keys(components));
  return components;
}

// Extract element name from component file
function getElementNameFromFile(componentName: string): string {
  const filePath = path.resolve(`src/web-components/${componentName}.tsx`);

  try {
    const content = fs.readFileSync(filePath, "utf-8");

    // Look for customElements.define() calls
    const defineMatch = content.match(
      /customElements\.define\s*\(\s*["']([^"']+)["']/
    );
    if (defineMatch) {
      return defineMatch[1];
    }

    // Fallback: convert component name to kebab-case
    return componentName
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase()
      .replace(/^-/, "");
  } catch (error) {
    console.warn(`⚠️ Could not read ${componentName}.tsx, using fallback name`);
    return componentName
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase()
      .replace(/^-/, "");
  }
}

// Generate simple HTML template
function generateHtmlTemplate(
  elementName: string,
  jsCode: string,
  cssCode?: string
): string {
  const attributes = COMPONENT_ATTRIBUTES[elementName] || {};
  const attributesStr = Object.entries(attributes)
    .map(([key, value]) => `${key}="${value.replace(/"/g, "&quot;")}"`)
    .join(" ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${elementName}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 0;
      background-color: black;
      color: white;
    }
    ${cssCode || ""}
  </style>
</head>
<body>
  <${elementName} ${attributesStr}></${elementName}>
  <script type="module">
${jsCode}
  </script>
</body>
</html>`;
}

// Plugin to generate standalone HTML files
function generateStandaloneHtml(): import("vite").Plugin {
  return {
    name: "generate-standalone-html",
    generateBundle(_, bundle) {
      // Collect all CSS content
      const allCssFiles = Object.values(bundle).filter(
        (file): file is import("rollup").OutputAsset =>
          file.type === "asset" &&
          typeof file.fileName === "string" &&
          file.fileName.endsWith(".css")
      );

      const combinedCss = allCssFiles
        .map((cssFile) => cssFile.source as string)
        .join("\n\n");

      // Process each entry chunk
      const chunks = Object.values(bundle).filter(
        (file): file is import("rollup").OutputChunk =>
          file.type === "chunk" && file.isEntry && typeof file.code === "string"
      );

      for (const chunk of chunks) {
        const componentName = chunk.name;
        if (!componentName) continue;

        const elementName = getElementNameFromFile(componentName);
        const html = generateHtmlTemplate(elementName, chunk.code, combinedCss);

        this.emitFile({
          type: "asset",
          fileName: `${elementName}.html`,
          source: html,
        });

        console.log(`✅ Generated: ${elementName}.html`);
      }

      // Remove JS and CSS files from output - only keep HTML
      Object.keys(bundle).forEach((fileName) => {
        if (fileName.endsWith(".js") || fileName.endsWith(".css")) {
          delete bundle[fileName];
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    solid({
      typescript: true,
      jsx: "preserve",
    }),
    tailwindcss(),
    generateStandaloneHtml(),
  ],
  build: {
    outDir: "dist",
    target: "esnext",
    minify: true,
    sourcemap: false,
    rollupOptions: {
      input: discoverWebComponents(),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
});

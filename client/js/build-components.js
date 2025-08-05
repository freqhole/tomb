#!/usr/bin/env node
/* global console, process */
import { build } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

// Read service worker template
function getServiceWorkerCode() {
  const swTemplatePath = path.resolve("src/sw-template.js");
  if (fs.existsSync(swTemplatePath)) {
    return fs.readFileSync(swTemplatePath, "utf-8");
  }
  return null;
}

// Component-specific attributes configuration
const COMPONENT_ATTRIBUTES = {
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
  "freqhole-playlistz": {},
};

// Dynamically discover web components
function discoverWebComponents() {
  const webComponentsDir = path.resolve("src/web-components");
  const files = fs.readdirSync(webComponentsDir);

  const components = [];

  files.forEach((file) => {
    if (file.endsWith(".tsx") && file !== "index.tsx") {
      components.push(file.replace(".tsx", ""));
    }
  });

  console.log("🔍 Discovered web components:", components);
  return components;
}

// Extract element name from component file
function getElementNameFromFile(componentName) {
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
    console.warn(
      `⚠️ Could not read ${componentName}.tsx, using fallback name. error: ${error}`
    );
    return componentName
      .replace(/([A-Z])/g, "-$1")
      .toLowerCase()
      .replace(/^-/, "");
  }
}

// Generate simple HTML template
function generateHtmlTemplate(elementName, jsCode, cssCode) {
  const attributes = COMPONENT_ATTRIBUTES[elementName] || {};
  const attributesStr = Object.entries(attributes)
    .map(([key, value]) => `${key}="${value.replace(/"/g, "&quot;")}"`)
    .join(" ");

  // Add basic PWA meta tags for playlistz component (manifest will be generated dynamically)
  const isPWA = elementName === "freqhole-playlistz";
  const pwaMetaTags = isPWA
    ? `
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#000000">`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${elementName}</title>${pwaMetaTags}
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 16px;
      margin: 0;
      padding: 0;
      background-color: black;
      color: white;
    }
    /* Ensure proper text wrapping */
    .break-words {
      word-wrap: break-word;
      word-break: break-word;
      overflow-wrap: break-word;
      hyphens: auto;
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

// Build all components separately
async function buildAllComponents() {
  const allComponents = discoverWebComponents();

  // Check for component filter argument
  const filterArg = process.argv[2];
  let components = allComponents;

  if (filterArg) {
    components = allComponents.filter((component) => {
      const elementName = getElementNameFromFile(component);
      return component.includes(filterArg) || elementName.includes(filterArg);
    });

    if (components.length === 0) {
      console.log(`❌ No components found matching "${filterArg}"`);
      console.log(
        `Available components:`,
        allComponents.map(getElementNameFromFile)
      );
      process.exit(1);
    }

    console.log(
      `🔍 Filtering to components matching "${filterArg}":`,
      components.map(getElementNameFromFile)
    );
  }

  console.log(`🔨 Building ${components.length} components separately...`);

  // Clear dist directory first
  const distDir = path.resolve("dist");
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  for (const component of components) {
    console.log(`📦 Building ${component}...`);

    try {
      await build({
        configFile: false,
        plugins: [
          solid({
            typescript: true,
            jsx: "preserve",
          }),
          tailwindcss(),
          {
            name: "generate-standalone-html",
            generateBundle(_, bundle) {
              const jsChunk = Object.values(bundle).find(
                (file) => file.type === "chunk" && typeof file.code === "string"
              );

              const cssAsset = Object.values(bundle).find(
                (file) =>
                  file.type === "asset" &&
                  typeof file.fileName === "string" &&
                  file.fileName.endsWith(".css")
              );

              if (jsChunk) {
                const elementName = getElementNameFromFile(component);
                const cssCode = cssAsset ? cssAsset.source : undefined;
                const html = generateHtmlTemplate(
                  elementName,
                  jsChunk.code,
                  cssCode
                );

                this.emitFile({
                  type: "asset",
                  fileName: `${elementName}.html`,
                  source: html,
                });

                console.log(`✅ Generated: ${elementName}.html`);

                // Generate service worker for playlistz component
                console.log(
                  `🔍 Checking if should generate SW for: ${elementName}`
                );
                if (elementName === "freqhole-playlistz") {
                  console.log(
                    `📦 Generating service worker for ${elementName}...`
                  );
                  const swCode = getServiceWorkerCode();
                  if (swCode) {
                    this.emitFile({
                      type: "asset",
                      fileName: "sw.js",
                      source: swCode,
                    });
                    console.log(`✅ Generated: sw.js`);
                  } else {
                    console.log(`❌ No service worker template found`);
                  }
                } else {
                  console.log(`⏭️ Skipping SW generation for ${elementName}`);
                }

                // Remove JS and CSS files from output (but keep sw.js)
                Object.keys(bundle).forEach((fileName) => {
                  if (
                    (fileName.endsWith(".js") || fileName.endsWith(".css")) &&
                    fileName !== "sw.js"
                  ) {
                    delete bundle[fileName];
                  }
                });
              }
            },
          },
        ],
        build: {
          outDir: "dist",
          target: "esnext",
          minify: true,
          sourcemap: false,
          emptyOutDir: false,
          rollupOptions: {
            input: `./src/web-components/${component}.tsx`,
            output: {
              entryFileNames: `${component}.js`,
              chunkFileNames: `${component}-[hash].js`,
              assetFileNames: `${component}.[ext]`,
              inlineDynamicImports: true,
            },
          },
        },
      });
    } catch (error) {
      console.error(`❌ Error building ${component}:`, error);
      process.exit(1);
    }
  }

  console.log("🎉 All components built successfully!");
}

buildAllComponents();

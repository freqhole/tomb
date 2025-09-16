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

// Generate PWA manifest as data URI for inline embedding
function generatePWAManifest(elementName) {
  const manifest = {
    name: "freqhole",
    short_name: "freqhole",
    description: "music player and library manager",
    start_url: "./",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    orientation: "portrait-primary",
    categories: ["music", "entertainment"],
    icons: [
      {
        src:
          "data:image/svg+xml;base64," +
          btoa(`
          <svg width="192" height="192" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
            <rect width="192" height="192" fill="#000000"/>
            <path d="M96 48c-26.5 0-48 21.5-48 48s21.5 48 48 48 48-21.5 48-48-21.5-48-48-48zm0 12c6 0 12 2 16.8 5.6L96 96l-16.8-30.4c4.8-3.6 10.8-5.6 16.8-5.6zm-24 24c0-4 1-8 2.8-11.2L96 96 74.8 132.8c-1.8-3.2-2.8-7.2-2.8-11.2zm48 0c0 4-1 8-2.8 11.2L96 96l21.2-33.2c1.8 3.2 2.8 7.2 2.8 11.2zm-24 36c-6 0-12-2-16.8-5.6L96 96l16.8 30.4c-4.8 3.6-10.8 5.6-16.8 5.6z" fill="#d946ef"/>
          </svg>
        `),
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src:
          "data:image/svg+xml;base64," +
          btoa(`
          <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <rect width="512" height="512" fill="#000000"/>
            <path d="M256 128c-70.7 0-128 57.3-128 128s57.3 128 128 128 128-57.3 128-128-57.3-128-128-128zm0 32c16 0 32 5.3 44.8 14.9L256 256l-44.8-81.1c12.8-9.6 28.8-14.9 44.8-14.9zm-64 64c0-10.7 2.7-21.3 7.5-30.9L256 256l-56.5 102.9c-4.8-9.6-7.5-20.2-7.5-30.9zm128 0c0 10.7-2.7 21.3-7.5 30.9L256 256l56.5-102.9c4.8 9.6 7.5 20.2 7.5 30.9zm-64 96c-16 0-32-5.3-44.8-14.9L256 256l44.8 81.1c-12.8 9.6-28.8 14.9-44.8 14.9z" fill="#d946ef"/>
          </svg>
        `),
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
  };

  const manifestJson = JSON.stringify(manifest);
  const manifestBase64 = Buffer.from(manifestJson).toString("base64");
  return `data:application/json;base64,${manifestBase64}`;
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

  console.log("found these web components:", components);
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
      `could not read ${componentName}.tsx, using fallback name. error: ${error}`
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

  // Enable PWA for freqhole components
  const isPWA =
    elementName === "freqhole-demo" || elementName === "freqhole-playlistz";

  let pwaMetaTags = "";
  let manifestLink = "";

  if (isPWA) {
    const manifestDataUri = generatePWAManifest(elementName);
    pwaMetaTags = `
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="freqhole">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="theme-color" content="#000000">
  <meta name="apple-touch-fullscreen" content="yes">
  <meta name="format-detection" content="telephone=no">`;

    manifestLink = `
  <link rel="manifest" href="${manifestDataUri}">`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>F R E Q H O L E</title>${pwaMetaTags}${manifestLink}
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
      console.log(`no components found matching "${filterArg}"`);
      console.log(
        `available components:`,
        allComponents.map(getElementNameFromFile)
      );
      process.exit(1);
    }

    console.log(
      `filtering to components matching "${filterArg}":`,
      components.map(getElementNameFromFile)
    );
  }

  console.log(`building ${components.length} components separately...`);

  // Clear dist directory first
  const distDir = path.resolve("dist");
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  for (const component of components) {
    console.log(`building ${component}...`);

    try {
      await build({
        configFile: false,
        plugins: [
          solid({
            typescript: true,
            jsx: "preserve",
          }),
          tailwindcss({
            config: "./tailwind.config.js",
          }),
          {
            name: "generate-standalone-html",
            generateBundle(_, bundle) {
              // Debug: log all files in bundle
              console.log(`Debug: Bundle contents for ${component}:`);
              Object.keys(bundle).forEach((fileName) => {
                const file = bundle[fileName];
                console.log(`  - ${fileName} (type: ${file.type})`);
              });

              const jsChunk = Object.values(bundle).find(
                (file) => file.type === "chunk" && typeof file.code === "string"
              );

              const cssAsset = Object.values(bundle).find(
                (file) =>
                  file.type === "asset" &&
                  typeof file.fileName === "string" &&
                  file.fileName.endsWith(".css")
              );

              console.log(`Debug: Found JS chunk: ${!!jsChunk}`);
              console.log(`Debug: Found CSS asset: ${!!cssAsset}`);
              if (cssAsset) {
                console.log(`Debug: CSS file name: ${cssAsset.fileName}`);
                console.log(
                  `Debug: CSS size: ${cssAsset.source?.length || 0} chars`
                );
              }

              if (jsChunk) {
                const elementName = getElementNameFromFile(component);
                const cssCode = cssAsset ? cssAsset.source : undefined;
                console.log(`Debug: cssCode defined: ${!!cssCode}`);
                console.log(`Debug: cssCode length: ${cssCode?.length || 0}`);
                console.log(
                  `Debug: cssCode preview: ${cssCode?.substring(0, 100)}...`
                );
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

                console.log(`generated: ${elementName}.html`);

                // Generate service worker for freqhole components
                console.log(
                  `Checking if should generate SW for: ${elementName}`
                );
                if (
                  elementName === "freqhole-demo" ||
                  elementName === "freqhole-playlistz"
                ) {
                  console.log(
                    `generating service worker for ${elementName}...`
                  );
                  const swCode = getServiceWorkerCode();
                  if (swCode) {
                    this.emitFile({
                      type: "asset",
                      fileName: "sw.js",
                      source: swCode,
                    });
                    console.log(`generated: sw.js`);
                  } else {
                    console.log(`No service worker template found`);
                  }
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
      console.error(`error building ${component}:`, error);
      process.exit(1);
    }
  }

  console.log("all components built successfully!");
}

buildAllComponents();

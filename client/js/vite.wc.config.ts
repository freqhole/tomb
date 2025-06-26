import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

function inlineHtmlTemplate(): import("vite").Plugin {
  return {
    name: "generate-html-templates",
    generateBundle(_, bundle) {
      const jsAsset = Object.values(bundle).find(
        (file) => file.type === "chunk" && file.fileName.includes("webauthn")
      );

      const wsAsset = Object.values(bundle).find(
        (file) => file.type === "chunk" && file.fileName.includes("websocket")
      );

      const allAsset = Object.values(bundle).find(
        (file) =>
          file.type === "chunk" && file.fileName.includes("all-components")
      );

      const demoAsset = Object.values(bundle).find(
        (file) =>
          file.type === "chunk" && file.fileName.includes("websocket-demo")
      );

      const syncDemoAsset = Object.values(bundle).find(
        (file) => file.type === "chunk" && file.fileName.includes("sync-demo")
      );

      // Generate WebAuthn standalone HTML
      if (jsAsset && jsAsset.type === "chunk") {
        const webauthnHtml = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WebAuthn Component Test</title>
  </head>
  <body>
    <h1>🔐 WebAuthn Component Test</h1>
    <webauthn-auth base-url="http://localhost:8080" theme="dark"></webauthn-auth>

    <script type="module">
  PLACEHOLDER_JS_CODE
    </script>
  </body>
  </html>`;

        this.emitFile({
          type: "asset",
          fileName: "webauthn-auth-standalone.html",
          source: webauthnHtml.replace("PLACEHOLDER_JS_CODE", jsAsset.code),
        });

        this.emitFile({
          type: "asset",
          fileName: "webauthn-auth-standalone.js",
          source: jsAsset.code,
        });
      }

      // Generate WebSocket standalone HTML and JS (safe approach without string replacement)
      if (wsAsset && wsAsset.type === "chunk") {
        const htmlBefore = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WebSocket Components Test</title>
</head>
<body>
  <h1>🔌 WebSocket Components Test</h1>
  <h2>Connection Status</h2>
  <websocket-status status="disconnected" showText="true" showUserCount="true"></websocket-status>
  <h2>WebSocket Handler</h2>
  <websocket-handler websocketUrl="ws://localhost:8080/ws" autoConnect="false" showDebugLog="true"></websocket-handler>

  <script type="module">`;

        const htmlAfter = `  </script>
</body>
</html>`;

        this.emitFile({
          type: "asset",
          fileName: "websocket-components-standalone.html",
          source: htmlBefore + "\n" + wsAsset.code + "\n" + htmlAfter,
        });

        this.emitFile({
          type: "asset",
          fileName: "websocket-components-standalone.js",
          source: wsAsset.code,
        });
      }

      // Generate WebSocket Demo standalone HTML
      if (demoAsset && demoAsset.type === "chunk") {
        const demoHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WebSocket Demo - Modular Components</title>
</head>
<body>
  <websocket-demo websocketUrl="ws://localhost:8080/ws" autoConnect="false" showDebugLog="true"></websocket-demo>

  <script type="module">
${demoAsset.code}
  </script>
</body>
</html>`;

        this.emitFile({
          type: "asset",
          fileName: "websocket-demo-standalone.html",
          source: demoHtml,
        });

        this.emitFile({
          type: "asset",
          fileName: "websocket-demo-standalone.js",
          source: demoAsset.code,
        });
      }

      // Generate Sync Demo standalone HTML
      if (syncDemoAsset && syncDemoAsset.type === "chunk") {
        const syncDemoHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sync Demo - Media Blob Sync System</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 20px;
      background-color: #f8fafc;
      color: #1f2937;
      line-height: 1.6;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding: 20px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .instructions {
      background: #fef3c7;
      border: 1px solid #f59e0b;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 30px;
      color: #92400e;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔄 Sync Demo</h1>
      <p>Media Blob Sync System - End-to-End Component Testing</p>
    </div>

    <div class="instructions">
      <h3>🚀 Getting Started</h3>
      <ul>
        <li>Make sure your API server is running on <code>http://localhost:8080</code></li>
        <li>Components will auto-connect and show real sync status</li>
        <li>Try starting a sync operation to see live progress updates</li>
      </ul>
    </div>

    <sync-demo api-base-url="http://localhost:8080" client-id="standalone-demo" auto-connect="true"></sync-demo>
  </div>

  <script type="module">
${syncDemoAsset.code}
  </script>
</body>
</html>`;

        this.emitFile({
          type: "asset",
          fileName: "sync-demo-standalone.html",
          source: syncDemoHtml,
        });

        this.emitFile({
          type: "asset",
          fileName: "sync-demo-standalone.js",
          source: syncDemoAsset.code,
        });
      }

      // Generate all components HTML
      if (allAsset && allAsset.type === "chunk") {
        this.emitFile({
          type: "asset",
          fileName: "all-components-standalone.js",
          source: allAsset.code,
        });
      }

      console.log("✅ Generated standalone files for all available components");
    },
  };
}

export default defineConfig({
  plugins: [solid(), inlineHtmlTemplate()],
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
        "sync-demo": "./src/web-components/sync-demo.tsx",
        "all-components": "./src/web-components/index.tsx",
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "webauthn") return "webauthn-auth.js";
          if (chunkInfo.name === "websocket") return "websocket-components.js";
          if (chunkInfo.name === "websocket-demo") return "websocket-demo.js";
          if (chunkInfo.name === "sync-demo") return "sync-demo.js";
          if (chunkInfo.name === "all-components") return "all-components.js";
          return "[name].js";
        },
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "[name]-[hash].[ext]",
      },
    },
  },
});

/**
 * Web Components Library - Entry Point
 *
 * This file exports all available web components for the client library.
 * Components are automatically registered as custom elements when imported.
 */

/* @jsxImportSource solid-js */

// WebAuthn Components
export { VERSION } from "./webauthn-component";
export type { WebAuthnAuthProps } from "./webauthn-component";

// WebSocket Components
import { ConnectionStatus } from "./websocket-status";
export { ConnectionStatus };
export type { WebSocketHandlerProps } from "./websocket-handler";
export type { WebSocketStatusProps } from "./websocket-status";

// Import components to ensure they register as custom elements
import "./webauthn-component";
import "./websocket-handler";
import "./websocket-status";
import "./websocket-demo";
import "./websocket-feed-manager";
import "./websocket-feed-demo";
import "./websocket-thumbnail-demo";
import "./media-blob-feed-item";
import "./media-blob-feed-list";
import "./simple-test";
import "./smart-file-upload";
import "./sync-status";
import "./sync-progress";
import "./sync-controls";
import "./sync-demo";
import "./unified-sync-demo";
import "./blob-viewer";
import "./infinite-data-grid";
import "./generic-infinite-grid";
import "./product-data-grid-demo";
import "./search-demo";
import "./freqhole-demo";
import "./zune-demo";

// Component registration confirmation
const REGISTERED_COMPONENTS = [
  "webauthn-auth",
  "websocket-handler",
  "websocket-status",
  "websocket-demo",
  "websocket-feed-manager",
  "websocket-feed-demo",
  "websocket-thumbnail-demo",
  "media-blob-feed-item",
  "media-blob-feed-list",
  "simple-test",
  "smart-file-upload",
  "sync-status",
  "sync-progress",
  "sync-controls",
  "sync-demo",
  "unified-sync-demo",
  "blob-viewer",
  "infinite-data-grid",
  "generic-infinite-grid",
  "product-data-grid-demo",
  "search-demo",
  "freqhole-demo",
  "zune-demo",
] as const;

export { REGISTERED_COMPONENTS };

// Global type declarations for TypeScript
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "webauthn-auth": {
        "base-url"?: string;
        theme?: "light" | "dark";
        "auto-login"?: boolean;
      };
      "websocket-handler": {
        websocketUrl?: string;
        autoConnect?: boolean;
        showDebugLog?: boolean;
      };
      "websocket-demo": {
        websocketUrl?: string;
        autoConnect?: boolean;
        showDebugLog?: boolean;
      };

      "websocket-feed-manager": {
        wsUrl?: string;
        channels?: string;
        debug?: boolean;
        autoConnect?: boolean;
        pageSize?: number;
        className?: string;
      };

      "websocket-feed-demo": {
        wsUrl?: string;
        channels?: string;
        debug?: boolean;
        autoConnect?: boolean;
        itemMode?: "default" | "compact" | "detailed";
        maxHeight?: string;
        showControls?: boolean;
        showStats?: boolean;
        className?: string;
        refreshInterval?: number;
        demoMode?: boolean;
      };

      "websocket-thumbnail-demo": {
        wsUrl?: string;
        apiBaseUrl?: string;
        title?: string;
      };

      "media-blob-feed-item": {
        blob?: any;
        showThumbnail?: boolean;
        showMetadata?: boolean;
        showTimestamps?: boolean;
        compact?: boolean;
        clickable?: boolean;
        className?: string;
        thumbnailSize?: number;
        showLoadingPlaceholder?: boolean;
      };

      "media-blob-feed-list": {
        items?: any[];
        loading?: boolean;
        error?: string;
        emptyMessage?: string;
        maxHeight?: string;
        itemMode?: "default" | "compact";
        showThumbnails?: boolean;
        showMetadata?: boolean;
        showTimestamps?: boolean;
        clickableItems?: boolean;
        className?: string;
        thumbnailSize?: number;
        showItemCount?: boolean;
        animationDuration?: number;
      };

      "simple-test": {
        message?: string;
      };

      "smart-file-upload": {
        baseUrl?: string;
        websocketConnection?: any;
        sizeThreshold?: number;
        showDebug?: boolean;
        multiple?: boolean;
        accept?: string;
        disabled?: boolean;
      };

      "sync-status": {
        status?: string;
        showText?: boolean;
        showProgress?: boolean;
        itemsSynced?: number;
        totalItems?: number;
        compact?: boolean;
        className?: string;
      };

      "sync-progress": {
        progress?: number;
        itemsSynced?: number;
        totalItems?: number;
        currentBatch?: number;
        totalBatches?: number;
        estimatedRemainingSeconds?: number;
        showBatchInfo?: boolean;
        showETA?: boolean;
        showItemCount?: boolean;
        animated?: boolean;
        className?: string;
      };

      "sync-controls": {
        status?: string;
        disabled?: boolean;
        showForceSync?: boolean;
        showPauseResume?: boolean;
        compact?: boolean;
        className?: string;
      };

      "sync-demo": {
        apiBaseUrl?: string;
        clientId?: string;
        autoConnect?: boolean;
        className?: string;
      };

      "unified-sync-demo": {
        apiBaseUrl?: string;
        clientId?: string;
        autoConnect?: boolean;
        enableServiceWorker?: boolean;
        enableAutoSync?: boolean;
        className?: string;
        enableUserNotifications?: boolean;
      };

      "blob-viewer": {
        blobId?: string;
        baseUrl?: string;
        maxWidth?: string;
        maxHeight?: string;
        showMetadata?: boolean;
        enableDownload?: boolean;
        autoLoad?: boolean;
      };

      "infinite-data-grid": {
        rowCount?: number;
        enableSorting?: boolean;
        enableFiltering?: boolean;
        theme?: "light" | "dark";
        className?: string;
      };

      "generic-infinite-grid": {
        data?: string;
        columns?: string;
        "row-height"?: string;
        "header-height"?: string;
        theme?: "light" | "dark";
      };

      "product-data-grid-demo": {
        className?: string;
      };

      "search-demo": {
        "api-base-url"?: string;
        "auto-connect"?: boolean;
      };

      "freqhole-demo": {
        "ws-url"?: string;
        "api-base-url"?: string;
        "auto-connect"?: boolean;
      };

      "zune-demo": {
        "api-base-url"?: string;
        "auto-connect"?: boolean;
      };
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

// Custom events interface
export interface WebComponentEvents {
  // WebAuthn events
  "webauthn-login": CustomEvent<{ username: string; userId: string }>;
  "webauthn-logout": CustomEvent<Record<string, never>>;
  "webauthn-error": CustomEvent<{ error: string }>;
  "webauthn-status-change": CustomEvent<{ isAuthenticated: boolean }>;

  // WebSocket events
  "status-change": CustomEvent<{
    status: ConnectionStatus;
    timestamp?: number;
  }>;
  "media-blobs-received": CustomEvent<{
    blobs: unknown[];
    totalCount?: number;
  }>;
  "media-blob-received": CustomEvent<{ blob: unknown }>;
}

// Helper function to add typed event listeners
export function addWebComponentListener<K extends keyof WebComponentEvents>(
  element: Element,
  type: K,
  listener: (event: WebComponentEvents[K]) => void,
  options?: boolean | AddEventListenerOptions
): void {
  element.addEventListener(type, listener as EventListener, options);
}

// Log that components are loaded
console.log("🧩 Web Components Library loaded - Available components:", [
  "webauthn-auth",
  "websocket-handler",
  "websocket-status",
  "websocket-demo",
  "websocket-feed-manager",
  "websocket-feed-demo",
  "websocket-thumbnail-demo",
  "media-blob-feed-item",
  "media-blob-feed-list",
  "simple-test",
  "smart-file-upload",
  "sync-status",
  "sync-progress",
  "sync-controls",
  "sync-demo",
  "unified-sync-demo",
  "blob-viewer",
  "infinite-data-grid",
  "generic-infinite-grid",
  "product-data-grid-demo",
  "search-demo",
  "freqhole-demo",
  "zune-demo",
]);

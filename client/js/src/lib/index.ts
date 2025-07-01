// Main API client exports
export { ApiClient, ApiError, apiClient } from "./api-client.js";
export type { ApiClientConfig } from "./api-client.js";

// API specification and types
export { API_SPEC } from "./api-spec.js";
export type {
  ApiSpec,
  EndpointName,
  EndpointConfig,
  RegisterStartRequest,
  RegisterStartResponse,
  RegisterStartQueryParams,
  RegisterFinishRequest,
  RegisterFinishResponse,
  LoginStartRequest,
  LoginStartResponse,
  LoginFinishRequest,
  LoginFinishResponse,
  LogoutRequest,
  LogoutResponse,
  HealthRequest,
  HealthResponse,
  AuthStatusRequest,
  AuthStatusResponse,
  WebAuthnCredential,
  WebAuthnAssertion,
  WebAuthnPublicKeyCredentialCreationOptions,
  WebAuthnPublicKeyCredentialRequestOptions,
} from "./api-spec.js";

// Note: Test utilities are available in individual files for testing environments
// but not exported from main index to avoid Node.js dependencies in browser builds

// WebSocket client and types
export { WebSocketClient } from "./websocket-client.js";
export type {
  WebSocketClientConfig,
  WebSocketClientEvents,
} from "./websocket-client.js";

// WebSocket message types and schemas
export {
  MediaBlobSchema,
  CreateMediaBlobSchema,
  WebSocketMessageSchema,
  WebSocketResponseSchema,
  ConnectionStatus,
  createMessage,
  parseWebSocketMessage,
  parseWebSocketResponse,
  safeParseWebSocketResponse,
  isWelcomeMessage,
  isMediaBlobsMessage,
  isErrorMessage,
  isConnectionStatusMessage,
  isMediaBlobMessage,
  isMediaBlobDataMessage,
  validateIncomingMessage,
  validateOutgoingMessage,
} from "./websocket-types.js";
export type {
  MediaBlob,
  CreateMediaBlob,
  WebSocketMessage,
  WebSocketResponse,
} from "./websocket-types.js";

// Modular WebSocket components
export { WebSocketConnection } from "./websocket-connection.js";
export type {
  WebSocketConnectionStatus,
  ConnectionStatusEvent,
  WebSocketConnectionOptions,
} from "./websocket-connection.js";

export { MediaBlobManager } from "./media-blob-manager.js";
export type { MediaBlobData, BlobDisplayInfo } from "./media-blob-manager.js";

// HTTP File Upload (for large files >10MB, admin only)
export { FileUploadHandler } from "./file-upload.js";
export type {
  UploadRequest,
  UploadResponse,
  UploadInfo,
  UploadListResponse,
  UploadProgress,
  UploadConfig,
  UploadError,
  UploadErrorType,
} from "./file-upload.js";

// Blob API Client (for fetching uploaded files and blob data)
export {
  BlobClient,
  blobClient,
  createTemporaryBlobUrl,
  displayBlobAsImage,
  BlobError,
  BlobErrorType,
} from "./blob-client.js";
export type {
  BlobMetadata,
  BlobViewerInfo,
  BlobClientConfig,
} from "./blob-client.js";

// WebSocket File Upload (for small files <10MB via WebSocket)
export { WebSocketFileUploadHandler } from "./websocket-file-upload.js";
export type {
  WebSocketUploadFile,
  WebSocketProcessedBlob,
  WebSocketFileUploadOptions,
} from "./websocket-file-upload.js";

export { WebSocketDemoClient } from "./websocket-demo-client.js";
export type {
  WebSocketDemoClientOptions,
  DemoClientEvent,
} from "./websocket-demo-client.js";

// Zod schemas for external validation
export {
  WebAuthnPublicKeyCredentialCreationOptionsSchema,
  WebAuthnPublicKeyCredentialRequestOptionsSchema,
  WebAuthnCredentialSchema,
  WebAuthnAssertionSchema,
} from "./api-spec.js";

// Sync functionality
export * from "../sync-legacy/index.js";

// Re-export zod for convenience
export { z } from "zod";

// Version info
export const VERSION = "1.0.0";

// Default exports for easy consumption
import { apiClient } from "./api-client.js";
export { apiClient as default };

import { z } from "zod";
import { API_SPEC } from "./api-spec.js";
import type {
  RegisterStartResponse,
  RegisterFinishRequest,
  RegisterFinishResponse,
  LoginStartResponse,
  LoginFinishRequest,
  LoginFinishResponse,
  LogoutResponse,
  AuthStatusResponse,
  HealthResponse,
} from "./api-spec.js";

// Error handling
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public responseText: string,
    public endpoint?: string
  ) {
    super(message);
    this.name = "ApiError";
  }

  static async fromResponse(
    response: Response,
    endpoint?: string
  ): Promise<ApiError> {
    const responseText = await response.text();
    return new ApiError(
      `HTTP ${response.status}: ${responseText}`,
      response.status,
      responseText,
      endpoint
    );
  }
}

// Configuration interface
export interface ApiClientConfig {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
  credentials?: RequestCredentials;
}

// Main API Client class
export class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private timeout: number;
  private credentials: RequestCredentials;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? API_SPEC.baseUrl;
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.timeout = config.timeout ?? 30000;
    this.credentials = config.credentials ?? "include";
  }

  // Header management
  setHeader(key: string, value: string): void {
    this.defaultHeaders[key] = value;
  }

  removeHeader(key: string): void {
    delete this.defaultHeaders[key];
  }

  getHeaders(): Record<string, string> {
    return { ...this.defaultHeaders };
  }

  // Configuration updates
  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  setTimeout(timeout: number): void {
    this.timeout = timeout;
  }

  setCredentials(credentials: RequestCredentials): void {
    this.credentials = credentials;
  }

  // Private method to build URL with path parameters and query parameters
  private buildUrl(
    path: string,
    pathParams?: Record<string, string>,
    queryParams?: Record<string, unknown>
  ): string {
    let url = path;

    // Replace path parameters
    if (pathParams) {
      Object.entries(pathParams).forEach(([key, value]) => {
        url = url.replace(`{${key}}`, encodeURIComponent(value));
      });
    }

    // Add query parameters
    if (queryParams) {
      const searchParams = new URLSearchParams();
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    return `${this.baseUrl}${url}`;
  }

  // Generic request method with timeout and validation
  private async request<T>(
    method: string,
    url: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      responseSchema?: z.ZodSchema<T>;
      requestSchema?: z.ZodSchema<unknown>;
      endpoint?: string;
    } = {}
  ): Promise<T> {
    const {
      body,
      headers = {},
      responseSchema,
      requestSchema,
      endpoint,
    } = options;

    // Validate request body if schema provided
    if (requestSchema && body !== undefined) {
      requestSchema.parse(body);
    }

    const requestHeaders = {
      "Content-Type": "application/json",
      ...this.defaultHeaders,
      ...headers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body !== undefined ? JSON.stringify(body) : null,
        credentials: this.credentials,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw await ApiError.fromResponse(response, endpoint);
      }

      // Handle void responses
      if (responseSchema instanceof z.ZodVoid || !responseSchema) {
        return undefined as T;
      }

      let data: unknown;
      const contentType = response.headers.get("content-type");

      if (contentType?.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        data = text || undefined;
      }

      // Validate response if schema provided
      if (responseSchema) {
        return responseSchema.parse(data);
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError(
          `Request timeout after ${this.timeout}ms`,
          408,
          "Request Timeout",
          endpoint
        );
      }

      throw new ApiError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
        0,
        String(error),
        endpoint
      );
    }
  }

  // WebAuthn Registration Flow
  async registerStart(
    username: string,
    queryParams?: { invite_code?: string }
  ): Promise<RegisterStartResponse> {
    const config = API_SPEC.endpoints.registerStart;
    const url = this.buildUrl(config.path, { username }, queryParams);

    return this.request(config.method, url, {
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "registerStart",
    });
  }

  async registerFinish(
    request: RegisterFinishRequest
  ): Promise<RegisterFinishResponse> {
    const config = API_SPEC.endpoints.registerFinish;
    const url = this.buildUrl(config.path);

    return this.request(config.method, url, {
      body: request,
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "registerFinish",
    });
  }

  // WebAuthn Login Flow
  async loginStart(username: string): Promise<LoginStartResponse> {
    const config = API_SPEC.endpoints.loginStart;
    const url = this.buildUrl(config.path, { username });

    return this.request(config.method, url, {
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "loginStart",
    });
  }

  async loginFinish(request: LoginFinishRequest): Promise<LoginFinishResponse> {
    const config = API_SPEC.endpoints.loginFinish;
    const url = this.buildUrl(config.path);

    return this.request(config.method, url, {
      body: request,
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "loginFinish",
    });
  }

  // Authentication Management
  async logout(): Promise<LogoutResponse> {
    const config = API_SPEC.endpoints.logout;
    const url = this.buildUrl(config.path);

    return this.request(config.method, url, {
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "logout",
    });
  }

  async authStatus(): Promise<AuthStatusResponse> {
    const config = API_SPEC.endpoints.authStatus;
    const url = this.buildUrl(config.path);

    return this.request(config.method, url, {
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "authStatus",
    });
  }

  // Health Check
  async health(): Promise<HealthResponse> {
    const config = API_SPEC.endpoints.health;
    const url = this.buildUrl(config.path);

    return this.request(config.method, url, {
      requestSchema: config.requestSchema,
      responseSchema: config.responseSchema,
      endpoint: "health",
    });
  }

  // Generic request method for sync and other endpoints
  async makeRequest<T>(
    method: string,
    url: string,
    options: {
      data?: unknown;
      params?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const requestUrl = new URL(url, this.baseUrl);

    // Add query parameters if provided
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          requestUrl.searchParams.append(key, String(value));
        }
      });
    }

    const requestHeaders = {
      ...this.defaultHeaders,
      ...options.headers,
    };

    if (options.data && method !== "GET") {
      requestHeaders["Content-Type"] = "application/json";
    }

    const response = await fetch(requestUrl.toString(), {
      method,
      headers: requestHeaders,
      body: options.data ? JSON.stringify(options.data) : undefined,
      credentials: this.credentials,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ApiError(
        `Request failed: ${response.status} ${response.statusText}`,
        response.status,
        errorText,
        requestUrl.toString()
      );
    }

    return response.json();
  }
}

// Default client instance
export const apiClient = new ApiClient();

// Re-export types for convenience
export type {
  RegisterStartRequest,
  RegisterStartResponse,
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
} from "./api-spec.js";

export { API_SPEC } from "./api-spec.js";

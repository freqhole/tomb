// Simple WebAuthn API Client - No dependencies required

// API Specification - this describes all available routes
export const API_SPEC = {
  baseUrl: "http://localhost:8080",
  endpoints: {
    registerStart: {
      method: "POST",
      path: "/auth/webauthn/register/start",
    },
    registerFinish: {
      method: "POST",
      path: "/auth/webauthn/register/finish",
    },
    loginStart: {
      method: "POST",
      path: "/auth/webauthn/login/start",
    },
    loginFinish: {
      method: "POST",
      path: "/auth/webauthn/login/finish",
    },
    logout: {
      method: "POST",
      path: "/auth/logout",
    },
    redeemInvite: {
      method: "POST",
      path: "/auth/invite",
    },
    health: {
      method: "GET",
      path: "/health",
    },
    authStatus: {
      method: "GET",
      path: "/auth/whoami",
    },
  },
};

// Error handling
export class ApiError extends Error {
  constructor(message, status, responseText, endpoint) {
    super(message);
    this.status = status;
    this.responseText = responseText;
    this.endpoint = endpoint;
    this.name = "ApiError";
  }

  static async fromResponse(response, endpoint) {
    const responseText = await response.text();
    return new ApiError(
      `HTTP ${response.status}: ${responseText}`,
      response.status,
      responseText,
      endpoint,
    );
  }
}

// Main API Client class
export class ApiClient {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl ?? API_SPEC.baseUrl;
    this.defaultHeaders = config.defaultHeaders ?? {};
    this.timeout = config.timeout ?? 30000;
    this.credentials = config.credentials ?? "include";
  }

  // Header management
  setHeader(key, value) {
    this.defaultHeaders[key] = value;
  }

  removeHeader(key) {
    delete this.defaultHeaders[key];
  }

  getHeaders() {
    return { ...this.defaultHeaders };
  }

  // Configuration updates
  setBaseUrl(baseUrl) {
    this.baseUrl = baseUrl;
  }

  setTimeout(timeout) {
    this.timeout = timeout;
  }

  setCredentials(credentials) {
    this.credentials = credentials;
  }

  // Getter for baseUrl
  getBaseUrl() {
    return this.baseUrl;
  }

  // Generic request method with timeout
  async request(method, url, options = {}) {
    const { body, headers = {}, endpoint } = options;

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
      const contentType = response.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        return undefined;
      }

      const data = await response.json();
      return data;
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
          endpoint,
        );
      }

      throw new ApiError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
        0,
        String(error),
        endpoint,
      );
    }
  }

  // WebAuthn Registration Flow
  async registerStart(username, inviteCode) {
    const config = API_SPEC.endpoints.registerStart;
    const url = `${this.baseUrl}${config.path}`;
    const body = { username };
    if (inviteCode) {
      body.invite_code = inviteCode;
    }

    return this.request(config.method, url, {
      body,
      endpoint: "registerStart",
    });
  }

  async registerFinish(credential) {
    const config = API_SPEC.endpoints.registerFinish;
    const url = `${this.baseUrl}${config.path}`;

    return this.request(config.method, url, {
      body: credential,
      endpoint: "registerFinish",
    });
  }

  // WebAuthn Login Flow
  async loginStart(username) {
    const config = API_SPEC.endpoints.loginStart;
    const url = `${this.baseUrl}${config.path}`;

    return this.request(config.method, url, {
      body: { username },
      endpoint: "loginStart",
    });
  }

  async loginFinish(assertion) {
    const config = API_SPEC.endpoints.loginFinish;
    const url = `${this.baseUrl}${config.path}`;

    return this.request(config.method, url, {
      body: assertion,
      endpoint: "loginFinish",
    });
  }

  // Authentication Management
  async logout() {
    const config = API_SPEC.endpoints.logout;
    const url = `${this.baseUrl}${config.path}`;

    return this.request(config.method, url, {
      endpoint: "logout",
    });
  }

  async authStatus() {
    const config = API_SPEC.endpoints.authStatus;
    const url = `${this.baseUrl}${config.path}`;

    return this.request(config.method, url, {
      endpoint: "authStatus",
    });
  }

  // Invite code redemption
  async redeemInvite(inviteCode, username) {
    const config = API_SPEC.endpoints.redeemInvite;
    const url = `${this.baseUrl}${config.path}`;

    return this.request(config.method, url, {
      body: { invite_code: inviteCode, username },
      endpoint: "redeemInvite",
    });
  }

  // Health Check
  async health() {
    const config = API_SPEC.endpoints.health;
    const url = `${this.baseUrl}${config.path}`;

    return this.request(config.method, url, {
      endpoint: "health",
    });
  }

  // Generic request method for other endpoints
  async makeRequest(method, path, options = {}) {
    const url = new URL(path, this.baseUrl);

    // Add query parameters if provided
    if (options.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
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

    const response = await fetch(url.toString(), {
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
        url.toString(),
      );
    }

    // For DELETE operations and other methods that might return empty responses
    const contentLength = response.headers.get("content-length");
    const contentType = response.headers.get("content-type");

    if (
      contentLength === "0" ||
      (!contentType?.includes("application/json") && method === "DELETE")
    ) {
      return null;
    }

    // Check if response body is empty
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      console.warn("Failed to parse response as JSON:", text);
      return text;
    }
  }
}

// Default client instance
export const apiClient = new ApiClient();

// Export with minified names for compatibility
export { ApiClient as A, ApiError as a };

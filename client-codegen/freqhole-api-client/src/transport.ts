// transport abstraction for HTTP and P2P
//
// transports handle the low-level request/response mechanics.
// FreqholeClient uses a transport to make requests, then handles
// Zod validation on top.

/**
 * response from a transport request
 */
export interface TransportResponse {
  status: number;
  body: string;
}

/**
 * blob data with metadata
 */
export interface BlobData {
  data: Uint8Array;
  contentType: string;
}

/**
 * transport interface - implemented by HttpTransport, AppTransport, WasmTransport
 */
export interface Transport {
  /**
   * make an API request
   * @param method - HTTP method (GET, POST, etc)
   * @param path - API path (e.g., /api/songs/query)
   * @param body - optional JSON body string
   * @returns response with status code and body string
   */
  request(method: string, path: string, body?: string): Promise<TransportResponse>;

  /**
   * upload a file via FormData
   * @param path - API path (e.g., /api/upload/music)
   * @param formData - FormData with file and metadata
   * @returns response with status code and body string
   */
  upload(path: string, formData: FormData): Promise<TransportResponse>;

  /**
   * fetch a blob by ID
   * @param blobId - the blob ID to fetch
   * @returns blob data with content type
   */
  fetchBlob(blobId: string): Promise<BlobData>;

  /**
   * get a URL for a blob (for <audio>/<img> src)
   * HTTP transport returns direct URL, P2P transports may need caching
   */
  getBlobUrl(blobId: string): string | Promise<string>;
}

/**
 * HTTP transport - uses fetch API
 */
export class HttpTransport implements Transport {
  constructor(
    public readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  async request(method: string, path: string, body?: string): Promise<TransportResponse> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {};

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const options: RequestInit = {
      method,
      headers,
      credentials: this.apiKey ? "omit" : "include",
    };

    // disable cache for blob metadata routes
    if (path.includes("/api/blobs/") && path.includes("/metadata")) {
      options.cache = "no-store";
    }

    if (body) {
      options.body = body;
    }

    const response = await fetch(url, options);
    const responseBody = await response.text();

    return {
      status: response.status,
      body: responseBody,
    };
  }

  async upload(path: string, formData: FormData): Promise<TransportResponse> {
    const url = this.baseUrl + path;
    const headers: Record<string, string> = {};

    // don't set Content-Type - browser sets it with boundary for FormData
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
      credentials: this.apiKey ? "omit" : "include",
    });

    const responseBody = await response.text();

    return {
      status: response.status,
      body: responseBody,
    };
  }

  async fetchBlob(blobId: string): Promise<BlobData> {
    const url = `${this.baseUrl}/api/blobs/${blobId}`;
    const headers: Record<string, string> = {};

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url, {
      headers,
      credentials: this.apiKey ? "omit" : "include",
    });

    if (!response.ok) {
      throw new Error(`failed to fetch blob: ${response.status}`);
    }

    const data = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("Content-Type") || "application/octet-stream";

    return { data, contentType };
  }

  getBlobUrl(blobId: string): string {
    return `${this.baseUrl}/api/blobs/${blobId}`;
  }
}

// low-level fetch implementation used by all wrapper functions
import { z } from "zod";
import { routes } from "./codegen/routes.js";

type SafeParseSuccess<T> = { success: true; data: T };
type SafeParseError = { success: false; error: z.ZodError };
export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseError;

// sentinel path value used to tag 401 errors for detection
const AUTH_ERROR_PATH = "__auth_expired__";

// check if a failed SafeParseResult is a 401 auth error
export function isAuthError<T>(result: SafeParseResult<T>): boolean {
  if (result.success) return false;
  const err = (result as SafeParseError).error;
  return err.issues.some(
    (issue) => issue.code === "custom" && issue.path.includes(AUTH_ERROR_PATH),
  );
}

// internal call function used by all wrappers
export async function call<Resp>(
  baseUrl: string,
  domain: string,
  routeName: string,
  respSchema: z.ZodType<Resp> | null,
  reqSchema: z.ZodTypeAny | null,
  method: string,
  path: string,
  params?: any,
  apiKey?: string,
): Promise<SafeParseResult<Resp>> {
  // for get/delete requests, params are used for path interpolation (not validated)
  // for post/put/etc, validate request body with safeparse (unless it's FormData for file uploads)
  const isFormData = params instanceof FormData;
  if (method !== "GET" && method !== "DELETE" && reqSchema && params && !isFormData) {
    const validated = reqSchema.safeParse(params);
    if (!validated.success) {
      return { success: false, error: validated.error };
    }
    params = validated.data;
  }

  // interpolate path params (e.g. /users/{id} -> /users/123)
  let url = baseUrl + path;
  if (params && url.includes("{")) {
    url = url.replace(/\{(\w+)\}/g, (_, key) => {
      return params[key] !== undefined ? params[key] : `{${key}}`;
    });
  }

  // make request
  const headers: Record<string, string> = {};

  // only set content-type for requests with a body (but not for FormData - browser sets it with boundary)
  if (method !== "GET" && method !== "DELETE" && method !== "HEAD" && !isFormData) {
    headers["Content-Type"] = "application/json";
  }

  // auth: use bearer token if provided, otherwise cookies
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const options: RequestInit = {
    method: method,
    headers: headers,
    credentials: apiKey ? "omit" : "include", // use cookies if no api key
  };

  // disable cache for blob metadata routes to prevent stale cached responses
  if (path.includes("/api/blobs/") && path.includes("/metadata")) {
    options.cache = "no-store";
  }

  // only send body for post/put/patch methods
  if (method !== "GET" && method !== "DELETE" && params) {
    // if FormData, send as-is (browser will set proper Content-Type with boundary)
    // otherwise stringify to JSON
    options.body = isFormData ? params : JSON.stringify(params);
  }

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      // try to read the error body for details from the server
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      let errorCode: string | undefined;
      try {
        const errorBody = await response.json();
        if (errorBody?.error) {
          errorMessage = `HTTP ${response.status}: ${errorBody.error}`;
        }
        if (errorBody?.code) {
          errorCode = errorBody.code;
        }
      } catch {
        // body wasn't JSON or couldn't be read — use the default message
      }
      // build path array: include auth sentinel for 401s, and server error code if present
      const issuePath: (string | number)[] = [];
      if (response.status === 401) {
        issuePath.push(AUTH_ERROR_PATH);
      }
      if (errorCode) {
        issuePath.push(errorCode);
      }

      return {
        success: false,
        error: new z.ZodError([
          {
            code: "custom",
            path: issuePath,
            message: errorMessage,
          },
        ]),
      };
    }

    // if no response schema (e.g. blob streaming), return raw response
    if (!respSchema) {
      return { success: true, data: null as any };
    }

    const json = await response.json();

    // extract data from server response wrapper {success, message, data}
    const data = json.data ?? json;

    // validate response with safeparse - properly typed, no cast needed!
    const result = respSchema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      console.warn(`[API] Zod validation failed for ${domain}.${routeName}:`, result.error);
      return { success: false, error: result.error };
    }
  } catch (err) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: "custom",
          path: [],
          message: err instanceof Error ? err.message : "network error",
        },
      ]),
    };
  }
}

// public escape hatch - request any route by domain + name
export function request<T>(
  baseUrl: string,
  domain: keyof typeof routes,
  routeName: string,
  params?: any,
  apiKey?: string,
): Promise<SafeParseResult<T>> {
  const domainRoutes = routes[domain] as Record<string, any>;
  const route = domainRoutes[routeName];
  return call(
    baseUrl,
    domain as string,
    routeName,
    route.resp,
    route.req,
    route.method,
    route.path,
    params,
    apiKey,
  );
}

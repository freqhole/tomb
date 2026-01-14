// low-level fetch implementation used by all wrapper functions
import { routes } from "./codegen/routes.js";
import { z } from "zod";

type SafeParseSuccess<T> = { success: true; data: T };
type SafeParseError = { success: false; error: z.ZodError };
export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseError;

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
  // for post/put/etc, validate request body with safeparse
  if (method !== "GET" && method !== "DELETE" && reqSchema && params) {
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // auth: use bearer token if provided, otherwise cookies
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const options: RequestInit = {
    method: method,
    headers: headers,
    credentials: apiKey ? "omit" : "include", // use cookies if no api key
  };

  // only send body for post/put/patch methods
  if (method !== "GET" && method !== "DELETE" && params) {
    options.body = JSON.stringify(params);
  }

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      return {
        success: false,
        error: new z.ZodError([
          {
            code: "custom",
            path: [],
            message: `HTTP ${response.status}: ${response.statusText}`,
          },
        ]),
      };
    }

    // if no response schema (e.g. blob streaming), return raw response
    if (!respSchema) {
      return { success: true, data: null as any };
    }

    const data = await response.json();

    // validate response with safeparse - properly typed, no cast needed!
    const result = respSchema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    } else {
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

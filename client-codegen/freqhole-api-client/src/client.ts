// hand-written api client - wraps generated routes with fetch + zod validation
import { routes } from "./codegen/routes.js";
import type * as s from "./codegen/schema.js";
import { z } from "zod";

type SafeParseSuccess<T> = { success: true; data: T };
type SafeParseError = { success: false; error: z.ZodError };
type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseError;

async function callInternal<Resp>(
  baseUrl: string,
  domain: string,
  routeName: string,
  respSchema: z.ZodType<Resp>,
  reqSchema: z.ZodTypeAny | null,
  method: string,
  path: string,
  params?: any,
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
  const options: RequestInit = {
    method: method,
    headers: { "Content-Type": "application/json" },
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

// generic call function for advanced use cases
export function call<T>(
  baseUrl: string,
  domain: keyof typeof routes,
  routeName: string,
  params?: any,
): Promise<SafeParseResult<T>> {
  const domainRoutes = routes[domain] as Record<string, any>;
  const route = domainRoutes[routeName];
  return callInternal(
    baseUrl,
    domain as string,
    routeName,
    route.resp,
    route.req,
    route.method,
    route.path,
    params,
  );
}

export function createClient(baseUrl: string) {
  return {
    // TODO: add typed wrapper functions for each route
    // these will be generated or hand-written in a separate file
    call,
  };
}

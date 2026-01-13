// hand-written api client - wraps generated routes with fetch + zod validation
import { routes } from "./codegen/routes.js";
import { z } from "zod";

type RouteConfig = {
  method: string;
  path: string;
  req: z.ZodTypeAny | null;
  resp: z.ZodTypeAny;
};

type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: z.ZodError };

async function call<T>(
  baseUrl: string,
  routeName: keyof typeof routes,
  params?: any,
): Promise<SafeParseResult<T>> {
  const route = routes[routeName] as RouteConfig;

  // for get requests, params are used for path interpolation (not validated)
  // for post/put/etc, validate request body with safeparse
  if (route.method !== "GET" && route.req && params !== undefined) {
    const validated = route.req.safeParse(params);
    if (!validated.success) {
      return { success: false, error: validated.error };
    }
    params = validated.data;
  }

  // interpolate path params (e.g. /users/{id} -> /users/123)
  let url = baseUrl + route.path;
  if (params && url.includes("{")) {
    url = url.replace(/\{(\w+)\}/g, (_, key) => {
      return params[key] !== undefined ? params[key] : `{${key}}`;
    });
  }

  // make request
  const options: RequestInit = {
    method: route.method,
    headers: { "Content-Type": "application/json" },
  };

  // only send body for post/put/patch methods
  if (route.method !== "GET" && route.method !== "DELETE" && params) {
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

    // validate response with safeparse
    return route.resp.safeParse(data) as SafeParseResult<T>;
  } catch (err) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: "custom",
          path: [],
          message: err instanceof Error ? err.message : "Network error",
        },
      ]),
    };
  }
}

export function createClient(baseUrl: string = "http://localhost:3000") {
  return {
    call: <T>(routeName: keyof typeof routes, params?: any) =>
      call<T>(baseUrl, routeName, params),
  };
}

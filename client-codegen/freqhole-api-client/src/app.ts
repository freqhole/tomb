// app domain wrapper functions
import { routes } from "./codegen/routes.js";
import type * as s from "./codegen/schema.js";
import { call } from "./client.js";

// health check (no auth required)
export function healthCheck(baseUrl: string) {
  return call(
    baseUrl,
    "app",
    "health_check",
    routes.app.health_check.resp,
    routes.app.health_check.req,
    routes.app.health_check.method,
    routes.app.health_check.path,
    undefined,
    undefined,
  );
}

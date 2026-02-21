// app domain wrapper functions
import { call } from "./client.js";
import { routes } from "./codegen/routes.js";

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

// get server info (no auth required)
export function getServerInfo(baseUrl: string) {
  return call(
    baseUrl,
    "app",
    "server_info",
    routes.app.server_info.resp,
    routes.app.server_info.req,
    routes.app.server_info.method,
    routes.app.server_info.path,
    undefined,
    undefined,
  );
}

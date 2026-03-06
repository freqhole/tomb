// app domain methods for FreqholeClient

import { routes } from "../codegen/routes.js";
import type { CallFn } from "./types.js";

export function createAppMethods(call: CallFn) {
  return {
    healthCheck: () => {
      return call(
        "app", "health_check",
        routes.app.health_check.resp,
        routes.app.health_check.req,
        routes.app.health_check.method,
        routes.app.health_check.path,
      );
    },

    serverInfo: () => {
      return call(
        "app", "server_info",
        routes.app.server_info.resp,
        routes.app.server_info.req,
        routes.app.server_info.method,
        routes.app.server_info.path,
      );
    },
  };
}

export type AppMethods = ReturnType<typeof createAppMethods>;

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

    radioInfo: () => {
      return call(
        "app", "radio_info",
        routes.app.radio_info.resp,
        routes.app.radio_info.req,
        routes.app.radio_info.method,
        routes.app.radio_info.path,
      );
    },

    radioStations: () => {
      return call(
        "app", "radio_stations",
        routes.app.radio_stations.resp,
        routes.app.radio_stations.req,
        routes.app.radio_stations.method,
        routes.app.radio_stations.path,
      );
    },
  };
}

export type AppMethods = ReturnType<typeof createAppMethods>;

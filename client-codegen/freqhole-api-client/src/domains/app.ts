// app domain methods for FreqholeClient

import { routes } from "../codegen/routes.js";
import type { CallFn } from "./types.js";

export function createAppMethods(call: CallFn) {
  return {
    healthCheck: () => {
      return call(
        "app",
        "health_check",
        routes.app.health_check.resp,
        routes.app.health_check.req,
        routes.app.health_check.method,
        routes.app.health_check.path,
      );
    },

    serverInfo: () => {
      return call(
        "app",
        "server_info",
        routes.app.server_info.resp,
        routes.app.server_info.req,
        routes.app.server_info.method,
        routes.app.server_info.path,
      );
    },

    radioInfo: () => {
      return call(
        "app",
        "radio_info",
        routes.app.radio_info.resp,
        routes.app.radio_info.req,
        routes.app.radio_info.method,
        routes.app.radio_info.path,
      );
    },

    radioStations: () => {
      return call(
        "app",
        "radio_stations",
        routes.app.radio_stations.resp,
        routes.app.radio_stations.req,
        routes.app.radio_stations.method,
        routes.app.radio_stations.path,
      );
    },

    // authenticated counterpart of radioStations() - includes non-public
    // stations too, for a caller who actually resolved (real session or
    // known iroh peer). see offal::music::radio's doc comment.
    radioStationsFull: () => {
      return call(
        "app",
        "radio_stations_full",
        routes.app.radio_stations_full.resp,
        routes.app.radio_stations_full.req,
        routes.app.radio_stations_full.method,
        routes.app.radio_stations_full.path,
      );
    },

    // submit a member request to an `accepts_requests` station's queue -
    // any authenticated caller may call this (not admin-only, unlike
    // radio_filters_add's "add to station").
    radioSubmitRequest: (params: {
      station_id: string;
      kind: "song" | "video";
      item_id: string;
    }) => {
      return call(
        "app",
        "radio_submit_request",
        routes.app.radio_submit_request.resp,
        routes.app.radio_submit_request.req,
        routes.app.radio_submit_request.method,
        routes.app.radio_submit_request.path,
        params,
      );
    },

    // list every currently-queued request for a station (the "queue" tab)
    radioListRequests: (params: { station_id: string }) => {
      return call(
        "app",
        "radio_list_requests",
        routes.app.radio_list_requests.resp,
        routes.app.radio_list_requests.req,
        routes.app.radio_list_requests.method,
        routes.app.radio_list_requests.path,
        params,
      );
    },

    // remove one queued request - any authenticated caller may call this
    // (member-submitted content, not admin-owned configuration).
    radioRemoveRequest: (params: { station_id: string; request_id: string }) => {
      return call(
        "app",
        "radio_remove_request",
        routes.app.radio_remove_request.resp,
        routes.app.radio_remove_request.req,
        routes.app.radio_remove_request.method,
        routes.app.radio_remove_request.path,
        params,
      );
    },

    // clear every queued request for a station at once
    radioClearRequests: (params: { station_id: string }) => {
      return call(
        "app",
        "radio_clear_requests",
        routes.app.radio_clear_requests.resp,
        routes.app.radio_clear_requests.req,
        routes.app.radio_clear_requests.method,
        routes.app.radio_clear_requests.path,
        params,
      );
    },

    // get blob metadata for a station blob
    radioPublicBlob: (params: { station_id: string; blob_id: string }) => {
      return call(
        "app",
        "radio_public_blob",
        routes.app.radio_public_blob.resp,
        routes.app.radio_public_blob.req,
        routes.app.radio_public_blob.method,
        routes.app.radio_public_blob.path,
        params,
      );
    },

    // stream the binary data for a station blob
    radioPublicBlobData: (params: { station_id: string; blob_id: string }) => {
      return call(
        "app",
        "radio_public_blob_data",
        routes.app.radio_public_blob_data.resp,
        routes.app.radio_public_blob_data.req,
        routes.app.radio_public_blob_data.method,
        routes.app.radio_public_blob_data.path,
        params,
      );
    },

    // get a thumbnail for a station blob at a given size
    radioPublicBlobThumbnail: (params: { station_id: string; blob_id: string; size: string }) => {
      return call(
        "app",
        "radio_public_blob_thumbnail",
        routes.app.radio_public_blob_thumbnail.resp,
        routes.app.radio_public_blob_thumbnail.req,
        routes.app.radio_public_blob_thumbnail.method,
        routes.app.radio_public_blob_thumbnail.path,
        params,
      );
    },

    // get the public timeline manifest for a station
    radioPublicTimeline: (params: { station_id: string }) => {
      return call(
        "app",
        "radio_public_timeline",
        routes.app.radio_public_timeline.resp,
        routes.app.radio_public_timeline.req,
        routes.app.radio_public_timeline.method,
        routes.app.radio_public_timeline.path,
        params,
      );
    },
  };
}

export type AppMethods = ReturnType<typeof createAppMethods>;

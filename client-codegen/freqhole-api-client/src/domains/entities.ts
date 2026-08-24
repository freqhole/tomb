// entities domain methods for FreqholeClient
//
// domain-neutral routes for entity_taxonz/playlist_itemz - any TaggableEntity
// (video today; other domains reuse the same routes as they're added, see
// docs/video-domain-plan.md's "add a domain" recipe).

import { routes } from "../codegen/routes.js";
import type * as s from "../codegen/schema.js";
import type { CallFn } from "./types.js";

export function createEntitiesMethods(call: CallFn) {
  return {
    // taxon links
    getEntityTaxons: (params: s.GetEntityTaxonsRequest) => {
      return call(
        "entities",
        "get_entity_taxons",
        routes.entities.get_entity_taxons.resp,
        routes.entities.get_entity_taxons.req,
        routes.entities.get_entity_taxons.method,
        routes.entities.get_entity_taxons.path,
        params,
      );
    },

    addEntityTaxon: (params: s.AddEntityTaxonRequest) => {
      return call(
        "entities",
        "add_entity_taxon",
        routes.entities.add_entity_taxon.resp,
        routes.entities.add_entity_taxon.req,
        routes.entities.add_entity_taxon.method,
        routes.entities.add_entity_taxon.path,
        params,
      );
    },

    removeEntityTaxon: (params: s.RemoveEntityTaxonRequest) => {
      return call(
        "entities",
        "remove_entity_taxon",
        routes.entities.remove_entity_taxon.resp,
        routes.entities.remove_entity_taxon.req,
        routes.entities.remove_entity_taxon.method,
        routes.entities.remove_entity_taxon.path,
        params,
      );
    },

    // entity urls
    getEntityUrls: (params: s.GetEntityUrlsRequest) => {
      return call(
        "entities",
        "get_entity_urls",
        routes.entities.get_entity_urls.resp,
        routes.entities.get_entity_urls.req,
        routes.entities.get_entity_urls.method,
        routes.entities.get_entity_urls.path,
        params,
      );
    },

    addEntityUrl: (params: s.AddEntityUrlRequest) => {
      return call(
        "entities",
        "add_entity_url",
        routes.entities.add_entity_url.resp,
        routes.entities.add_entity_url.req,
        routes.entities.add_entity_url.method,
        routes.entities.add_entity_url.path,
        params,
      );
    },

    removeEntityUrl: (params: s.RemoveEntityUrlRequest) => {
      return call(
        "entities",
        "remove_entity_url",
        routes.entities.remove_entity_url.resp,
        routes.entities.remove_entity_url.req,
        routes.entities.remove_entity_url.method,
        routes.entities.remove_entity_url.path,
        params,
      );
    },

    // entity images
    getEntityImages: (params: s.GetEntityImagesRequest) => {
      return call(
        "entities",
        "get_entity_images",
        routes.entities.get_entity_images.resp,
        routes.entities.get_entity_images.req,
        routes.entities.get_entity_images.method,
        routes.entities.get_entity_images.path,
        params,
      );
    },

    // playlist items
    listPlaylistItems: (params: s.ListPlaylistItemsRequest) => {
      return call(
        "entities",
        "list_playlist_items",
        routes.entities.list_playlist_items.resp,
        routes.entities.list_playlist_items.req,
        routes.entities.list_playlist_items.method,
        routes.entities.list_playlist_items.path,
        params,
      );
    },

    addPlaylistItem: (params: s.AddPlaylistItemRequest) => {
      return call(
        "entities",
        "add_playlist_item",
        routes.entities.add_playlist_item.resp,
        routes.entities.add_playlist_item.req,
        routes.entities.add_playlist_item.method,
        routes.entities.add_playlist_item.path,
        params,
      );
    },

    removePlaylistItem: (params: s.RemovePlaylistItemRequest) => {
      return call(
        "entities",
        "remove_playlist_item",
        routes.entities.remove_playlist_item.resp,
        routes.entities.remove_playlist_item.req,
        routes.entities.remove_playlist_item.method,
        routes.entities.remove_playlist_item.path,
        params,
      );
    },

    // favorites (domain-agnostic set/status-check; rich music-specific
    // listing endpoints live on client.music - see listFavorites/listBeloved)
    setFavorite: (params: s.SetFavoriteRequest) => {
      return call(
        "entities",
        "set_favorite",
        routes.entities.set_favorite.resp,
        routes.entities.set_favorite.req,
        routes.entities.set_favorite.method,
        routes.entities.set_favorite.path,
        params,
      );
    },

    getFavoriteStatusBulk: (params: s.GetFavoriteStatusBulkRequest) => {
      return call(
        "entities",
        "get_favorite_status_bulk",
        routes.entities.get_favorite_status_bulk.resp,
        routes.entities.get_favorite_status_bulk.req,
        routes.entities.get_favorite_status_bulk.method,
        routes.entities.get_favorite_status_bulk.path,
        params,
      );
    },

    // ratings (domain-agnostic)
    setRating: (params: s.SetRatingRequest) => {
      return call(
        "entities",
        "set_rating",
        routes.entities.set_rating.resp,
        routes.entities.set_rating.req,
        routes.entities.set_rating.method,
        routes.entities.set_rating.path,
        params,
      );
    },

    removeRating: (params: s.RemoveRatingRequest) => {
      return call(
        "entities",
        "remove_rating",
        routes.entities.remove_rating.resp,
        routes.entities.remove_rating.req,
        routes.entities.remove_rating.method,
        routes.entities.remove_rating.path,
        params,
      );
    },

    getRatingStats: (params: s.GetRatingStatsRequest) => {
      return call(
        "entities",
        "get_rating_stats",
        routes.entities.get_rating_stats.resp,
        routes.entities.get_rating_stats.req,
        routes.entities.get_rating_stats.method,
        routes.entities.get_rating_stats.path,
        params,
      );
    },

    getRatingStatusBulk: (params: s.GetRatingStatusBulkRequest) => {
      return call(
        "entities",
        "get_rating_status_bulk",
        routes.entities.get_rating_status_bulk.resp,
        routes.entities.get_rating_status_bulk.req,
        routes.entities.get_rating_status_bulk.method,
        routes.entities.get_rating_status_bulk.path,
        params,
      );
    },
  };
}

export type EntitiesMethods = ReturnType<typeof createEntitiesMethods>;

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
  };
}

export type EntitiesMethods = ReturnType<typeof createEntitiesMethods>;

// database initialization and schema management
import { openDB, type IDBPDatabase } from "idb";
import {
  LOCAL_TAXON_REMOTE_ID,
  MUSIC_DB_NAME,
  MUSIC_DB_VERSION,
  STORE_ALBUM_TAGS,
  STORE_ALBUM_TAXONS,
  STORE_ALBUMS,
  STORE_ARTISTS,
  STORE_ENTITY_TAXONS,
  STORE_FAVORITES,
  STORE_GENRES,
  STORE_PLAYLIST_ITEMS,
  STORE_PLAYLISTS,
  STORE_RATINGS,
  STORE_SONGS,
  STORE_TAGS,
  STORE_TAXONS,
  STORE_TAXON_KINDS,
} from "../types";
import { debug } from "../../../../utils/logger";

let dbInstance: IDBPDatabase | null = null;

export async function initMusicDB(): Promise<IDBPDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB(MUSIC_DB_NAME, MUSIC_DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      // artists
      if (!db.objectStoreNames.contains(STORE_ARTISTS)) {
        const artistsStore = db.createObjectStore(STORE_ARTISTS, {
          keyPath: "artist_id",
        });
        artistsStore.createIndex("by_name", "name");
        artistsStore.createIndex("by_created_at", "created_at");
      }

      // albums
      if (!db.objectStoreNames.contains(STORE_ALBUMS)) {
        const albumsStore = db.createObjectStore(STORE_ALBUMS, {
          keyPath: "album_id",
        });
        albumsStore.createIndex("by_title", "title");
        albumsStore.createIndex("by_artist_id", "artist_id");
        albumsStore.createIndex("by_genre_id", "genre_id");
        albumsStore.createIndex("by_year", "year");
        albumsStore.createIndex("by_created_at", "created_at");
        albumsStore.createIndex("by_artist_title", ["artist_id", "title"]);
      }

      // songs
      if (!db.objectStoreNames.contains(STORE_SONGS)) {
        const songsStore = db.createObjectStore(STORE_SONGS, {
          keyPath: "id",
        });
        songsStore.createIndex("by_sha256", "sha256", { unique: true });
        songsStore.createIndex("by_title", "title");
        songsStore.createIndex("by_artist_id", "artist_id");
        songsStore.createIndex("by_album_id", "album_id");
        songsStore.createIndex("by_duration", "duration");
        songsStore.createIndex("by_year", "year");
        songsStore.createIndex("by_added_at", "added_at");
        songsStore.createIndex("by_source_type", "source_type");
        songsStore.createIndex("by_file_identity", ["file_name", "file_size", "last_modified"]);
        songsStore.createIndex("by_album_disc_track", ["album_id", "disc_number", "track_number"]);
        songsStore.createIndex("by_album_title_disc_track", [
          "album_title",
          "disc_number",
          "track_number",
        ]);
        songsStore.createIndex("by_artist_album_disc_track", [
          "artist_name",
          "album_title",
          "disc_number",
          "track_number",
        ]);
        songsStore.createIndex("by_year_album_disc_track", [
          "year",
          "album_title",
          "disc_number",
          "track_number",
        ]);
        songsStore.createIndex("by_album_added_at_album_disc_track", [
          "album_added_at",
          "album_title",
          "disc_number",
          "track_number",
        ]);
        songsStore.createIndex("by_album_genre_album_disc_track", [
          "album_primary_genre_id",
          "album_title",
          "disc_number",
          "track_number",
        ]);
      }

      // genres
      if (!db.objectStoreNames.contains(STORE_GENRES)) {
        const genresStore = db.createObjectStore(STORE_GENRES, {
          keyPath: "genre_id",
        });
        genresStore.createIndex("by_name", "name");
        genresStore.createIndex("by_parent_genre_id", "parent_genre_id");
      }

      // playlists
      if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
        const playlistsStore = db.createObjectStore(STORE_PLAYLISTS, {
          keyPath: "playlist_id",
        });
        playlistsStore.createIndex("by_title", "title");
        playlistsStore.createIndex("by_created_at", "created_at");
        playlistsStore.createIndex("by_source_type", "source_type");
        playlistsStore.createIndex("by_source_remote_id", "source_remote_id");
        playlistsStore.createIndex("by_last_synced_at", "last_synced_at");
      }

      // playlist_items junction (unified across entity types) - one
      // shared position space per playlist across every entity type it
      // can hold (song, video, ...), so songs and videos can be freely
      // interleaved/drag-reordered together locally.
      if (!db.objectStoreNames.contains(STORE_PLAYLIST_ITEMS)) {
        const playlistItemsStore = db.createObjectStore(STORE_PLAYLIST_ITEMS, {
          keyPath: ["playlist_id", "entity_type", "entity_id"],
        });
        playlistItemsStore.createIndex("by_playlist_id", "playlist_id");
      }

      // favorites
      if (!db.objectStoreNames.contains(STORE_FAVORITES)) {
        const favoritesStore = db.createObjectStore(STORE_FAVORITES, {
          keyPath: ["target_type", "target_id"],
        });
        favoritesStore.createIndex("by_target_type", "target_type");
        favoritesStore.createIndex("by_favorited_at", "favorited_at");
      }

      // ratings
      if (!db.objectStoreNames.contains(STORE_RATINGS)) {
        const ratingsStore = db.createObjectStore(STORE_RATINGS, {
          keyPath: ["target_type", "target_id"],
        });
        ratingsStore.createIndex("by_target_type", "target_type");
        ratingsStore.createIndex("by_rating", "rating");
      }

      // tags
      if (!db.objectStoreNames.contains(STORE_TAGS)) {
        const tagsStore = db.createObjectStore(STORE_TAGS, {
          keyPath: "tag_id",
        });
        tagsStore.createIndex("by_name", "name", { unique: true });
        tagsStore.createIndex("by_created_at", "created_at");
      }

      // album_tags junction
      if (!db.objectStoreNames.contains(STORE_ALBUM_TAGS)) {
        const albumTagsStore = db.createObjectStore(STORE_ALBUM_TAGS, {
          keyPath: ["album_id", "tag_id"],
        });
        albumTagsStore.createIndex("by_album_id", "album_id");
        albumTagsStore.createIndex("by_tag_id", "tag_id");
        albumTagsStore.createIndex("by_created_at", "created_at");
      }

      // taxons (genre / mood / era / label / ...). scoped by remote_id
      // so peer-cached taxons never collide with local ones.
      if (!db.objectStoreNames.contains(STORE_TAXONS)) {
        const taxonsStore = db.createObjectStore(STORE_TAXONS, {
          keyPath: "taxon_id",
        });
        taxonsStore.createIndex("by_remote_id", "remote_id");
        taxonsStore.createIndex("by_kind_slug", "kind_slug");
        // (remote_id, kind_slug, slug) is the dedup key used by
        // upsertTaxon to avoid creating duplicate "jazz" rows for the
        // same library.
        taxonsStore.createIndex("by_remote_kind_slug", ["remote_id", "kind_slug", "slug"], {
          unique: true,
        });
        taxonsStore.createIndex("by_label", "label");
      }

      // album_taxons junction. `remote_id` is denormalized from the
      // taxon row so we can wipe a peer's mirror with a single index
      // scan without joining.
      if (!db.objectStoreNames.contains(STORE_ALBUM_TAXONS)) {
        const albumTaxonsStore = db.createObjectStore(STORE_ALBUM_TAXONS, {
          keyPath: ["album_id", "taxon_id"],
        });
        albumTaxonsStore.createIndex("by_album_id", "album_id");
        albumTaxonsStore.createIndex("by_taxon_id", "taxon_id");
        albumTaxonsStore.createIndex("by_remote_id", "remote_id");
        albumTaxonsStore.createIndex("by_created_at", "created_at");
      }

      // entity_taxons junction - generic across any entity type (video
      // today; album keeps its own dedicated store above). mirrors
      // `STORE_FAVORITES`'s already-generic `[target_type, target_id]`
      // keying pattern, extended with `taxon_id` since an entity can
      // have many taxons.
      if (!db.objectStoreNames.contains(STORE_ENTITY_TAXONS)) {
        const entityTaxonsStore = db.createObjectStore(STORE_ENTITY_TAXONS, {
          keyPath: ["entity_type", "entity_id", "taxon_id"],
        });
        entityTaxonsStore.createIndex("by_entity_type", "entity_type");
        entityTaxonsStore.createIndex("by_entity_id", ["entity_type", "entity_id"]);
        entityTaxonsStore.createIndex("by_taxon_id", ["entity_type", "taxon_id"]);
        entityTaxonsStore.createIndex("by_remote_id", "remote_id");
        entityTaxonsStore.createIndex("by_created_at", "created_at");
      }

      // taxon_kinds - explicit local kind metadata (see TaxonKindRow doc
      // comment), keyed by (domain, kind_slug) so "tag" can independently
      // exist under both "music" and "video" domains.
      if (!db.objectStoreNames.contains(STORE_TAXON_KINDS)) {
        const taxonKindsStore = db.createObjectStore(STORE_TAXON_KINDS, {
          keyPath: ["domain", "kind_slug"],
        });
        taxonKindsStore.createIndex("by_domain", "domain");
      }

      // v11 -> v12: migrate cached songs from `album_genres` (GenreRef[]) to
      // `album_taxons` (TaxonRef[]). preserves any existing `album_taxons`,
      // backfilling only the genre kind from the legacy field. uses the
      // upgrade transaction to keep the migration atomic with the version bump.
      if (oldVersion < 12 && db.objectStoreNames.contains(STORE_SONGS)) {
        const songsStore = tx.objectStore(STORE_SONGS);
        let cursor = await songsStore.openCursor();
        while (cursor) {
          const song = cursor.value as Record<string, unknown>;
          const legacyGenres = song.album_genres as Array<{ id: string; name: string }> | undefined;
          if (legacyGenres && legacyGenres.length > 0) {
            const existingTaxons =
              (song.album_taxons as
                Array<{ id: string; kind_slug: string; label: string }> | undefined) ?? [];
            const haveGenre = new Set(
              existingTaxons.filter((t) => t.kind_slug === "genre").map((t) => t.id)
            );
            const fromLegacy = legacyGenres
              .filter((g) => !haveGenre.has(g.id))
              .map((g) => ({ id: g.id, kind_slug: "genre", label: g.name }));
            song.album_taxons = [...existingTaxons, ...fromLegacy];
          }
          delete song.album_genres;
          await cursor.update(song);
          cursor = await cursor.continue();
        }
      }

      // v12 -> v13: backfill the new `taxons` + `album_taxons` stores
      // from each cached song's inline `album_taxons` ref array. the
      // inline refs stay on songs as a denormalized convenience for
      // single-album views; the junction is the authoritative source
      // for cross-album / cross-artist taxon nav (graph viz).
      //
      // dedup happens via the `by_remote_kind_slug` unique index, so
      // re-running the migration would be idempotent if the store
      // already exists.
      if (oldVersion < 13 && db.objectStoreNames.contains(STORE_SONGS)) {
        const songsStore = tx.objectStore(STORE_SONGS);
        const taxonsStore = tx.objectStore(STORE_TAXONS);
        const albumTaxonsStore = tx.objectStore(STORE_ALBUM_TAXONS);
        const taxonsByDedup = taxonsStore.index("by_remote_kind_slug");
        const slugify = (s: string) =>
          s
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        const now = Date.now();
        // (album_id, taxon_id) we've already linked in this run; avoids
        // an extra .get() roundtrip per song.
        const linked = new Set<string>();
        let cursor = await songsStore.openCursor();
        while (cursor) {
          const song = cursor.value as Record<string, unknown>;
          const albumId = song.album_id as string | undefined;
          const refs = song.album_taxons as
            Array<{ id: string; kind_slug: string; label: string }> | undefined;
          if (albumId && refs && refs.length > 0) {
            for (const ref of refs) {
              const kindSlug = ref.kind_slug || "genre";
              const labelSlug = slugify(ref.label || ref.id);
              if (!labelSlug) continue;
              const dedupKey: [string, string, string] = [
                LOCAL_TAXON_REMOTE_ID,
                kindSlug,
                labelSlug,
              ];
              let existing = await taxonsByDedup.get(dedupKey);
              if (!existing) {
                const row = {
                  taxon_id: ref.id || crypto.randomUUID(),
                  remote_id: LOCAL_TAXON_REMOTE_ID,
                  kind_slug: kindSlug,
                  label: ref.label,
                  slug: labelSlug,
                  created_at: now,
                  updated_at: now,
                };
                await taxonsStore.put(row);
                existing = row;
              }
              const taxonId = (existing as { taxon_id: string }).taxon_id;
              const linkKey = `${albumId}::${taxonId}`;
              if (!linked.has(linkKey)) {
                linked.add(linkKey);
                await albumTaxonsStore.put({
                  album_id: albumId,
                  taxon_id: taxonId,
                  remote_id: LOCAL_TAXON_REMOTE_ID,
                  created_at: now,
                });
              }
            }
          }
          cursor = await cursor.continue();
        }
      }

      // v16 -> v17: backfill the unified playlist_items store from the
      // old split playlist_songs / playlist_video_items stores, then drop
      // them - mirrors the server's playlist_itemz backfill+cutover.
      // songs keep their existing relative order (positions 1..N per
      // playlist, unchanged); video positions are offset to come after a
      // playlist's songs, preserving the old UI's "songs then videos"
      // visual order as the new shared ordering.
      if (oldVersion < 17) {
        const playlistItemsStore = tx.objectStore(STORE_PLAYLIST_ITEMS);
        const maxSongPositionByPlaylist = new Map<string, number>();

        if (db.objectStoreNames.contains("playlist_songs")) {
          const oldSongsStore = tx.objectStore("playlist_songs");
          let cursor = await oldSongsStore.openCursor();
          while (cursor) {
            const row = cursor.value as {
              playlist_id: string;
              song_id: string;
              position: number;
              added_at: number;
            };
            await playlistItemsStore.put({
              playlist_id: row.playlist_id,
              entity_type: "song",
              entity_id: row.song_id,
              position: row.position,
              added_at: row.added_at,
            });
            const prevMax = maxSongPositionByPlaylist.get(row.playlist_id) ?? 0;
            if (row.position > prevMax) {
              maxSongPositionByPlaylist.set(row.playlist_id, row.position);
            }
            cursor = await cursor.continue();
          }
          db.deleteObjectStore("playlist_songs");
        }

        if (db.objectStoreNames.contains("playlist_video_items")) {
          const oldVideoStore = tx.objectStore("playlist_video_items");
          let cursor = await oldVideoStore.openCursor();
          while (cursor) {
            const row = cursor.value as {
              playlist_id: string;
              video_id: string;
              position: number;
              added_at: number;
            };
            const offset = maxSongPositionByPlaylist.get(row.playlist_id) ?? 0;
            await playlistItemsStore.put({
              playlist_id: row.playlist_id,
              entity_type: "video",
              entity_id: row.video_id,
              position: offset + row.position,
              added_at: row.added_at,
            });
            cursor = await cursor.continue();
          }
          db.deleteObjectStore("playlist_video_items");
        }
      }
    },
  });

  debug("music database initialized");
  return dbInstance;
}

// close database connection (required before deletion)
export function closeMusicDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    debug("music database connection closed");
  }
}

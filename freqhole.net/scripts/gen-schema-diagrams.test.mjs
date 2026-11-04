import assert from "node:assert/strict";
import { before, test } from "node:test";
import { indexedDbDiagram, sqliteDiagrams, viewDependencies } from "./gen-schema-diagrams.mjs";

let sqlite;
let indexeddb;
before(async () => {
  sqlite = sqliteDiagrams();
  indexeddb = await indexedDbDiagram();
});

test("view dependencies ignore comments, strings and unknown CTE names", () => {
  const known = new Map(["songz", "media_blobz", "albumz"].map((name) => [name, {}]));
  assert.deepEqual(viewDependencies({
    sql: `SELECT 'FROM albumz' FROM songz -- JOIN albumz
      JOIN "media_blobz" ON 1 /* FROM albumz */ JOIN cte ON 1`,
  }, known), ["songz", "media_blobz"]);
});

test("every registered view has a source panel and actual output columns", () => {
  assert.equal((sqlite.views.match(/_pipeline\[/g) || []).length, sqlite.viewCount);
  assert.equal((sqlite.views.match(/source tables<br\/>/g) || []).length, sqlite.viewCount);
  assert.ok((sqlite.views.match(/-->\|projects\|/g) || []).length >= sqlite.viewCount);
  assert.match(sqlite.views, /song_thumbnail_blob_id/);
  assert.match(sqlite.views, /renditions/);
  assert.match(sqlite.views, /is_offline/);
  assert.match(sqlite.views, /WHERE artist_id = \?<br\/>ORDER BY artist_name/);
  assert.match(sqlite.views, /WHERE playlist_id = \?<br\/>ORDER BY position/);
  assert.match(sqlite.views, /grimoire_artist_query_view -->\|upstream view\| grimoire_song_query_view/);
  assert.doesNotMatch(sqlite.views, /feed_query_view/);
});

test("IndexedDB includes logical links, including cross-database references", () => {
  assert.equal((indexeddb.indexeddb.match(/}o\.\.o{/g) || []).length, indexeddb.referenceCount);
  assert.ok(indexeddb.referenceCount > 20);
  assert.match(indexeddb.indexeddb, /freqhole_video_videos }o\.\.o{ freqhole_music_playlist_items/);
  assert.match(indexeddb.indexeddb, /entity_type=song; sha256, not id/);
  assert.match(indexeddb.indexeddb, /freqhole_app_users }o\.\.o{ freqhole_app_user_peer_nodes/);
  assert.match(indexeddb.indexeddb, /freqhole_blobs_blobs }o\.\.o{ freqhole_blobs_blob_canvas_refs/);
  assert.doesNotMatch(indexeddb.indexeddb, /playlist_songs|parent_genre_id ->/);
});

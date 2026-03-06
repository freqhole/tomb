// stateful integration tests - end-to-end workflow validation
//
// purpose: test complete workflows with real data on a live server
//
// what this tests:
// - entity creation (playlists, artists)
// - entity modification (update playlist, add songs)
// - entity queries with real IDs
// - favorites and ratings workflows
// - analytics endpoints with real play data
// - proper cleanup of created entities
//
// what this does NOT test:
// - auth rejection (see integration.ts)
// - routes without auth (see integration.ts)
//
// requires:
// - running server with data (songs, albums, genres must exist)
// - valid API_KEY environment variable
// - fail-fast approach: if setup fails, tests don't proceed
import { createHttpClient } from "../FreqholeClient.js";
import { queryParams } from "./fixtures.js";

const baseUrl = process.env.API_URL || "http://localhost:8080";
const apiKey = process.env.API_KEY;

// shared state for created entities
const testState = {
  createdPlaylistId: null as string | null,
  createdArtistId: null as string | null,
  createdTagId: null as string | null,
  createdJobId: null as string | null,
  existingSongId: null as string | null,
  existingAlbumId: null as string | null,
  existingGenreId: null as string | null,
  existingMediaBlobId: null as string | null,
  userId: null as string | null,
};

export async function runStatefulTests() {
  if (!apiKey) {
    console.log("⚠ skipping stateful tests (no API_KEY env var)\n");
    return { passed: 0, failed: 0 };
  }

  // create authenticated client
  const client = createHttpClient(baseUrl, apiKey);

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (err) {
      console.log(
        `✗ ${name}: ${err instanceof Error ? err.message : "unknown error"}`,
      );
      failed++;
    }
  }

  console.log("running stateful integration tests...\n");

  // setup - discover existing entities (fail if not found)
  console.log("setup: discovering existing entities...\n");

  await test("get current user", async () => {
    const result = await client.auth.whoami();
    if (!result.success) {
      throw new Error(`failed to get current user: ${result.error.message}`);
    }
    testState.userId = result.data.user_id;
    if (!testState.userId) {
      throw new Error("user_id not returned from whoami");
    }
  });

  await test("discover existing song", async () => {
    const result = await client.music.querySongs(queryParams);
    if (!result.success) {
      throw new Error(`failed to query songs: ${result.error.message}`);
    }
    if (result.data.items.length === 0) {
      throw new Error("no songs found in database - cannot run tests");
    }
    testState.existingSongId = result.data.items[0].song.id;
    testState.existingMediaBlobId = result.data.items[0].song.media_blob_id;
  });

  await test("discover existing album", async () => {
    const result = await client.music.queryAlbums(queryParams);
    if (!result.success) {
      throw new Error(`failed to query albums: ${result.error.message}`);
    }
    if (result.data.items.length === 0) {
      throw new Error("no albums found in database - cannot run tests");
    }
    testState.existingAlbumId = result.data.items[0].album.id;
  });

  await test("discover existing genre", async () => {
    const result = await client.music.queryGenres(queryParams);
    if (!result.success) {
      throw new Error(`failed to query genres: ${result.error.message}`);
    }
    if (result.data.items.length === 0) {
      throw new Error("no genres found in database - cannot run tests");
    }
    testState.existingGenreId = result.data.items[0].genre.id;
  });

  console.log("");

  // abort if setup failed
  if (
    !testState.existingSongId ||
    !testState.existingAlbumId ||
    !testState.existingGenreId
  ) {
    console.log("✗ setup failed - aborting stateful tests\n");
    return { passed, failed };
  }

  // create entities
  console.log("creating test entities...\n");

  await test("create playlist", async () => {
    const result = await client.music.createPlaylist({
      title: `Test Playlist ${Date.now()}`,
      description: "Created by integration tests",
      is_public: false,
      created_by_id: null,
    });
    if (!result.success) {
      throw new Error(`failed to create playlist: ${result.error.message}`);
    }
    testState.createdPlaylistId = result.data.id;
    if (!testState.createdPlaylistId) {
      throw new Error("playlist id not returned");
    }
  });

  await test("create artist", async () => {
    const result = await client.music.createArtist({
      name: `Test Artist ${Date.now()}`,
      created_by: null,
    });
    if (!result.success) {
      throw new Error(`failed to create artist: ${result.error.message}`);
    }
    testState.createdArtistId = result.data.id;
    if (!testState.createdArtistId) {
      throw new Error("artist id not returned");
    }
  });

  console.log("");

  // use created entities
  console.log("testing with created entities...\n");

  await test("get created playlist", async () => {
    const result = await client.music.getPlaylistById({ id: testState.createdPlaylistId! });
    if (!result.success) {
      throw new Error(`failed to get playlist: ${result.error.message}`);
    }
    if (result.data.id !== testState.createdPlaylistId) {
      throw new Error("playlist id mismatch");
    }
  });

  await test("update created playlist", async () => {
    const result = await client.music.updatePlaylist({
      playlist_id: testState.createdPlaylistId!,
      title: "Updated Test Playlist",
      description: "Updated by integration tests",
      is_public: null,
      entity_urls: null,
      updated_by: null,
    });
    if (!result.success) {
      throw new Error(`failed to update playlist: ${result.error.message}`);
    }
    if (result.data.title !== "Updated Test Playlist") {
      throw new Error("playlist title not updated");
    }
  });

  await test("add song to playlist", async () => {
    const result = await client.music.addSongsToPlaylist({
      playlist_id: testState.createdPlaylistId!,
      song_ids: [testState.existingSongId!],
    });
    if (!result.success) {
      throw new Error(`failed to add songs: ${result.error.message}`);
    }
  });

  await test("query playlist songs", async () => {
    const result = await client.music.queryPlaylistSongs({
      playlist_id: testState.createdPlaylistId!,
      q: null,
      sort_by: null,
      sort_direction: null,
      limit: 10,
      offset: 0,
    });
    if (!result.success) {
      throw new Error(
        `failed to query playlist songs: ${result.error.message}`,
      );
    }
    if (!result.data.items || result.data.items.length === 0) {
      throw new Error("expected at least one song in playlist");
    }
  });

  await test("remove song from playlist", async () => {
    const result = await client.music.removeSongsFromPlaylist({
      playlist_id: testState.createdPlaylistId!,
      song_ids: [testState.existingSongId!],
    });
    if (!result.success) {
      throw new Error(`failed to remove songs: ${result.error.message}`);
    }
  });

  await test("get created artist", async () => {
    const result = await client.music.getArtist({ id: testState.createdArtistId! });
    if (!result.success) {
      throw new Error(`failed to get artist: ${result.error.message}`);
    }
    if (result.data.id !== testState.createdArtistId) {
      throw new Error("artist id mismatch");
    }
  });

  await test("set favorite on song", async () => {
    const result = await client.music.setFavorite({
      user_id: testState.userId!,
      target_type: "song",
      target_id: testState.existingSongId!,
      is_favorite: true,
    });
    if (!result.success) {
      throw new Error(`failed to set favorite: ${result.error.message}`);
    }
  });

  await test("list favorites", async () => {
    const result = await client.music.listFavorites({
      user_id: testState.userId!,
      target_type: "song",
      limit: 10,
      offset: 0,
    });
    if (!result.success) {
      throw new Error(`failed to list favorites: ${result.error.message}`);
    }
  });

  await test("set rating on song", async () => {
    const result = await client.music.setRating({
      user_id: testState.userId!,
      target_type: "song",
      target_id: testState.existingSongId!,
      rating: 5,
    });
    if (!result.success) {
      throw new Error(`failed to set rating: ${result.error.message}`);
    }
  });

  await test("get rating stats", async () => {
    const result = await client.music.getRatingStats({
      target_type: "song",
      target_id: testState.existingSongId!,
    });
    if (!result.success) {
      throw new Error(`failed to get rating stats: ${result.error.message}`);
    }
  });

  await test("record play event", async () => {
    const result = await client.music.recordPlay({
      media_blob_id: testState.existingMediaBlobId || "unknown-blob-id",
      song_id: testState.existingSongId!,
      session_id: null,
      event_data: null,
    });
    if (!result.success) {
      throw new Error(`failed to record play: ${result.error.message}`);
    }
  });

  await test("get song analytics", async () => {
    const result = await client.music.songAnalytics({ song_id: testState.existingSongId! });
    if (!result.success) {
      throw new Error(`failed to get analytics: ${result.error.message}`);
    }
  });

  await test("get listening history", async () => {
    const result = await client.music.listeningHistory({
      user_id: null,
      limit: 10,
      offset: 0,
    });
    if (!result.success) {
      throw new Error(`failed to get history: ${result.error.message}`);
    }
  });

  await test("get top songs", async () => {
    const result = await client.music.topSongs({ limit: 10, days: 7 });
    if (!result.success) {
      throw new Error(`failed to get top songs: ${result.error.message}`);
    }
  });

  await test("list jobs", async () => {
    const result = await client.music.listJobs({
      session_id: null,
      status: null,
      limit: 10,
      offset: 0,
    });
    if (!result.success) {
      throw new Error(`failed to list jobs: ${result.error.message}`);
    }
  });

  // search tests
  console.log("\nsearch functionality...\n");

  await test("suggestions - all fields", async () => {
    const result = await client.music.suggestions({
      field: "all",
      partial: "test",
      page: 1,
      page_size: 10,
      context: null,
    });
    if (!result.success) {
      throw new Error(`failed to get suggestions: ${result.error.message}`);
    }
    if (!result.data.suggestions) {
      throw new Error("suggestions array missing");
    }
    if (typeof result.data.query_time_ms !== "number") {
      throw new Error("query_time_ms not returned");
    }
  });

  await test("suggestions - songs only", async () => {
    const result = await client.music.suggestions({
      field: "songs",
      partial: "a",
      page: 1,
      page_size: 5,
      context: null,
    });
    if (!result.success) {
      throw new Error(
        `failed to get song suggestions: ${result.error.message}`,
      );
    }
    // verify all suggestions are songs
    for (const suggestion of result.data.suggestions) {
      if (suggestion.suggestion_type !== "song") {
        throw new Error(
          `expected song suggestions, got ${suggestion.suggestion_type}`,
        );
      }
    }
  });

  await test("search - all fields", async () => {
    const result = await client.music.search({
      query: "test",
      field: null,
      page: 1,
      page_size: 10,
      context: null,
    });
    if (!result.success) {
      throw new Error(`failed to search: ${result.error.message}`);
    }
    if (!result.data.songs) {
      throw new Error("songs array missing");
    }
    if (typeof result.data.total_count !== "number") {
      throw new Error("total_count not returned");
    }
    if (typeof result.data.query_time_ms !== "number") {
      throw new Error("query_time_ms not returned");
    }
  });

  await test("search - songs only", async () => {
    const result = await client.music.search({
      query: "a",
      field: "songs",
      page: 1,
      page_size: 20,
      context: null,
    });
    if (!result.success) {
      throw new Error(`failed to search songs: ${result.error.message}`);
    }
    if (result.data.artists !== null) {
      throw new Error("artists should be null when field is songs");
    }
    if (result.data.albums !== null) {
      throw new Error("albums should be null when field is songs");
    }
  });

  await test("search - with tag include filter", async () => {
    const result = await client.music.search({
      query: "a",
      field: "songs",
      page: 1,
      page_size: 50,
      context: {
        tags: {
          include: ["tag001"],
          exclude: [],
        },
        sort_field: null,
        sort_direction: null,
        search_query: null,
      },
    });
    if (!result.success) {
      throw new Error(
        `failed to search with tag filter: ${result.error.message}`,
      );
    }
    // verify context was applied (may or may not return results depending on data)
    if (!result.data.applied_filters) {
      throw new Error("applied_filters not returned");
    }
    if (typeof result.data.total_count !== "number") {
      throw new Error("total_count not returned");
    }
  });

  await test("search - with tag exclude filter", async () => {
    const result = await client.music.search({
      query: "a",
      field: "songs",
      page: 1,
      page_size: 50,
      context: {
        tags: {
          include: [],
          exclude: ["tag001"],
        },
        sort_field: null,
        sort_direction: null,
        search_query: null,
      },
    });
    if (!result.success) {
      throw new Error(
        `failed to search with exclude filter: ${result.error.message}`,
      );
    }
    // verify exclude filter was applied
    if (typeof result.data.total_count !== "number") {
      throw new Error("total_count not returned");
    }
    if (!result.data.applied_filters) {
      throw new Error("applied_filters not returned");
    }
  });

  await test("search - tag filtering across all entity types", async () => {
    const result = await client.music.search({
      query: "death",
      field: "all",
      page: 1,
      page_size: 20,
      context: {
        tags: {
          include: ["tag002"],
          exclude: [],
        },
        sort_field: null,
        sort_direction: null,
        search_query: null,
      },
    });
    if (!result.success) {
      throw new Error(
        `failed to search all types with tags: ${result.error.message}`,
      );
    }
    // verify response structure (results depend on data with tag002)
    if (!result.data.songs) {
      throw new Error("songs array missing");
    }
    if (typeof result.data.query_time_ms !== "number") {
      throw new Error("query_time_ms not returned");
    }
    if (!result.data.applied_filters) {
      throw new Error("applied_filters not returned");
    }
  });

  console.log("");

  // cleanup
  console.log("cleaning up created entities...\n");

  if (testState.createdPlaylistId) {
    await test("delete created playlist", async () => {
      const result = await client.music.deletePlaylist({
        playlist_id: testState.createdPlaylistId!,
      });
      if (!result.success) {
        throw new Error(`failed to delete playlist: ${result.error.message}`);
      }
    });
  } else {
    console.log("⚠ skipping playlist cleanup (not created)");
  }

  if (testState.createdArtistId) {
    await test("delete created artist", async () => {
      const result = await client.music.deleteArtist({ id: testState.createdArtistId!, user_id: testState.userId! });
      if (!result.success) {
        throw new Error(`failed to delete artist: ${result.error.message}`);
      }
    });
  } else {
    console.log("⚠ skipping artist cleanup (not created)");
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);

  return { passed, failed };
}

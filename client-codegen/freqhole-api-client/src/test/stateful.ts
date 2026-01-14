// stateful integration tests - end-to-end workflow validation
//
// purpose: test complete workflows with real data on a live server
//
// what this tests:
// - entity creation (playlists, artists, sub-genres)
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
import * as music from "../music.js";
import * as auth from "../auth.js";
import * as app from "../app.js";
import { queryParams } from "./fixtures.js";

const baseUrl = process.env.API_URL || "http://localhost:8080";
const apiKey = process.env.API_KEY;

// shared state for created entities
const testState = {
  createdPlaylistId: null as string | null,
  createdArtistId: null as string | null,
  createdTagId: null as string | null,
  createdSubGenreId: null as string | null,
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
    const result = await auth.whoami(baseUrl, apiKey);
    if (!result.success) {
      throw new Error(`failed to get current user: ${result.error.message}`);
    }
    testState.userId = result.data.user_id;
    if (!testState.userId) {
      throw new Error("user_id not returned from whoami");
    }
  });

  await test("discover existing song", async () => {
    const result = await music.querySongs(baseUrl, queryParams, apiKey);
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
    const result = await music.queryAlbums(baseUrl, queryParams, apiKey);
    if (!result.success) {
      throw new Error(`failed to query albums: ${result.error.message}`);
    }
    if (result.data.items.length === 0) {
      throw new Error("no albums found in database - cannot run tests");
    }
    testState.existingAlbumId = result.data.items[0].album.id;
  });

  await test("discover existing genre", async () => {
    const result = await music.queryGenres(baseUrl, queryParams, apiKey);
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
    const result = await music.createPlaylist(
      baseUrl,
      {
        title: `Test Playlist ${Date.now()}`,
        description: "Created by integration tests",
        is_public: false,
        created_by_id: null,
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to create playlist: ${result.error.message}`);
    }
    testState.createdPlaylistId = result.data.id;
    if (!testState.createdPlaylistId) {
      throw new Error("playlist id not returned");
    }
  });

  await test("create artist", async () => {
    const result = await music.createArtist(
      baseUrl,
      {
        name: `Test Artist ${Date.now()}`,
        created_by: null,
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to create artist: ${result.error.message}`);
    }
    testState.createdArtistId = result.data.id;
    if (!testState.createdArtistId) {
      throw new Error("artist id not returned");
    }
  });

  await test("create sub-genre", async () => {
    const result = await music.createSubGenre(
      baseUrl,
      {
        name: `Test Sub-Genre ${Date.now()}`,
        parent_genre_id: testState.existingGenreId!,
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to create sub-genre: ${result.error.message}`);
    }
    testState.createdSubGenreId = result.data.id;
    if (!testState.createdSubGenreId) {
      throw new Error("sub-genre id not returned");
    }
  });

  console.log("");

  // use created entities
  console.log("testing with created entities...\n");

  await test("get created playlist", async () => {
    const result = await music.getPlaylistById(
      baseUrl,
      { id: testState.createdPlaylistId! },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to get playlist: ${result.error.message}`);
    }
    if (result.data.id !== testState.createdPlaylistId) {
      throw new Error("playlist id mismatch");
    }
  });

  await test("update created playlist", async () => {
    const result = await music.updatePlaylist(
      baseUrl,
      {
        playlist_id: testState.createdPlaylistId!,
        title: "Updated Test Playlist",
        description: "Updated by integration tests",
        is_public: null,
        thumbnail_blob_id: null,
        updated_by: null,
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to update playlist: ${result.error.message}`);
    }
    if (result.data.title !== "Updated Test Playlist") {
      throw new Error("playlist title not updated");
    }
  });

  await test("add song to playlist", async () => {
    const result = await music.addSongsToPlaylist(
      baseUrl,
      {
        playlist_id: testState.createdPlaylistId!,
        song_ids: [testState.existingSongId!],
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to add songs: ${result.error.message}`);
    }
  });

  await test("query playlist songs", async () => {
    const result = await music.queryPlaylistSongs(
      baseUrl,
      {
        playlist_id: testState.createdPlaylistId!,
        q: null,
        sort_by: null,
        sort_direction: null,
        limit: 10,
        offset: 0,
      },
      apiKey,
    );
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
    const result = await music.removeSongsFromPlaylist(
      baseUrl,
      {
        playlist_id: testState.createdPlaylistId!,
        song_ids: [testState.existingSongId!],
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to remove songs: ${result.error.message}`);
    }
  });

  await test("get created artist", async () => {
    const result = await music.getArtist(
      baseUrl,
      { id: testState.createdArtistId! },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to get artist: ${result.error.message}`);
    }
    if (result.data.id !== testState.createdArtistId) {
      throw new Error("artist id mismatch");
    }
  });

  await test("get created sub-genre", async () => {
    const result = await music.getSubGenre(
      baseUrl,
      { id: testState.createdSubGenreId! },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to get sub-genre: ${result.error.message}`);
    }
    if (result.data.id !== testState.createdSubGenreId) {
      throw new Error("sub-genre id mismatch");
    }
  });

  await test("set favorite on song", async () => {
    const result = await music.setFavorite(
      baseUrl,
      {
        user_id: testState.userId!,
        target_type: "Song",
        target_id: testState.existingSongId!,
        is_favorite: true,
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to set favorite: ${result.error.message}`);
    }
  });

  await test("list favorites", async () => {
    const result = await music.listFavorites(
      baseUrl,
      {
        user_id: testState.userId!,
        target_type: "Song",
        limit: 10,
        offset: 0,
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to list favorites: ${result.error.message}`);
    }
  });

  await test("set rating on song", async () => {
    const result = await music.setRating(
      baseUrl,
      {
        user_id: testState.userId!,
        target_type: "Song",
        target_id: testState.existingSongId!,
        rating: 5,
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to set rating: ${result.error.message}`);
    }
  });

  await test("get rating stats", async () => {
    const result = await music.getRatingStats(
      baseUrl,
      {
        target_type: "Song",
        target_id: testState.existingSongId!,
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to get rating stats: ${result.error.message}`);
    }
  });

  await test("record play event", async () => {
    const result = await music.recordPlay(
      baseUrl,
      {
        media_blob_id: testState.existingMediaBlobId || "unknown-blob-id",
        song_id: testState.existingSongId!,
        session_id: null,
        event_data: null,
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to record play: ${result.error.message}`);
    }
  });

  await test("get song analytics", async () => {
    const result = await music.songAnalytics(
      baseUrl,
      { song_id: testState.existingSongId! },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to get analytics: ${result.error.message}`);
    }
  });

  await test("get listening history", async () => {
    const result = await music.listeningHistory(
      baseUrl,
      {
        user_id: null,
        limit: 10,
        offset: 0,
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to get history: ${result.error.message}`);
    }
  });

  await test("get top songs", async () => {
    const result = await music.topSongs(
      baseUrl,
      { limit: 10, days: 7 },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to get top songs: ${result.error.message}`);
    }
  });

  await test("list jobs", async () => {
    const result = await music.listJobs(
      baseUrl,
      {
        session_id: null,
        status: null,
        limit: 10,
        offset: 0,
      },
      apiKey,
    );
    if (!result.success) {
      throw new Error(`failed to list jobs: ${result.error.message}`);
    }
  });

  console.log("");

  // cleanup
  console.log("cleaning up created entities...\n");

  if (testState.createdPlaylistId) {
    await test("delete created playlist", async () => {
      const result = await music.deletePlaylist(
        baseUrl,
        {
          playlist_id: testState.createdPlaylistId!,
          deleted_by: null,
        },
        apiKey,
      );
      if (!result.success) {
        throw new Error(`failed to delete playlist: ${result.error.message}`);
      }
    });
  } else {
    console.log("⚠ skipping playlist cleanup (not created)");
  }

  if (testState.createdArtistId) {
    await test("delete created artist", async () => {
      const result = await music.deleteArtist(
        baseUrl,
        { user_id: testState.createdArtistId! },
        apiKey,
      );
      if (!result.success) {
        throw new Error(`failed to delete artist: ${result.error.message}`);
      }
    });
  } else {
    console.log("⚠ skipping artist cleanup (not created)");
  }

  if (testState.createdSubGenreId) {
    await test("delete created sub-genre", async () => {
      const result = await music.deleteSubGenre(
        baseUrl,
        { id: testState.createdSubGenreId! },
        apiKey,
      );
      if (!result.success) {
        throw new Error(`failed to delete sub-genre: ${result.error.message}`);
      }
    });
  } else {
    console.log("⚠ skipping sub-genre cleanup (not created)");
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);

  return { passed, failed };
}

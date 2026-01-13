// integration tests and usage examples for the freqhole api client
import { createClient } from "./src/client.js";

const client = createClient("http://localhost:3000");

async function main() {
  console.log("running freqhole api client integration tests\n");

  let passed = 0;
  let failed = 0;

  // helper to run a test
  async function test(name: string, fn: () => Promise<void>) {
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

  // =============================================================================
  // user api tests
  // =============================================================================

  await test("create_user - create a new user account", async () => {
    const result = await client.app.create_user({
      username: "testuser",
      password: "securepass123",
      email: "test@example.com",
    });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (result.data.username !== "testuser") {
      throw new Error("username mismatch");
    }
  });

  await test("login - authenticate and get api key", async () => {
    const result = await client.app.login({
      username: "testuser",
      password: "securepass123",
    });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (!result.data.api_key) {
      throw new Error("no api key returned");
    }
  });

  await test("get_user - fetch user by id", async () => {
    const result = await client.app.get_user({ id: "user-123" });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (!result.data.username) {
      throw new Error("no username in response");
    }
  });

  // =============================================================================
  // music - album api tests
  // =============================================================================

  await test("list_albums - query albums with filters", async () => {
    const result = await client.music.list_albums({
      q: "rock",
      limit: 10,
      offset: 0,
    });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (!Array.isArray(result.data)) {
      throw new Error("expected array response");
    }
  });

  await test("get_album - fetch specific album", async () => {
    const result = await client.music.get_album({ id: "album-456" });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (!result.data.title) {
      throw new Error("no title in response");
    }
  });

  // =============================================================================
  // music - song api tests
  // =============================================================================

  await test("list_songs - query songs with pagination", async () => {
    const result = await client.music.list_songs({
      q: "love",
      limit: 20,
      offset: 0,
    });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (!Array.isArray(result.data)) {
      throw new Error("expected array response");
    }
  });

  await test("get_song - fetch specific song", async () => {
    const result = await client.music.get_song({ id: "song-789" });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (!result.data.title || !result.data.artist_name) {
      throw new Error("missing song fields");
    }
  });

  // =============================================================================
  // music - playlist api tests
  // =============================================================================

  await test("create_playlist - create a new playlist", async () => {
    const result = await client.music.create_playlist({
      id: "playlist-new",
      title: "My Awesome Playlist",
      description: "A collection of great songs",
    });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (result.data.title !== "My Awesome Playlist") {
      throw new Error("title mismatch");
    }
  });

  await test("get_playlist - fetch specific playlist", async () => {
    const result = await client.music.get_playlist({
      id: "playlist-123",
    });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (!result.data.title) {
      throw new Error("no title in response");
    }
  });

  await test("list_playlists - query playlists", async () => {
    const result = await client.music.list_playlists({
      q: null,
      limit: 15,
      offset: 0,
    });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (!Array.isArray(result.data)) {
      throw new Error("expected array response");
    }

    // check playlist query result structure
    if (result.data.length > 0) {
      const first = result.data[0];
      if (!first.playlist || typeof first.song_count !== "number") {
        throw new Error("invalid playlist query result structure");
      }
    }
  });

  await test("delete_playlist - delete a playlist", async () => {
    const result = await client.music.delete_playlist({
      id: "playlist-to-delete",
    });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (typeof result.data !== "boolean") {
      throw new Error("expected boolean response");
    }

    if (result.data !== true) {
      throw new Error("delete operation should return true");
    }
  });

  await test("add_songs_to_playlist - add songs with metadata", async () => {
    const result = await client.music.add_songs_to_playlist({
      playlist_id: "my-playlist",
      songs: [
        {
          song_id: "song-1",
          position: 0,
          added_by: "user",
          added_at: 1704067200,
        },
        {
          song_id: "song-2",
          position: 1,
          added_by: "user",
          added_at: 1704067200,
        },
        {
          song_id: "song-3",
          position: 2,
          added_by: "user",
          added_at: 1704067200,
        },
      ],
      replace_existing: false,
    });

    if (!result.success) {
      throw new Error(`validation failed: ${result.error.message}`);
    }

    if (result.data.playlist_id !== "my-playlist") {
      throw new Error("playlist id mismatch");
    }

    if (result.data.songs_added !== 3) {
      throw new Error(`Expected 3 songs added, got ${result.data.songs_added}`);
    }

    if (result.data.total_songs < 3) {
      throw new Error("total songs should be at least 3");
    }
  });

  // =============================================================================
  // summary
  // =============================================================================

  console.log(`\n${passed} passed, ${failed} failed`);
  if (typeof process !== "undefined") {
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch(console.error);

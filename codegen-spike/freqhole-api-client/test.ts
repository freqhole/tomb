// Integration tests and usage examples for the Freqhole API client
import { createClient } from "./src/client.js";
import type {
  User,
  LoginResponse,
  Album,
  Song,
  Playlist,
  PlaylistQueryResult,
} from "./src/codegen/schema.js";

const client = createClient("http://localhost:3000");

async function main() {
  console.log("Running Freqhole API Client Integration Tests\n");

  let passed = 0;
  let failed = 0;

  // Helper to run a test
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
  // User API Tests
  // =============================================================================

  await test("create_user - Create a new user account", async () => {
    const result = await client.call<User>("create_user", {
      username: "testuser",
      password: "securepass123",
      email: "test@example.com",
    });

    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    if (result.data.username !== "testuser") {
      throw new Error("Username mismatch");
    }
  });

  await test("login - Authenticate and get API key", async () => {
    const result = await client.call<LoginResponse>("login", {
      username: "testuser",
      password: "securepass123",
    });

    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    if (!result.data.api_key) {
      throw new Error("No API key returned");
    }
  });

  await test("get_user - Fetch user by ID", async () => {
    const result = await client.call<User>("get_user", { id: "user-123" });

    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    if (!result.data.username) {
      throw new Error("No username in response");
    }
  });

  // =============================================================================
  // Music - Album API Tests
  // =============================================================================

  await test("list_albums - Query albums with filters", async () => {
    const result = await client.call<Album[]>("list_albums", {
      q: "rock",
      limit: 10,
      offset: 0,
    });

    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    if (!Array.isArray(result.data)) {
      throw new Error("Expected array response");
    }
  });

  await test("get_album - Fetch specific album", async () => {
    const result = await client.call<Album>("get_album", { id: "album-456" });

    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    if (!result.data.title) {
      throw new Error("No title in response");
    }
  });

  // =============================================================================
  // Music - Song API Tests
  // =============================================================================

  await test("list_songs - Query songs with pagination", async () => {
    const result = await client.call<Song[]>("list_songs", {
      q: "love",
      limit: 20,
      offset: 0,
    });

    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    if (!Array.isArray(result.data)) {
      throw new Error("Expected array response");
    }
  });

  await test("get_song - Fetch specific song", async () => {
    const result = await client.call<Song>("get_song", { id: "song-789" });

    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    if (!result.data.title || !result.data.artist_name) {
      throw new Error("Missing song fields");
    }
  });

  // =============================================================================
  // Music - Playlist API Tests
  // =============================================================================

  await test("create_playlist - Create a new playlist", async () => {
    const result = await client.call<Playlist>("create_playlist", {
      id: "playlist-new",
      title: "My Awesome Playlist",
      description: "A collection of great songs",
    });

    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    if (result.data.title !== "My Awesome Playlist") {
      throw new Error("Title mismatch");
    }
  });

  await test("get_playlist - Fetch specific playlist", async () => {
    const result = await client.call<Playlist>("get_playlist", {
      id: "playlist-123",
    });

    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    if (!result.data.title) {
      throw new Error("No title in response");
    }
  });

  await test("list_playlists - Query playlists", async () => {
    const result = await client.call<PlaylistQueryResult[]>("list_playlists", {
      q: null,
      limit: 15,
      offset: 0,
    });

    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    if (!Array.isArray(result.data)) {
      throw new Error("Expected array response");
    }

    // Check playlist query result structure
    if (result.data.length > 0) {
      const first = result.data[0];
      if (!first.playlist || typeof first.song_count !== "number") {
        throw new Error("Invalid playlist query result structure");
      }
    }
  });

  await test("delete_playlist - Delete a playlist", async () => {
    const result = await client.call<boolean>("delete_playlist", {
      id: "playlist-to-delete",
    });

    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    if (typeof result.data !== "boolean") {
      throw new Error("Expected boolean response");
    }

    if (result.data !== true) {
      throw new Error("Delete operation should return true");
    }
  });

  // =============================================================================
  // Summary
  // =============================================================================

  console.log(`\n${passed} passed, ${failed} failed`);
  if (typeof process !== "undefined") {
    process.exit(failed > 0 ? 1 : 0);
  }
}

main().catch(console.error);

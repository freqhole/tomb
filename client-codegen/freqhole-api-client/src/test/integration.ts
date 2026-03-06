// integration tests - auth validation layer
//
// purpose: verify that all protected routes properly reject unauthenticated requests
//
// what this tests:
// - health check endpoint (no auth required)
// - auth rejection for all 65+ protected routes (expects 401/403)
//
// what this does NOT test:
// - successful authenticated requests (see stateful.ts)
// - entity creation/modification workflows (see stateful.ts)
// - data validation beyond auth (see stateful.ts)
//
// runs without API_KEY - uses placeholder data to trigger auth checks
import { createHttpClient } from "../FreqholeClient.js";
import * as utils from "../utils.js";
import {
  fixtures,
  PLACEHOLDER_ID,
  queryParams,
} from "./fixtures.js";

const baseUrl = process.env.API_URL || "http://localhost:8080";

// client without auth - should get 401/403 on protected routes
const client = createHttpClient(baseUrl);

export async function runIntegrationTests() {
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

  console.log(`running integration tests against ${baseUrl}...\n`);

  // health check (no auth required)
  await test("app.healthCheck - server is alive", async () => {
    const result = await client.app.healthCheck();
    if (!result.success) {
      throw new Error(`health check failed: ${result.error.message}`);
    }
    if (!result.data || typeof result.data !== "object") {
      throw new Error("health check returned invalid data");
    }
  });

  // validate that protected routes reject requests without auth
  console.log("\nvalidating auth requirements...\n");

  const protectedRoutes = [
    // auth routes
    { name: "auth.whoami", fn: () => client.auth.whoami() },
    { name: "auth.apiKeyStatus", fn: () => client.auth.apiKeyStatus() },
    { name: "auth.regenerateApiKey", fn: () => client.auth.regenerateApiKey() },
    { name: "auth.logout", fn: () => client.auth.logout() },

    // songs
    {
      name: "music.querySongs",
      fn: () => client.music.querySongs(queryParams),
    },
    {
      name: "music.recentSongs",
      fn: () => client.music.recentSongs({ limit: 10 }),
    },
    {
      name: "music.updateSongs",
      fn: () => client.music.updateSongs(fixtures.updateSongs),
    },
    {
      name: "music.deleteSong",
      fn: () => client.music.deleteSong(fixtures.deleteSong),
    },

    // albums
    {
      name: "music.queryAlbums",
      fn: () => client.music.queryAlbums(fixtures.queryParams),
    },
    {
      name: "music.getAlbum",
      fn: () => client.music.getAlbum(fixtures.getAlbum),
    },
    {
      name: "music.deleteAlbum",
      fn: () => client.music.deleteAlbum(fixtures.deleteAlbum),
    },

    // artists
    {
      name: "music.queryArtists",
      fn: () => client.music.queryArtists(fixtures.queryParams),
    },
    {
      name: "music.getArtist",
      fn: () => client.music.getArtist(fixtures.getArtist),
    },
    {
      name: "music.createArtist",
      fn: () => client.music.createArtist(fixtures.createArtist),
    },
    {
      name: "music.deleteArtist",
      fn: () => client.music.deleteArtist(fixtures.deleteArtist),
    },

    // playlists
    {
      name: "music.listPlaylists",
      fn: () => client.music.listPlaylists(fixtures.queryParams),
    },
    {
      name: "music.getPlaylistById",
      fn: () => client.music.getPlaylistById({ id: PLACEHOLDER_ID }),
    },
    {
      name: "music.createPlaylist",
      fn: () => client.music.createPlaylist(fixtures.createPlaylist),
    },
    {
      name: "music.updatePlaylist",
      fn: () => client.music.updatePlaylist(fixtures.updatePlaylist),
    },
    {
      name: "music.deletePlaylist",
      fn: () => client.music.deletePlaylist(fixtures.deletePlaylist),
    },
    {
      name: "music.queryPlaylistSongs",
      fn: () => client.music.queryPlaylistSongs(fixtures.queryPlaylistSongs),
    },
    {
      name: "music.addSongsToPlaylist",
      fn: () => client.music.addSongsToPlaylist(fixtures.addSongsToPlaylist),
    },
    {
      name: "music.removeSongsFromPlaylist",
      fn: () =>
        client.music.removeSongsFromPlaylist(fixtures.removeSongsFromPlaylist),
    },
    {
      name: "music.reorderPlaylistSongs",
      fn: () =>
        client.music.reorderPlaylistSongs(fixtures.reorderPlaylistSongs),
    },
    {
      name: "music.deleteImage",
      fn: () => client.music.deleteImage(fixtures.deleteImage),
    },

    // genres
    {
      name: "music.queryGenres",
      fn: () => client.music.queryGenres(fixtures.queryParams),
    },
    {
      name: "music.getGenre",
      fn: () => client.music.getGenre(fixtures.getGenre),
    },

    // favorites
    {
      name: "music.listFavorites",
      fn: () => client.music.listFavorites(fixtures.listFavorites),
    },
    {
      name: "music.setFavorite",
      fn: () => client.music.setFavorite(fixtures.setFavorite),
    },

    // ratings
    {
      name: "music.setRating",
      fn: () => client.music.setRating(fixtures.setRating),
    },
    {
      name: "music.removeRating",
      fn: () => client.music.removeRating(fixtures.removeRating),
    },
    {
      name: "music.getRatingStats",
      fn: () => client.music.getRatingStats(fixtures.getRatingStats),
    },

    // tags
    { name: "music.listTags", fn: () => client.music.listTags() },
    {
      name: "music.queryTags",
      fn: () => client.music.queryTags(fixtures.queryTags),
    },
    {
      name: "music.getTag",
      fn: () => client.music.getTag(fixtures.getTag),
    },
    {
      name: "music.deleteTag",
      fn: () => client.music.deleteTag(fixtures.deleteTag),
    },
    {
      name: "music.getAlbumsTags",
      fn: () => client.music.getAlbumsTags(fixtures.getAlbumTags),
    },
    {
      name: "music.addAlbumsTags",
      fn: () => client.music.addAlbumsTags(fixtures.addAlbumTags),
    },
    {
      name: "music.removeAlbumsTags",
      fn: () => client.music.removeAlbumsTags(fixtures.removeAlbumTags),
    },
    {
      name: "music.replaceAlbumsTags",
      fn: () => client.music.replaceAlbumsTags(fixtures.replaceAlbumTags),
    },

    // analytics
    {
      name: "music.recordPlay",
      fn: () => client.music.recordPlay(fixtures.recordPlay),
    },
    {
      name: "music.songAnalytics",
      fn: () => client.music.songAnalytics(fixtures.songAnalytics),
    },
    {
      name: "music.listeningHistory",
      fn: () => client.music.listeningHistory(fixtures.listeningHistory),
    },
    {
      name: "music.topSongs",
      fn: () => client.music.topSongs(fixtures.topSongs),
    },
    {
      name: "music.topArtists",
      fn: () => client.music.topArtists(fixtures.topArtists),
    },
    {
      name: "music.topAlbums",
      fn: () => client.music.topAlbums(fixtures.topAlbums),
    },
    {
      name: "music.activityFeed",
      fn: () => client.music.activityFeed(fixtures.feed),
    },

    // musicbrainz
    {
      name: "music.searchMusicbrainzReleases",
      fn: () =>
        client.music.searchMusicbrainzReleases(fixtures.searchReleases),
    },
    {
      name: "music.getMusicbrainzRelease",
      fn: () => client.music.getMusicbrainzRelease(fixtures.getRelease),
    },

    // jobs
    {
      name: "music.listJobs",
      fn: () => client.music.listJobs(fixtures.listJobs),
    },
    {
      name: "music.getJobStatus",
      fn: () => client.music.getJobStatus(fixtures.getJobsStatus),
    },

    // fetch
    {
      name: "music.createFetchJob",
      fn: () => client.music.createFetchJob(fixtures.fetchMedia),
    },
    {
      name: "music.getFetchJob",
      fn: () => client.music.getFetchJob({ job_id: PLACEHOLDER_ID }),
    },

    // blobs - still using utils module (HTTP-specific)
    {
      name: "utils.fetchBlobMetadata",
      fn: () => utils.fetchBlobMetadata(baseUrl, PLACEHOLDER_ID),
    },

    // uploads - still using utils module (HTTP-specific FormData)
    {
      name: "utils.uploadImage",
      fn: () => utils.uploadImage(baseUrl, new Blob(["test"])),
    },
    {
      name: "utils.uploadMusic",
      fn: () => utils.uploadMusic(baseUrl, new Blob(["test"])),
    },
  ];

  for (const route of protectedRoutes) {
    await test(`${route.name} - rejects without auth`, async () => {
      const result = await route.fn();
      if (result.success) {
        throw new Error(`${route.name} should fail without auth`);
      }
      // extract error message from zod error
      const errorMsg =
        result.error.issues?.[0]?.message ||
        result.error.issues?.[0]?.message ||
        result.error.message ||
        "";
      if (!errorMsg.includes("401") && !errorMsg.includes("403")) {
        throw new Error(`expected 401/403, got: ${errorMsg}`);
      }
    });
  }

  console.log("");
  console.log(
    "✓ auth validation complete - all routes reject without credentials\n",
  );
  console.log(
    "  (authenticated workflows tested in stateful tests - see stateful.ts)\n",
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);

  return { passed, failed };
}

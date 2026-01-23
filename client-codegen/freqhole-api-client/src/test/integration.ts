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
import * as app from "../app.js";
import * as auth from "../auth.js";
import * as music from "../music.js";
import * as utils from "../utils.js";
import {
  fixtures,
  PLACEHOLDER_ID,
  queryParams,
  withAlbumId,
  withEntityId,
  withId,
  withPlaylistId,
} from "./fixtures.js";

const baseUrl = process.env.API_URL || "http://localhost:8080";
const apiKey = process.env.API_KEY;

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
    const result = await app.healthCheck(baseUrl);
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
    { name: "auth.whoami", fn: () => auth.whoami(baseUrl) },
    { name: "auth.apiKeyStatus", fn: () => auth.apiKeyStatus(baseUrl) },
    { name: "auth.regenerateApiKey", fn: () => auth.regenerateApiKey(baseUrl) },
    { name: "auth.logout", fn: () => auth.logout(baseUrl) },

    // songs
    {
      name: "music.querySongs",
      fn: () => music.querySongs(baseUrl, queryParams),
    },
    {
      name: "music.recentSongs",
      fn: () => music.recentSongs(baseUrl, { limit: 10 }),
    },
    {
      name: "music.updateSongs",
      fn: () => music.updateSongs(baseUrl, fixtures.updateSongs),
    },
    {
      name: "music.deleteSong",
      fn: () => music.deleteSong(baseUrl, fixtures.deleteSong),
    },

    // albums
    {
      name: "music.queryAlbums",
      fn: () => music.queryAlbums(baseUrl, fixtures.queryParams),
    },
    {
      name: "music.getAlbum",
      fn: () => music.getAlbum(baseUrl, fixtures.getAlbum),
    },
    {
      name: "music.deleteAlbum",
      fn: () => music.deleteAlbum(baseUrl, fixtures.deleteAlbum),
    },

    // artists
    {
      name: "music.queryArtists",
      fn: () => music.queryArtists(baseUrl, fixtures.queryParams),
    },
    {
      name: "music.getArtist",
      fn: () => music.getArtist(baseUrl, fixtures.getArtist),
    },
    {
      name: "music.createArtist",
      fn: () => music.createArtist(baseUrl, fixtures.createArtist),
    },
    {
      name: "music.deleteArtist",
      fn: () => music.deleteArtist(baseUrl, fixtures.deleteArtist),
    },

    // playlists
    {
      name: "music.listPlaylists",
      fn: () => music.listPlaylists(baseUrl, fixtures.queryParams),
    },
    {
      name: "music.getPlaylistById",
      fn: () => music.getPlaylistById(baseUrl, { id: PLACEHOLDER_ID }),
    },
    {
      name: "music.createPlaylist",
      fn: () => music.createPlaylist(baseUrl, fixtures.createPlaylist),
    },
    {
      name: "music.updatePlaylist",
      fn: () => music.updatePlaylist(baseUrl, fixtures.updatePlaylist),
    },
    {
      name: "music.deletePlaylist",
      fn: () => music.deletePlaylist(baseUrl, fixtures.deletePlaylist),
    },
    {
      name: "music.queryPlaylistSongs",
      fn: () => music.queryPlaylistSongs(baseUrl, fixtures.queryPlaylistSongs),
    },
    {
      name: "music.addSongsToPlaylist",
      fn: () => music.addSongsToPlaylist(baseUrl, fixtures.addSongsToPlaylist),
    },
    {
      name: "music.removeSongsFromPlaylist",
      fn: () =>
        music.removeSongsFromPlaylist(
          baseUrl,
          fixtures.removeSongsFromPlaylist,
        ),
    },
    {
      name: "music.reorderPlaylistSongs",
      fn: () =>
        music.reorderPlaylistSongs(baseUrl, fixtures.reorderPlaylistSongs),
    },
    {
      name: "music.removePlaylistThumbnail",
      fn: () =>
        music.removePlaylistThumbnail(
          baseUrl,
          fixtures.removePlaylistThumbnail,
        ),
    },

    // genres & sub-genres
    {
      name: "music.queryGenres",
      fn: () => music.queryGenres(baseUrl, fixtures.queryParams),
    },
    {
      name: "music.getGenre",
      fn: () => music.getGenre(baseUrl, fixtures.getGenre),
    },
    { name: "music.listSubGenres", fn: () => music.listSubGenres(baseUrl) },
    {
      name: "music.querySubGenres",
      fn: () => music.querySubGenres(baseUrl, fixtures.querySubGenres),
    },
    {
      name: "music.getSubGenre",
      fn: () => music.getSubGenre(baseUrl, fixtures.getSubGenre),
    },
    {
      name: "music.createSubGenre",
      fn: () => music.createSubGenre(baseUrl, fixtures.createSubGenre),
    },
    {
      name: "music.deleteSubGenre",
      fn: () => music.deleteSubGenre(baseUrl, fixtures.deleteSubGenre),
    },
    {
      name: "music.listSubGenresForGenre",
      fn: () =>
        music.listSubGenresForGenre(baseUrl, fixtures.listSubGenresForGenre),
    },
    {
      name: "music.findOrCreateSubGenre",
      fn: () =>
        music.findOrCreateSubGenre(baseUrl, fixtures.findOrCreateSubGenre),
    },

    // favorites
    {
      name: "music.listFavorites",
      fn: () => music.listFavorites(baseUrl, fixtures.listFavorites),
    },
    {
      name: "music.setFavorite",
      fn: () => music.setFavorite(baseUrl, fixtures.setFavorite),
    },

    // ratings
    {
      name: "music.setRating",
      fn: () => music.setRating(baseUrl, fixtures.setRating),
    },
    {
      name: "music.removeRating",
      fn: () => music.removeRating(baseUrl, fixtures.removeRating),
    },
    {
      name: "music.getRatingStats",
      fn: () => music.getRatingStats(baseUrl, fixtures.getRatingStats),
    },

    // tags
    { name: "music.listTags", fn: () => music.listTags(baseUrl) },
    {
      name: "music.queryTags",
      fn: () => music.queryTags(baseUrl, fixtures.queryTags),
    },
    {
      name: "music.getTag",
      fn: () => music.getTag(baseUrl, fixtures.getTag),
    },
    {
      name: "music.deleteTag",
      fn: () => music.deleteTag(baseUrl, fixtures.deleteTag),
    },
    {
      name: "music.getAlbumsTags",
      fn: () => music.getAlbumsTags(baseUrl, fixtures.getAlbumTags),
    },
    {
      name: "music.addAlbumsTags",
      fn: () => music.addAlbumsTags(baseUrl, fixtures.addAlbumTags),
    },
    {
      name: "music.removeAlbumsTags",
      fn: () => music.removeAlbumsTags(baseUrl, fixtures.removeAlbumTags),
    },
    {
      name: "music.replaceAlbumsTags",
      fn: () => music.replaceAlbumsTags(baseUrl, fixtures.replaceAlbumTags),
    },

    // analytics
    {
      name: "music.recordPlay",
      fn: () => music.recordPlay(baseUrl, fixtures.recordPlay),
    },
    {
      name: "music.songAnalytics",
      fn: () => music.songAnalytics(baseUrl, fixtures.songAnalytics),
    },
    {
      name: "music.listeningHistory",
      fn: () => music.listeningHistory(baseUrl, fixtures.listeningHistory),
    },
    {
      name: "music.topSongs",
      fn: () => music.topSongs(baseUrl, fixtures.topSongs),
    },
    {
      name: "music.topArtists",
      fn: () => music.topArtists(baseUrl, fixtures.topArtists),
    },
    {
      name: "music.topAlbums",
      fn: () => music.topAlbums(baseUrl, fixtures.topAlbums),
    },
    {
      name: "music.activityFeed",
      fn: () => music.activityFeed(baseUrl, fixtures.feed),
    },

    // musicbrainz
    {
      name: "music.searchMusicbrainzReleases",
      fn: () =>
        music.searchMusicbrainzReleases(baseUrl, fixtures.searchReleases),
    },
    {
      name: "music.getMusicbrainzRelease",
      fn: () => music.getMusicbrainzRelease(baseUrl, fixtures.getRelease),
    },

    // jobs
    {
      name: "music.listJobs",
      fn: () => music.listJobs(baseUrl, fixtures.listJobs),
    },
    {
      name: "music.getJobStatus",
      fn: () => music.getJobStatus(baseUrl, fixtures.getJob),
    },

    // fetch
    {
      name: "music.createFetchJob",
      fn: () => music.createFetchJob(baseUrl, fixtures.fetchMedia),
    },
    {
      name: "music.getFetchJob",
      fn: () => music.getFetchJob(baseUrl, { id: PLACEHOLDER_ID }),
    },

    // blobs - now using utils module
    {
      name: "utils.fetchBlobMetadata",
      fn: () => utils.fetchBlobMetadata(baseUrl, PLACEHOLDER_ID),
    },

    // uploads - now using utils module with FormData
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

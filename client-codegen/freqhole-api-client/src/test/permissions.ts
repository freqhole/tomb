// characterization tests for permission outcomes - written against the
// current implementation before it's rebound onto
// @freqhole/haruspex/permissions, so the rebind can be verified as a
// pure internal refactor (same public behavior, different plumbing).
import assert from "node:assert/strict";
import {
  canAccessOwner,
  canAccessOwnerOr,
  canAccessRole,
  canAccessRoute,
  canCreatePlaylist,
  canDeleteAlbum,
  canDeletePlaylist,
  canDeleteSong,
  canReorderPlaylistSongs,
  canUpdatePlaylist,
  isAdmin,
  isMemberOrHigher,
} from "../permissions.js";
import type { RouteAuth } from "../codegen/routes.js";

interface Case {
  name: string;
  run: () => void;
}

const cases: Case[] = [
  {
    name: "canAccessRole: exact role match allowed",
    run: () => assert.equal(canAccessRole("member", "member"), true),
  },
  {
    name: "canAccessRole: higher-privilege role satisfies a lower requirement",
    run: () => {
      assert.equal(canAccessRole("admin", "member"), true);
      assert.equal(canAccessRole("root", "admin"), true);
    },
  },
  {
    name: "canAccessRole: lower-privilege role rejected",
    run: () => {
      assert.equal(canAccessRole("viewer", "member"), false);
      assert.equal(canAccessRole("member", "admin"), false);
    },
  },
  {
    name: "canAccessOwner: matching id allowed, mismatched/null rejected",
    run: () => {
      assert.equal(canAccessOwner("user-1", "user-1"), true);
      assert.equal(canAccessOwner("user-1", "user-2"), false);
      assert.equal(canAccessOwner("user-1", null), false);
    },
  },
  {
    name: "canAccessOwnerOr: owner passes regardless of role",
    run: () => assert.equal(canAccessOwnerOr("user-1", "user-1", "viewer", "admin"), true),
  },
  {
    name: "canAccessOwnerOr: non-owner needs a sufficient role",
    run: () => {
      assert.equal(canAccessOwnerOr("user-1", "user-2", "admin", "admin"), true);
      assert.equal(canAccessOwnerOr("user-1", "user-2", "member", "admin"), false);
    },
  },
  {
    name: "canAccessRoute: public always allowed",
    run: () => assert.equal(canAccessRoute({ type: "public" }, null, null, null), true),
  },
  {
    name: "canAccessRoute: authenticated requires any signed-in role",
    run: () => {
      const auth: RouteAuth = { type: "authenticated" };
      assert.equal(canAccessRoute(auth, "viewer", "user-1", null), true);
      assert.equal(canAccessRoute(auth, null, null, null), false);
    },
  },
  {
    name: "canAccessRoute: role requires the minimum role",
    run: () => {
      const auth: RouteAuth = { type: "role", role: "admin" };
      assert.equal(canAccessRoute(auth, "admin", "user-1", null), true);
      assert.equal(canAccessRoute(auth, "member", "user-1", null), false);
      assert.equal(canAccessRoute(auth, null, null, null), false);
    },
  },
  {
    name: "canAccessRoute: owner requires the exact owner id",
    run: () => {
      const auth: RouteAuth = { type: "owner" };
      assert.equal(canAccessRoute(auth, "viewer", "user-1", "user-1"), true);
      assert.equal(canAccessRoute(auth, "viewer", "user-1", "user-2"), false);
      assert.equal(canAccessRoute(auth, null, null, "user-2"), false);
    },
  },
  {
    name: "canAccessRoute: owner_or allows the owner or a sufficient role",
    run: () => {
      const auth: RouteAuth = { type: "owner_or", role: "admin" };
      assert.equal(canAccessRoute(auth, "viewer", "user-1", "user-1"), true);
      assert.equal(canAccessRoute(auth, "admin", "user-2", "user-1"), true);
      assert.equal(canAccessRoute(auth, "member", "user-2", "user-1"), false);
    },
  },
  {
    name: "canDeletePlaylist: owner_or(admin) - owner or admin allowed, others rejected",
    run: () => {
      assert.equal(canDeletePlaylist("user-1", "user-1", "viewer"), true);
      assert.equal(canDeletePlaylist("user-2", "user-1", "admin"), true);
      assert.equal(canDeletePlaylist("user-2", "user-1", "member"), false);
    },
  },
  {
    name: "canUpdatePlaylist: same owner_or(admin) shape as delete",
    run: () => {
      assert.equal(canUpdatePlaylist("user-1", "user-1", "viewer"), true);
      assert.equal(canUpdatePlaylist("user-2", "user-1", "member"), false);
    },
  },
  {
    name: "canReorderPlaylistSongs: same owner_or(admin) shape",
    run: () => {
      assert.equal(canReorderPlaylistSongs("user-1", "user-1", "viewer"), true);
      assert.equal(canReorderPlaylistSongs("user-2", "user-1", "member"), false);
    },
  },
  {
    name: "canDeleteSong: role(admin) - only admin+ allowed",
    run: () => {
      assert.equal(canDeleteSong("admin"), true);
      assert.equal(canDeleteSong("member"), false);
    },
  },
  {
    name: "canDeleteAlbum: role(admin)",
    run: () => {
      assert.equal(canDeleteAlbum("root"), true);
      assert.equal(canDeleteAlbum("viewer"), false);
    },
  },
  {
    name: "canCreatePlaylist: role(member) - member+ allowed, viewer rejected",
    run: () => {
      assert.equal(canCreatePlaylist("member"), true);
      assert.equal(canCreatePlaylist("admin"), true);
      assert.equal(canCreatePlaylist("viewer"), false);
    },
  },
  {
    name: "isMemberOrHigher / isAdmin convenience checks",
    run: () => {
      assert.equal(isMemberOrHigher("member"), true);
      assert.equal(isMemberOrHigher("viewer"), false);
      assert.equal(isAdmin("admin"), true);
      assert.equal(isAdmin("member"), false);
    },
  },
];

export async function runPermissionsTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  console.log("running permissions characterization tests...\n");

  for (const testCase of cases) {
    try {
      testCase.run();
      console.log(`PASS ${testCase.name}`);
      passed++;
    } catch (err) {
      errors.push(`FAIL ${testCase.name}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  if (errors.length > 0) {
    console.log("\nerrors found:\n");
    errors.forEach((err) => console.log(err));
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);

  return { passed, failed };
}

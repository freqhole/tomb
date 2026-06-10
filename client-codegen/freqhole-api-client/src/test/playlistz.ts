// unit tests for the playlistz domain package.
// pure - no server, no automerge, no browser APIs required.
import {
  parsePlaylistDoc,
  emptyPlaylistDoc,
  type SongEntry,
  type ImageRef,
} from "../playlistz/schema.js";
import {
  upsertSong,
  removeSong,
  reorderSongs,
  setMetadata,
  addImage,
  setPrimaryImage,
  addPeer,
  stampLastSeen,
  setAclRole,
  tombstone,
} from "../playlistz/mutations.js";
import {
  freqholePlaylistToDoc,
  spumePlaylistToDoc,
  docToFreqholePlaylist,
} from "../playlistz/convert.js";
import {
  encodeShareToken,
  decodeShareToken,
  shareFragment,
} from "../playlistz/shareLink.js";
import {
  encodeMessage,
  decodeMessage,
  ProtocolError,
  PLAYLISTZ_ALPN,
  AUTOMERGE_ALPN,
  type Message,
} from "../playlistz/protocol.js";

// ---- minimal assertion helpers ----

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(a: T, b: T, label: string): void {
  if (a !== b)
    throw new Error(`${label}: expected ${JSON.stringify(a)} got ${JSON.stringify(b)}`);
}

function assertDeepEqual(a: unknown, b: unknown, label: string): void {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs)
    throw new Error(`${label}: expected ${bs} got ${as}`);
}

// ---- test runner ----

export async function runPlaylistzTests(): Promise<{
  passed: number;
  failed: number;
}> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (err) {
      console.log(
        `✗ ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }

  console.log("playlistz domain tests\n");

  // ---- schema defaults ----

  await test("emptyPlaylistDoc returns valid doc with defaults", () => {
    const doc = emptyPlaylistDoc();
    assertEqual(doc.version, 1, "version");
    assertEqual(doc.title, "", "title");
    assertEqual(doc.description, "", "description");
    assert(doc.createdAt.length > 0, "createdAt non-empty");
    assertDeepEqual(doc.songs, {}, "songs");
    assertDeepEqual(doc.order, [], "order");
    assertDeepEqual(doc.peers, {}, "peers");
  });

  await test("emptyPlaylistDoc respects init overrides", () => {
    const doc = emptyPlaylistDoc({ title: "my list", description: "desc" });
    assertEqual(doc.title, "my list", "title");
    assertEqual(doc.description, "desc", "description");
  });

  await test("parsePlaylistDoc passes through valid data", () => {
    const now = new Date().toISOString();
    const raw = {
      version: 1 as const,
      title: "test",
      description: "",
      createdAt: now,
      lastModified: now,
      lastModifiedBy: "",
      images: [],
      urls: [],
      songs: {},
      order: [],
      peers: {},
    };
    const doc = parsePlaylistDoc(raw);
    assertEqual(doc.title, "test", "title");
  });

  await test("parsePlaylistDoc degrades gracefully on invalid data", () => {
    // invalid data: version wrong type, should fall back to defaults
    const doc = parsePlaylistDoc({ version: "bad", title: 999 });
    assertEqual(doc.version, 1, "version defaults to 1");
    assertEqual(doc.title, "", "title defaults to empty string");
  });

  await test("parsePlaylistDoc degrades on null", () => {
    const doc = parsePlaylistDoc(null);
    assertEqual(doc.version, 1, "version");
  });

  // ---- mutations ----

  function makeSong(id: string): SongEntry {
    return {
      id,
      title: `song ${id}`,
      artist: "artist",
      album: "album",
      duration: 180,
      mimeType: "audio/mpeg",
      fileSize: 1024,
      sha256: `sha256-${id}`,
      images: [],
      urls: [],
    };
  }

  await test("upsertSong adds song and appends to order", () => {
    const doc = emptyPlaylistDoc();
    upsertSong(doc, makeSong("a"));
    assert("a" in doc.songs, "song a in songs");
    assertEqual(doc.order.length, 1, "order length");
    assertEqual(doc.order[0], "a", "order[0]");
  });

  await test("upsertSong does not duplicate order entry", () => {
    const doc = emptyPlaylistDoc();
    upsertSong(doc, makeSong("a"));
    upsertSong(doc, makeSong("a"));
    assertEqual(doc.order.length, 1, "order length stays 1");
  });

  await test("upsertSong bumps lastModified", () => {
    const doc = emptyPlaylistDoc();
    // set a known old timestamp so any call to nowIso() will be strictly after it
    doc.lastModified = "2000-01-01T00:00:00.000Z";
    upsertSong(doc, makeSong("a"), "node1");
    assert(doc.lastModified > "2000-01-01T00:00:00.000Z", "lastModified bumped past sentinel");
    assertEqual(doc.lastModifiedBy, "node1", "lastModifiedBy set");
  });

  await test("removeSong deletes from songs and order", () => {
    const doc = emptyPlaylistDoc();
    upsertSong(doc, makeSong("a"));
    upsertSong(doc, makeSong("b"));
    removeSong(doc, "a");
    assert(!("a" in doc.songs), "a removed from songs");
    assert(!doc.order.includes("a"), "a removed from order");
    assertEqual(doc.order.length, 1, "order length");
    assertEqual(doc.order[0], "b", "b remains");
  });

  await test("removeSong on missing id is a no-op", () => {
    const doc = emptyPlaylistDoc();
    removeSong(doc, "nonexistent"); // should not throw
  });

  await test("reorderSongs moves song to target index", () => {
    const doc = emptyPlaylistDoc();
    upsertSong(doc, makeSong("a"));
    upsertSong(doc, makeSong("b"));
    upsertSong(doc, makeSong("c"));
    // move "c" (index 2) to index 0
    reorderSongs(doc, "c", 0);
    assertEqual(doc.order[0], "c", "c is first");
    assertEqual(doc.order[1], "a", "a is second");
    assertEqual(doc.order[2], "b", "b is third");
  });

  await test("reorderSongs clamps to valid range", () => {
    const doc = emptyPlaylistDoc();
    upsertSong(doc, makeSong("a"));
    upsertSong(doc, makeSong("b"));
    // move "a" to index 99 (should clamp to end)
    reorderSongs(doc, "a", 99);
    assertEqual(doc.order[doc.order.length - 1], "a", "a is last");
  });

  await test("reorderSongs ignores missing songId", () => {
    const doc = emptyPlaylistDoc();
    reorderSongs(doc, "ghost", 0); // should not throw
  });

  await test("setMetadata updates title and description", () => {
    const doc = emptyPlaylistDoc();
    setMetadata(doc, { title: "new title", description: "new desc" });
    assertEqual(doc.title, "new title", "title");
    assertEqual(doc.description, "new desc", "description");
  });

  await test("setMetadata partial update only changes supplied fields", () => {
    const doc = emptyPlaylistDoc({ title: "original" });
    setMetadata(doc, { description: "only desc" });
    assertEqual(doc.title, "original", "title unchanged");
    assertEqual(doc.description, "only desc", "description updated");
  });

  await test("addImage appends to playlist images", () => {
    const doc = emptyPlaylistDoc();
    const ref: ImageRef = { blobId: "blob1", isPrimary: false, blobType: "thumbnail" };
    addImage(doc, ref);
    assertEqual(doc.images.length, 1, "images length");
    assertEqual(doc.images[0].blobId, "blob1", "blobId");
  });

  await test("addImage with isPrimary clears siblings", () => {
    const doc = emptyPlaylistDoc();
    addImage(doc, { blobId: "blob1", isPrimary: true, blobType: "original" });
    addImage(doc, { blobId: "blob2", isPrimary: true, blobType: "thumbnail" });
    // blob1 should no longer be primary
    assert(!doc.images[0].isPrimary, "blob1 isPrimary cleared");
    assert(doc.images[1].isPrimary, "blob2 is primary");
  });

  await test("addImage to song images", () => {
    const doc = emptyPlaylistDoc();
    upsertSong(doc, makeSong("s1"));
    const ref: ImageRef = { blobId: "songblob", isPrimary: false, blobType: "thumbnail" };
    addImage(doc, ref, { songId: "s1" });
    assertEqual(doc.songs["s1"].images.length, 1, "song images length");
  });

  await test("addImage to missing song is a no-op", () => {
    const doc = emptyPlaylistDoc();
    addImage(doc, { blobId: "x", isPrimary: false, blobType: "original" }, { songId: "ghost" });
    // no throw
  });

  await test("setPrimaryImage sets exactly one primary", () => {
    const doc = emptyPlaylistDoc();
    addImage(doc, { blobId: "a", isPrimary: true, blobType: "original" });
    addImage(doc, { blobId: "b", isPrimary: false, blobType: "thumbnail" });
    setPrimaryImage(doc, "b");
    assert(!doc.images[0].isPrimary, "a no longer primary");
    assert(doc.images[1].isPrimary, "b is primary");
  });

  await test("addPeer is idempotent", () => {
    const doc = emptyPlaylistDoc();
    addPeer(doc, "node1");
    const firstJoinedAt = doc.peers["node1"].joinedAt;
    addPeer(doc, "node1"); // second call should not overwrite
    assertEqual(doc.peers["node1"].joinedAt, firstJoinedAt, "joinedAt unchanged");
  });

  await test("addPeer does not bump lastModified", () => {
    const doc = emptyPlaylistDoc();
    const before = doc.lastModified;
    addPeer(doc, "node1");
    assertEqual(doc.lastModified, before, "lastModified not bumped");
  });

  await test("stampLastSeen updates peer lastSeenAt", () => {
    const doc = emptyPlaylistDoc();
    addPeer(doc, "node1");
    stampLastSeen(doc, "node1");
    assert(doc.peers["node1"].lastSeenAt != null, "lastSeenAt set");
  });

  await test("stampLastSeen on unknown peer is a no-op", () => {
    const doc = emptyPlaylistDoc();
    stampLastSeen(doc, "ghost"); // should not throw
  });

  await test("setAclRole creates acl and sets role", () => {
    const doc = emptyPlaylistDoc();
    setAclRole(doc, "node1", "editor");
    assert(doc.acl != null, "acl created");
    assertEqual(doc.acl!["node1"].role, "editor", "role");
  });

  await test("tombstone sets deleted flag", () => {
    const doc = emptyPlaylistDoc();
    tombstone(doc);
    assert(doc.deleted === true, "deleted is true");
  });

  // ---- converters ----

  await test("freqholePlaylistToDoc maps snake_case + is_primary number", () => {
    const doc = freqholePlaylistToDoc(
      {
        id: "fpl1",
        title: "FH Playlist",
        description: "desc",
        is_public: 1,
        images: [
          { blob_id: "img1", is_primary: 1, blob_type: "original" },
          { blob_id: "img2", is_primary: 0, blob_type: "thumbnail" },
        ],
        urls: [{ id: "u1", name: "site", url: "https://example.com" }],
        created_by_id: null,
        created_at: 1000,
        updated_at: 2000,
        deleted_at: null,
        deleted_by: null,
        created_by: null,
        updated_by: null,
        song_count: 1,
      },
      [
        {
          id: "fs1",
          media_blob_id: "mediablob1",
          title: "FH Song",
          track_number: 1,
          disc_number: 1,
          duration: 120,
          images: [],
          urls: [],
          bpm: null,
          track_artist: "The Artist",
          metadata: null,
          lyrics: "la la la",
          created_at: 1000,
          updated_at: 2000,
          deleted_at: null,
          deleted_by: null,
          created_by: null,
          updated_by: null,
          created_by_username: null,
          updated_by_username: null,
          play_count: null,
        },
      ],
    );
    assertEqual(doc.title, "FH Playlist", "title");
    assert(doc.images[0].isPrimary, "first image is primary");
    assert(!doc.images[1].isPrimary, "second image not primary");
    assertEqual(doc.songs["fs1"].sha256, "mediablob1", "sha256 from media_blob_id");
    assertEqual(doc.songs["fs1"].artist, "The Artist", "artist from track_artist");
    assertEqual(doc.songs["fs1"].lyrics, "la la la", "lyrics");
  });

  await test("spumePlaylistToDoc maps spume field names", () => {
    const doc = spumePlaylistToDoc(
      {
        playlist_id: "spl1",
        title: "Spume Playlist",
        description: "spume desc",
        created_at: 1000,
        updated_at: 2000,
        images: [
          { local_blob_id: "lb1", is_primary: true, blob_type: "original" },
          { remote_blob_id: "rb1", is_primary: false, blob_type: "thumbnail" },
        ],
      },
      [
        {
          id: "ss1",
          sha256: "spumehash1",
          title: "Spume Song",
          artist_name: "Spume Artist",
          album_title: "Spume Album",
          duration_seconds: 240,
          mime_type: "audio/ogg",
          file_size: 4096,
          blake3: "blake3hash",
          lyrics: "words",
        },
      ],
    );
    assertEqual(doc.title, "Spume Playlist", "title");
    assertEqual(doc.images[0].blobId, "lb1", "local_blob_id mapped");
    assertEqual(doc.images[1].blobId, "rb1", "remote_blob_id mapped");
    assertEqual(doc.songs["ss1"].sha256, "spumehash1", "sha256");
    assertEqual(doc.songs["ss1"].artist, "Spume Artist", "artist_name mapped");
    assertEqual(doc.songs["ss1"].album, "Spume Album", "album_title mapped");
    assertEqual(doc.songs["ss1"].duration, 240, "duration_seconds mapped");
    assertEqual(doc.songs["ss1"].blake3, "blake3hash", "blake3");
  });

  await test("spumePlaylistToDoc skips images with no blob id", () => {
    const doc = spumePlaylistToDoc(
      {
        playlist_id: "pl",
        title: "T",
        images: [{ is_primary: false, blob_type: "original" }],
      },
      [],
    );
    assertEqual(doc.images.length, 0, "no images (no blob id)");
  });

  await test("docToFreqholePlaylist round-trip preserves core fields", () => {
    const original = freqholePlaylistToDoc(
      {
        id: "x",
        title: "RT Playlist",
        description: "rt desc",
        is_public: 0,
        images: [],
        urls: [],
        created_by_id: null,
        created_at: 1000,
        updated_at: 2000,
        deleted_at: null,
        deleted_by: null,
        created_by: null,
        updated_by: null,
        song_count: 0,
      },
      [],
    );
    const { playlist } = docToFreqholePlaylist(original);
    assertEqual(playlist.title, "RT Playlist", "title round-trips");
    assertEqual(playlist.description, "rt desc", "description round-trips");
  });

  await test("docToFreqholePlaylist songs preserve title and artist", () => {
    const doc = emptyPlaylistDoc({ title: "pl" });
    upsertSong(doc, {
      id: "s1",
      title: "Song Title",
      artist: "Artist",
      album: "Album",
      duration: 100,
      mimeType: "audio/mpeg",
      fileSize: 512,
      sha256: "hash1",
      images: [],
      urls: [],
    });
    const { songs } = docToFreqholePlaylist(doc);
    assertEqual(songs.length, 1, "one song");
    assertEqual(songs[0].title, "Song Title", "title");
    assertEqual(songs[0].track_artist, "Artist", "track_artist from artist");
  });

  // ---- share token ----

  await test("encodeShareToken + decodeShareToken round-trip", () => {
    const payload = { v: 1 as const, n: "a".repeat(64), d: "docid123" };
    const token = encodeShareToken(payload);
    const decoded = decodeShareToken(token);
    assert(decoded !== null, "decoded is not null");
    assertEqual(decoded!.n, payload.n, "nodeId");
    assertEqual(decoded!.d, payload.d, "docId");
    assertEqual(decoded!.v, 1, "version");
  });

  await test("shareFragment builds correct fragment", () => {
    const payload = { v: 1 as const, n: "n", d: "d", t: "title" };
    const frag = shareFragment(payload);
    assert(frag.startsWith("#share/"), "starts with #share/");
    const decoded = decodeShareToken(frag);
    assert(decoded !== null, "fragment decodes");
    assertEqual(decoded!.t, "title", "title hint preserved");
  });

  await test("decodeShareToken strips #share/ prefix", () => {
    const payload = { v: 1 as const, n: "nn", d: "dd" };
    const frag = shareFragment(payload);
    const decoded = decodeShareToken(frag);
    assert(decoded !== null, "decoded");
    assertEqual(decoded!.d, "dd", "docId");
  });

  await test("decodeShareToken strips share/ prefix", () => {
    const payload = { v: 1 as const, n: "nn", d: "dd" };
    const token = encodeShareToken(payload);
    const decoded = decodeShareToken("share/" + token);
    assert(decoded !== null, "decoded");
  });

  await test("decodeShareToken strips full url with #share/", () => {
    const payload = { v: 1 as const, n: "nn", d: "dd" };
    const token = encodeShareToken(payload);
    const url = "https://example.com/app#share/" + token;
    const decoded = decodeShareToken(url);
    assert(decoded !== null, "decoded from full url");
    assertEqual(decoded!.n, "nn", "nodeId");
  });

  await test("decodeShareToken accepts base64url encoding", () => {
    // base64url uses - and _ instead of + and /; also no padding
    const payload = { v: 1 as const, n: "nn", d: "dd" };
    const token = encodeShareToken(payload);
    // tokens from encodeShareToken are already base64url - decoding should work
    assert(!token.includes("+"), "no + in token");
    assert(!token.includes("/"), "no / in token");
    assert(!token.includes("="), "no padding");
    const decoded = decodeShareToken(token);
    assert(decoded !== null, "decoded");
  });

  await test("decodeShareToken trims whitespace", () => {
    const payload = { v: 1 as const, n: "n1", d: "d1" };
    const token = encodeShareToken(payload);
    const decoded = decodeShareToken("  " + token + "\n");
    assert(decoded !== null, "decoded with whitespace");
  });

  await test("decodeShareToken returns null on garbage", () => {
    const result = decodeShareToken("not-a-valid-token!!!");
    assert(result === null, "null on garbage");
  });

  await test("decodeShareToken returns null on empty string", () => {
    assert(decodeShareToken("") === null, "null on empty");
  });

  await test("decodeShareToken returns null on missing required fields", () => {
    // payload missing 'd'
    const partial = btoa(JSON.stringify({ v: 1, n: "nodeonly" }));
    assert(decodeShareToken(partial) === null, "null on missing d");
  });

  // ---- protocol ----

  await test("ALPN constants are correct", () => {
    assertEqual(PLAYLISTZ_ALPN, "freqhole-playlistz/1", "playlistz ALPN");
    assertEqual(AUTOMERGE_ALPN, "iroh/automerge-repo/1", "automerge ALPN");
  });

  await test("encodeMessage + decodeMessage round-trip for hello", () => {
    const msg: Message = { v: 1, type: "hello", nodeId: "abc123" };
    const bytes = encodeMessage(msg);
    const decoded = decodeMessage(bytes);
    assertDeepEqual(decoded, msg, "hello round-trip");
  });

  await test("encodeMessage + decodeMessage for playlists response", () => {
    const msg: Message = {
      v: 1,
      type: "playlists",
      items: [{ docId: "doc1", title: "My List", songCount: 5 }],
    };
    const decoded = decodeMessage(encodeMessage(msg));
    assertDeepEqual(decoded, msg, "playlists round-trip");
  });

  await test("decodeMessage throws ProtocolError on non-JSON bytes", () => {
    const bytes = new TextEncoder().encode("not json {{{{");
    try {
      decodeMessage(bytes);
      throw new Error("should have thrown");
    } catch (err) {
      assert(err instanceof ProtocolError, "ProtocolError thrown");
      assertEqual((err as ProtocolError).code, "parse_error", "code");
    }
  });

  await test("decodeMessage throws ProtocolError on unknown type", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ v: 1, type: "unknown_type_xyz" }),
    );
    try {
      decodeMessage(bytes);
      throw new Error("should have thrown");
    } catch (err) {
      assert(err instanceof ProtocolError, "ProtocolError thrown");
      assertEqual((err as ProtocolError).code, "schema_error", "code");
    }
  });

  await test("decodeMessage throws ProtocolError on missing required fields", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, type: "hello" }));
    // hello requires nodeId
    try {
      decodeMessage(bytes);
      throw new Error("should have thrown");
    } catch (err) {
      assert(err instanceof ProtocolError, "ProtocolError thrown");
    }
  });

  await test("all message types encode/decode", () => {
    const messages: Message[] = [
      { v: 1, type: "hello", nodeId: "n1", name: "Alice" },
      { v: 1, type: "hello_ok", nodeId: "n2", public: true },
      { v: 1, type: "list_playlists" },
      { v: 1, type: "playlists", items: [] },
      { v: 1, type: "knock", nodeId: "n3", message: "hi" },
      {
        v: 1,
        type: "knock_status",
        status: "accepted",
        grantedDocIds: ["doc1"],
      },
      { v: 1, type: "error", code: "not_found", message: "not found" },
    ];
    for (const msg of messages) {
      const decoded = decodeMessage(encodeMessage(msg));
      assertDeepEqual(decoded, msg, `round-trip for type=${msg.type}`);
    }
  });

  // summary
  console.log(`\nplaylistz: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

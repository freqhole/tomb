# reliquary development guide

## project overview

reliquary is the media blob storage library for the freqhole family of apps (tomb, skein,
playlistz): content-addressed blob stores (sqlite-native and indexeddb/opfs-browser),
iroh-blobs wrappers (fs store lifecycle, gc protection, verified transfer), the snatch engine
(proactive blob replication), blob acl gating, media helpers (image resize, thumbnails),
shared browser utils (workers, image/hash/log helpers). rust crate `reliquary` + npm package
`@freqhole/reliquary`. extracted per the
[xl-refactor plan](https://github.com/freqhole/tomb/blob/main/docs/xl-refactor/OVERVIEW.md) in
the tomb repo - see that repo's `docs/xl-refactor/PHASE_2_RELIQUARY_RUST.md` and
`PHASE_3_RELIQUARY_TS.md` for the full design and decision log.

## architecture requirements (inherited from the xl-refactor plan, non-negotiable)

- **one deliberate storage contract**: a single `BlobStore` trait designed up front (see
  `storage-traits.md`, written before the port and gated on user sign-off) - not a family of
  similar-but-slightly-different impls.
- **transport-agnostic**: iroh p2p is a transport, not the architecture. this is a
  decentralized, peer-to-peer system - avoid client-server terminology in new code and docs.
- **framework-free core**: the `ts/` package's core subpaths must have zero framework
  dependencies. `solid-js` is an optional peer dep, only imported from `./solid`.
- **never owns an http server**: range serving stays in the consuming app's own server;
  reliquary ships pieces/modules apps plug into their own server, not a bundled server
  instance.
- **content addressing**: blake3 canonical everywhere; sha256 kept as a legacy secondary
  index only.
- **tests travel with code**: every module carries its tests along.
- **examples + testing utils are deliverables**: `examples/` (rust) and testing utilities
  (`reliquary::testing` behind a `test-utils` feature; `@freqhole/reliquary/testing` ts
  subpath) are part of what this repo ships, not an afterthought.

## code style

### lowercase prose preference

write comments, documentation, and user-facing messages in lowercase conversational style.

**keep uppercase for:**

- acronyms: API, HTTP, JSON, SQL, CRUD, REST, CLI
- proper nouns: Rust, TypeScript, GitHub, SQLite, PostgreSQL
- code identifiers: function names, type names, constants
- special markers: TODO, FIXME, NOTE, WARNING

**use lowercase for:**

- regular comments explaining logic
- documentation/docstrings
- error messages and user-facing strings
- log messages

### no emojis in code

avoid emojis in comments, error messages, or any code. use them only in markdown
documentation if appropriate.

### comments must be timeless

never reference the extraction/porting process itself in a source comment. no "donor",
"ported from skein's X", "mirrors both donors' behavior", "skein hardcoded this, we made it
configurable". write every comment as if the module had always existed standalone here -
describe what the code does and why in domain terms, never where it came from or what it
differs from elsewhere. provenance/rationale narration belongs in a phase doc under
`tomb/docs/xl-refactor/`, never in source comments.

## conventions

- **naming**: `snake_case` for rust, `camelCase` for typescript
- **no work-in-progress or dated tags in code comments** (no "phase 2" markers in code).
  comments describe what the code does; plan-doc references belong in docs only.
- **plan docs**: this repo doesn't hold its own copy of the xl-refactor plan - it lives in
  `tomb/docs/xl-refactor/`. link to it, don't duplicate it.

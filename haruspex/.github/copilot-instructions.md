# haruspex development guide

## project overview

haruspex is the auth domain library for the freqhole family of apps (tomb, skein, playlistz):
webauthn passkeys, knock access requests, user identity, multi-device node ids, roles +
groups, api keys + invite codes, acl primitives, and the friendz peer protocol. rust crate
`haruspex` + npm package `@freqhole/haruspex`. extracted per the
[xl-refactor plan](https://github.com/freqhole/tomb/blob/main/docs/xl-refactor/OVERVIEW.md) in
the tomb repo - see that repo's `docs/xl-refactor/PHASE_4_HARUSPEX_RUST.md` and
`PHASE_5_HARUSPEX_TS.md` for the full design and decision log.

## architecture requirements (inherited from the xl-refactor plan, non-negotiable)

- **transport-agnostic**: protocol logic takes (caller identity, message) and returns
  responses; iroh `ProtocolHandler` impls, http adapters, or anything else are thin shells
  around that. avoid client-server terminology/architecture - this is a decentralized,
  peer-to-peer system.
- **framework-free core**: the `ts/` package's core subpaths must have zero framework
  dependencies. `solid-js` is an optional peer dep, only imported from `./solid`.
- **extensible protocols**: consuming apps must be able to extend the shared wire protocols
  with app-specific messages without forking this repo.
- **tests travel with code**: every module carries its tests along.
- **examples + testing utils are deliverables**: `examples/` (rust) and testing utilities
  (`haruspex::testing` behind a `test-utils` feature; `@freqhole/haruspex/testing` ts subpath)
  are part of what this repo ships, not an afterthought.

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

## conventions

- **naming**: `snake_case` for rust, `camelCase` for typescript
- **no work-in-progress or dated tags in code comments** (no "phase 4" markers in code).
  comments describe what the code does; plan-doc references belong in docs only.
- **comments must be timeless**: never reference the extraction/porting process itself. no
  "donor", "ported from tomb's X", "mirrors the original behavior", "this crate doesn't ship the
  wordlist asset the donor used". write every comment as if the module had always existed
  standalone here - describe what the code does and why in domain terms, never where it came
  from or what it differs from elsewhere. provenance/rationale narration belongs in a phase doc
  under `tomb/docs/xl-refactor/`, never in source comments.
- **plan docs**: this repo doesn't hold its own copy of the xl-refactor plan - it lives in
  `tomb/docs/xl-refactor/`. link to it, don't duplicate it.

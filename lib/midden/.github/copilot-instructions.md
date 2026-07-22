# midden development guide

## project overview

midden is the unified wasm iroh node package for the freqhole world of apps (tomb, skein,
playlistz): a `MiddenNode` class that lets browsers connect to freqhole/skein peers over iroh
p2p (proxy requests, verified blob streaming, radio, admin dispatch, opfs-backed persistent
blob storage). rust crate (wasm-bindgen, built with wasm-pack) + npm package
`@freqhole/midden`. tomb's `client/midden` is the base and moved here, absorbing
skein/midden's capabilities, per the
[xl-refactor plan](https://github.com/freqhole/tomb/blob/main/docs/xl-refactor/OVERVIEW.md) in
the tomb repo - see that repo's `docs/xl-refactor/PHASE_1_MIDDEN_UNIFICATION.md` for the full
design and decision log.

## architecture requirements (inherited from the xl-refactor plan, non-negotiable)

- **app-neutral protocol surface**: the default registered ALPN set is the common base
  (freqhole/1, iroh/automerge-repo/1, freqhole-friendz/1, freqhole-admin/1, freqhole-events/1,
  iroh-blobs). app-specific ALPNs (e.g. skein's) are passed in via constructor `extra_alpns`,
  never hardcoded into the default set.
- **transport-agnostic consumers**: this is a decentralized, peer-to-peer system - avoid
  client-server terminology in new code and docs.
- **tests travel with code**: the opfs_store module's storage/actor logic is storage-generic
  and carries native (non-wasm) tests via a `NativeDir` test impl, so `cargo test` runs them
  without a browser.
- **back-compat during migration**: legacy constructor signatures (`create`,
  `create_from_key`, `create_with_alpns`) stay working as deprecated wrappers over
  `create_with_options` until the adoption phases (6-8) finish moving consumers over.

## code style

### lowercase prose preference

write comments, documentation, and user-facing messages in lowercase conversational style.

**keep uppercase for:**

- acronyms: API, HTTP, JSON, SQL, CRUD, REST, CLI, ALPN, OPFS, WASM
- proper nouns: Rust, TypeScript, GitHub, SQLite, iroh
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

- **naming**: `snake_case` for rust, `camelCase` for the generated wasm-bindgen ts surface
- **no work-in-progress or dated tags in code comments** (no "phase 1" markers in code).
  comments describe what the code does; plan-doc references belong in docs only.
- **plan docs**: this repo doesn't hold its own copy of the xl-refactor plan - it lives in
  `tomb/docs/xl-refactor/`. link to it, don't duplicate it.
- **`pkg/` is committed**: the wasm-pack output under `pkg/` is checked into git (consumers
  like spume and loam use `file:` deps pointing straight at it), so a rebuild is required
  whenever `src/` changes before consumers pick it up.

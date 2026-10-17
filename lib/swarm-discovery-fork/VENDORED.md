# vendored fork - why this directory exists

this is a vendored copy of [rkuhn/swarm-discovery](https://github.com/rkuhn/swarm-discovery)
0.6.4, patched to add a missing PTR answer record to its mdns announce
response (see `src/sender.rs`'s `make_response()` - the only change from
upstream).

## the bug this fixes

`swarm-discovery`'s announce response only ever emits SRV + TXT answer
records, never a PTR record under the plain service type (e.g.
`_irohv1._udp.local.`) pointing at each instance's own name. a standard
DNS-SD/RFC 6763 service-type enumeration needs that PTR record - it's the
only mechanism that lets a browser with no specific instance name in hand
discover "what instances exist" for a service type at all.

without it, OS-level Bonjour/mDNS-SD browse apis that strictly follow the
spec - apple's `NWBrowser` (macOS/iOS) and android's `NsdManager` - can
never enumerate any peer announced by this crate, even though this
crate's own receiver (used by this repo's own desktop augur backend, see
[lib/haruspex/rust/src/augur/desktop.rs](../haruspex/rust/src/augur/desktop.rs))
matches SRV/TXT records directly and so discovers these same peers just
fine.

confirmed via a real packet capture (`tcpdump` against an iphone's
mirrored network interface via `rvictl`) showing zero PTR answer records
anywhere on the wire for `_irohv1._udp.local.`, cross-checked directly
against this crate's own source - not guessed.

## how this is wired in

the root workspace `Cargo.toml` has a `[patch.crates-io]` entry pointing
`swarm-discovery` at this directory - `swarm-discovery` is never a direct
dependency of anything in this workspace, only a transitive one (pulled
in by `iroh-mdns-address-lookup`), so this patch applies workspace-wide
wherever that transitive dependency resolves.

this directory is excluded from the workspace's own `members` (see the
root `Cargo.toml`'s `exclude` list) since it has its own independent
version/edition/`Cargo.lock` and isn't meant to participate in this
workspace's own lint/feature unification.

## removing this once upstream has the fix

an upstream PR is planned (not yet opened as of this writing) at
https://github.com/rkuhn/swarm-discovery - a branch with this exact fix
already exists at `/Users/edward/src/github/rkuhn/swarm-discovery`
(`fix-missing-ptr-record`), ready to push to a fork and open a PR from
once there's time.

once a released version of `swarm-discovery` on crates.io includes this
fix, remove:

1. this whole `lib/swarm-discovery-fork/` directory
2. the `[patch.crates-io]` entry in the root `Cargo.toml`
3. the matching `exclude` entry in the root `Cargo.toml`
4. bump `iroh-mdns-address-lookup`'s own version in
   `lib/haruspex/rust/Cargo.toml` if it hasn't already picked up the new
   `swarm-discovery` release itself

# cenotaph

headless pairing/control/playback core for freqhole p2p remote players.

an empty tomb built to honor someone whose remains lie elsewhere - a
standalone player vessel that's controlled remotely.

## what lives here

- **pairing**: pin-based trust handshake between a controller (e.g. spume) and a player device,
  persisted in a local trust store.
- **control**: the `freqhole-player/1` command protocol (play/pause/seek/queue management/etc),
  a generic dispatcher, and a per-ALPN inbound accept-loop router.
- **hello**: a tiny generic router for the `freqhole/1` ALPN's single-shot request/response
  protocol (the same one grimoire's native federation transport and midden's `api_request()`
  dial-side client speak) - today only a `GET /api/hello` route is registered anywhere, but the
  router itself has no knowledge of that being the only route.

## design constraint: transport-agnostic, pluggable playback

this package never imports a concrete playback engine directly. every host app (today:
player.freqhole.net's own media-element engine, spume's real player/queue services) supplies its
own implementation of the `PlaybackBackend` interface (`control/playbackBackend.ts`) to the
control dispatcher - this is what lets spume drive its own real playback UI instead of running a
second, parallel playback engine just to answer remote commands.

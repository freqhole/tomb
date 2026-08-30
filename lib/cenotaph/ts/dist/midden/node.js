// midden/iroh node bootstrap helpers shared by every host app that embeds
// cenotaph: the dedicated pairing/control ALPN constant, and the ALPN
// midden registers on every node by default (the one spume's regular "add
// remote" flow probes for server info).
//
// this module does NOT create a node singleton itself - each host app
// already owns its own node lifecycle (player.freqhole.net's anonymous
// per-device identity vs spume's own already-existing midden node/identity
// singleton) and should keep doing so; extra_alpns just needs `PLAYER_ALPN`
// added to whichever `MiddenNodeOptions` the host already builds.
/** dedicated ALPN for player pairing (trust handshake) + control
 * (play/queue/etc) commands, separate from freqhole-admin/1 (which assumes
 * an already-trusted, full grimoire-admin relationship). */
export const PLAYER_ALPN = "freqhole-player/1";
/** midden registers this on every node by default (see
 * lib/midden/src/lib.rs) - it's the ALPN spume's regular "add remote" flow
 * probes for server info. */
export const FREQHOLE_ALPN = "freqhole/1";

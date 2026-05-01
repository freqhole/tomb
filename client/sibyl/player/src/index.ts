// public surface of @sibyl/player. this is the only file external
// consumers (the sibyl demo app, eventually freqhole's spume) should
// import from directly.
//
// design notes:
// - no `@tauri-apps/api` import anywhere in this package
// - no dom access; all dom lives in the demo app
// - all i/o is injected (transport, logger, ipc adapter)

export type { ChunkTransport, RequestOpts, ChunkHandler } from "./transport.js";
export type { CodecParams, ChunkRecord, Manifest, CachedSong } from "./types.js";
export { SibylPlayer } from "./player.js";
export type { SibylPlayerOpts, PlayerEvent } from "./player.js";
export { OpfsCache } from "./opfs-cache.js";
export { WebcodecsPlayer } from "./webcodecs-player.js";
export { RodioPlayer } from "./rodio-player.js";
export type { IpcInvoke, SibylRequest, SibylResponse } from "./ipc.js";
export {
  encodeTicket,
  decodeTicket,
  type SibylTicket,
} from "./ticket.js";

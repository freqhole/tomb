// framework-free flow state machines. each flow is a pure machine
// (send(event) -> effects) plus a bundled effect runner over injected
// deps; solid/pixi/react shells all drive the same machine. the ./solid
// subpath ships optional rendered components over these.

export {
  COMPLETE_DISMISS_MS,
  DISMISS_TIMER_ID,
  initialContext,
  projectState,
  transition,
} from "./add-peer/machine.js";
export type { AddPeerContext, TransitionResult } from "./add-peer/machine.js";
export { createAddPeerFlow } from "./add-peer/runner.js";
export type { AddPeerFlow } from "./add-peer/runner.js";
export type {
  AddPeerEffect,
  AddPeerEvent,
  AddPeerFlowDeps,
  AddPeerState,
  ConnectionOutcome,
  KnockStatusOutcome,
  PeerServerInfo,
  PeerTarget,
  PendingRemote,
  PendingRemoteStage,
  SavedRemote,
} from "./add-peer/types.js";

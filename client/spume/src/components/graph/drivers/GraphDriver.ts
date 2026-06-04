// graph driver abstraction. WalkCanvas talks to a `GraphDriver`,
// not to the worker client directly. the sole implementation today is
// `WalkerDriver` (re-exported as `createWalkerDriver`), which wraps the
// simulation worker and drives the library graph with breadcrumb /
// pivot / expand semantics.
//
// the interface is intentionally identical to the worker client's
// public surface — WalkCanvas's call sites already use the right shape.

import type { WalkerClient } from "../worker/client";
import { createWalkerClient } from "../worker/client";

export type GraphDriver = WalkerClient;
export type {
  TopologyListener,
  FrameListener,
  VisibleIdsListener,
} from "../worker/client";

export function createWalkerDriver(): GraphDriver {
  return createWalkerClient();
}

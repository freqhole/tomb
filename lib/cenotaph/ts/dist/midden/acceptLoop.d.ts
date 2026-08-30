import type { CenotaphAcceptableNode, CenotaphBiStream } from "./node";
export type AlpnHandler<TNode = unknown> = (node: TNode, stream: CenotaphBiStream) => void | Promise<void>;
/** start the inbound accept loop for `node`, dispatching by ALPN per
 * `handlers` (keyed by exact ALPN string, e.g. `PLAYER_ALPN`/`FREQHOLE_ALPN`
 * from `midden/node.ts`). safe to call once per node; no-ops on repeat
 * calls for the same node instance. */
export declare function startAcceptLoop<TNode extends CenotaphAcceptableNode>(node: TNode, handlers: Record<string, AlpnHandler<TNode>>): void;
//# sourceMappingURL=acceptLoop.d.ts.map
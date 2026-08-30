import type { CenotaphBiStream } from "../midden/node";
import type { PlayerStatus } from "./schema";
export declare function registerSubscriber(nodeId: string, stream: CenotaphBiStream): void;
export declare function unregisterSubscriber(nodeId: string, stream: CenotaphBiStream): void;
/** pushes a status update to every currently-subscribed controller stream.
 * a write failure just drops that stream from the registry - the accept
 * loop's own read side independently notices the close and cleans up too. */
export declare function broadcastStatus(status: PlayerStatus): void;
//# sourceMappingURL=statusSubscribers.d.ts.map
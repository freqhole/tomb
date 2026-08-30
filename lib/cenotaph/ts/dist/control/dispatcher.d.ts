import { type CommandAck } from "./schema";
import type { PlaybackBackend } from "./playbackBackend";
declare const commandInFlight: import("solid-js").Accessor<boolean>;
/** true while a command that would transition the player out of its idle/
 * qr-showing state is being processed - a host app's qr overlay can use
 * this for its loading state. */
export { commandInFlight };
export declare function dispatchCommand<TNode = unknown>(backend: PlaybackBackend<TNode>, node: TNode, rawLine: string): Promise<CommandAck>;
//# sourceMappingURL=dispatcher.d.ts.map
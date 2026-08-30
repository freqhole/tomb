import type { MediaPlaybackNode } from "./types";
import type { MediaRef } from "../control/schema";
export declare function fetchMediaBlob<TNode extends MediaPlaybackNode>(node: TNode, item: MediaRef, onProgress?: (fraction: number) => void): Promise<Blob>;
//# sourceMappingURL=mediaFetch.d.ts.map
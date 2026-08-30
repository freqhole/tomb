import type { MediaPlaybackNode } from "./types";
export type RadioState = "idle" | "connecting" | "live" | "error" | "unsupported";
export interface RadioNowPlaying {
    title: string;
    artist: string | null;
    album: string | null;
    duration_ms: number | null;
}
export declare const radioState: import("solid-js").Accessor<RadioState>;
export declare const radioNowPlaying: import("solid-js").Accessor<RadioNowPlaying | null>;
export declare const radioStationId: import("solid-js").Accessor<string | null>;
export declare const radioListenerCount: import("solid-js").Accessor<number | null>;
export declare const radioError: import("solid-js").Accessor<string | null>;
export declare const radioElement: HTMLAudioElement;
export declare function startRadio<TNode extends MediaPlaybackNode>(node: TNode, peerAddr: string, stationIdArg?: string): Promise<void>;
export declare function stopRadio(): void;
//# sourceMappingURL=radioClient.d.ts.map
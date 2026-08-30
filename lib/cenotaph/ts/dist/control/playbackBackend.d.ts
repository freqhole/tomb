import type { MediaRef, PlayerStatus } from "./schema";
export interface PlaybackBackend<TNode = unknown> {
    play(node: TNode, item: MediaRef): Promise<void>;
    replaceQueue(node: TNode, items: MediaRef[]): Promise<void>;
    appendQueue(node: TNode, items: MediaRef[]): Promise<void>;
    pause(): void;
    resume(): void;
    seek(positionMs: number): void;
    skip(node: TNode): Promise<void>;
    removeFromQueue(node: TNode, index: number): Promise<void>;
    reorderQueue(fromIndex: number, toIndex: number): void;
    setVolume(volume: number): void;
    stop(): void;
    startRadio(node: TNode, peerAddr: string, stationId?: string): Promise<void>;
    stopRadio(): void;
    setAutoDownloadEnabled(enabled: boolean): void;
    currentStatus(): PlayerStatus;
}
//# sourceMappingURL=playbackBackend.d.ts.map
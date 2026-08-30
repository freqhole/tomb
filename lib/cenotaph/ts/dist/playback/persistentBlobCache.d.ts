export declare function getCachedMediaBlob(blake3Hash: string): Promise<Blob | null>;
export declare function cacheMediaBlob(blake3Hash: string, blob: Blob): Promise<void>;
export declare function evictCachedMediaBlob(blake3Hash: string): Promise<void>;
//# sourceMappingURL=persistentBlobCache.d.ts.map
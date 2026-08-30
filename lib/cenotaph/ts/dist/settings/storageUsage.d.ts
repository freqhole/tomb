export interface StorageUsage {
    usageBytes: number;
    quotaBytes: number | null;
}
export declare function getStorageUsage(): Promise<StorageUsage>;
export declare function formatBytes(bytes: number): string;
//# sourceMappingURL=storageUsage.d.ts.map
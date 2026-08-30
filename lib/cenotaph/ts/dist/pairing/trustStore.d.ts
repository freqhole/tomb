export interface TrustedController {
    node_id: string;
    display_name: string;
    paired_at: number;
}
export interface TrustStore {
    isTrustedController(nodeId: string): Promise<boolean>;
    getTrustedController(nodeId: string): Promise<TrustedController | undefined>;
    trustController(nodeId: string, displayName: string): Promise<void>;
    forgetController(nodeId: string): Promise<void>;
    listTrustedControllers(): Promise<TrustedController[]>;
}
export interface IdbTrustStoreOptions {
    databaseName?: string;
    storeName?: string;
}
/** default trust store implementation: its own dedicated indexeddb
 * database. a host app that already has its own database to share should
 * implement `TrustStore` directly against that instead of using this. */
export declare function createIdbTrustStore(options?: IdbTrustStoreOptions): TrustStore;
//# sourceMappingURL=trustStore.d.ts.map
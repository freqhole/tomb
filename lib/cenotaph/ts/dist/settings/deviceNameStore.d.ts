export declare const DEFAULT_DISPLAY_NAME = "freqhole player";
/** current device display name (reactive - safe to call from a solid component). */
export declare const deviceName: import("solid-js").Accessor<string>;
/** load the persisted display name, if any, into the reactive signal. */
export declare function loadDeviceName(): Promise<void>;
/** persist a new display name - takes effect for the next pairing (existing
 * trusted controllers keep whatever display name they already recorded). */
export declare function setDeviceName(next: string): Promise<void>;
//# sourceMappingURL=deviceNameStore.d.ts.map
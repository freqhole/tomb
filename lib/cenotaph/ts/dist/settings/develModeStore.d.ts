declare const develMode: import("solid-js").Accessor<boolean>;
/** whether devel mode is currently on (reactive - safe to call from a solid component). */
export { develMode };
/** load the persisted devel-mode toggle, if any, into the reactive signal. */
export declare function loadDevelMode(): Promise<void>;
export declare function setDevelMode(next: boolean): Promise<void>;
//# sourceMappingURL=develModeStore.d.ts.map
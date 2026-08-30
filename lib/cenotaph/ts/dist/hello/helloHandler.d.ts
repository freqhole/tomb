export interface HelloInfo {
    name: string;
    description: string;
    version: string;
    image_url: string | null;
    image_blob_id: string | null;
    knocking_enabled: boolean;
    /** marks this peer as a player device (not a full remote-server
     * candidate) - lets spume's add-remote flow point the user at "pair a
     * player" instead of treating it as a dead-end remote-server candidate. */
    player_device?: boolean;
    /** advertises that this peer can also accept `freqhole-player/1`
     * pairing + control connections right now (e.g. spume's own opt-in
     * remote-playback-target toggle). */
    supports_remote_playback?: boolean;
}
export type HelloInfoProvider = () => HelloInfo | Promise<HelloInfo>;
export declare function createHelloRouteHandler(getInfo: HelloInfoProvider): () => Promise<{
    status: number;
    body: HelloInfo;
}>;
//# sourceMappingURL=helloHandler.d.ts.map
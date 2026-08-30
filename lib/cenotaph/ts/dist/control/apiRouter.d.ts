import type { CenotaphBiStream } from "../midden/node";
export interface ApiRouteHandler {
    (body: unknown): Promise<{
        status: number;
        body: unknown;
    }> | {
        status: number;
        body: unknown;
    };
}
export interface ApiRouter {
    registerRoute(method: string, path: string, handler: ApiRouteHandler): void;
    /** handle a single request/response round-trip on the `freqhole/1` ALPN. */
    dispatch(stream: CenotaphBiStream): Promise<void>;
}
export declare function createApiRouter(): ApiRouter;
//# sourceMappingURL=apiRouter.d.ts.map
export interface ConnectedController {
    node_id: string;
    display_name: string;
}
export declare const connectedControllers: import("solid-js").Accessor<ConnectedController[]>;
export declare function markControllerConnected(controller: ConnectedController): void;
export declare function markControllerDisconnected(nodeId: string): void;
//# sourceMappingURL=connectedControllers.d.ts.map
export interface CapturedLogLine {
    level: "log" | "info" | "warn" | "error" | "debug";
    text: string;
    at: number;
}
export declare const capturedLogLines: import("solid-js").Accessor<CapturedLogLine[]>;
/** monkey-patches console.log/info/warn/error/debug to also capture into
 * the ring buffer above, in addition to their normal behavior - idempotent,
 * safe to call more than once (e.g. from multiple onMount hooks). */
export declare function installConsoleCapture(): void;
export declare function clearCapturedLogLines(): void;
//# sourceMappingURL=consoleCapture.d.ts.map
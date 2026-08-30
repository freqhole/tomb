/** call for any client command except `get_status`. */
export declare function markActivity(): void;
/** 0 (activity just happened) .. 1 (about to time out), or null once idle
 * for IDLE_TIMEOUT_MS - a host app's qr overlay maps this to spin speed and
 * hides the spinner entirely at null. */
export declare function activityRamp(): number | null;
//# sourceMappingURL=activityIndicator.d.ts.map
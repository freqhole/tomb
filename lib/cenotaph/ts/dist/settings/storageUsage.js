// local storage usage readout (settings view). uses the standard Storage
// API's estimate(), which reflects real usage across all of the origin's
// storage.
export async function getStorageUsage() {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
        return { usageBytes: 0, quotaBytes: null };
    }
    const estimate = await navigator.storage.estimate();
    return {
        usageBytes: estimate.usage ?? 0,
        quotaBytes: estimate.quota ?? null,
    };
}
export function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

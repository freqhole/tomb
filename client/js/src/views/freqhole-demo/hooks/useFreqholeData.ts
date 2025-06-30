import { createMemo } from "solid-js";
import type { FilterConfig } from "../types";
import type { MediaBlob } from "../../../lib/websocket-types";
import { getDisplayFilename } from "../../../lib/media-utils";

export interface UseFreqholeDataProps {
  items: () => MediaBlob[];
  filterConfig: () => FilterConfig;
  sortConfig: () => { field: string; direction: string };
}

export function useFreqholeData(props: UseFreqholeDataProps) {
  // Combined processing in a single memo to avoid circular dependencies
  const processedData = createMemo(() => {
    const filterConfig = props.filterConfig();
    const sortConfig = props.sortConfig();

    // First filter the data
    const filtered = props.items().filter((item) => {
      // Name filter
      if (
        filterConfig.name &&
        !getDisplayFilename(item)
          .toLowerCase()
          .includes(filterConfig.name.toLowerCase())
      ) {
        return false;
      }

      // MIME type filter - support both exact match and prefix match for content types
      if (filterConfig.mime) {
        if (!item.mime) {
          return false;
        }
        // If the filter is a content type like "audio", "video", etc., use prefix matching
        // Otherwise use exact matching
        const isContentType = !filterConfig.mime.includes("/");
        if (isContentType) {
          if (
            !item.mime
              .toLowerCase()
              .startsWith(filterConfig.mime.toLowerCase() + "/")
          ) {
            return false;
          }
        } else {
          if (item.mime !== filterConfig.mime) {
            return false;
          }
        }
      }

      // Blob type filter
      if (filterConfig.blobType && item.blob_type !== filterConfig.blobType) {
        return false;
      }

      // Size range filter
      if (
        item.size &&
        (item.size < filterConfig.minSize || item.size > filterConfig.maxSize)
      ) {
        return false;
      }

      // Parent blob filter
      if (filterConfig.hasParent === "yes" && !item.parent_blob_id) {
        return false;
      }
      if (filterConfig.hasParent === "no" && item.parent_blob_id) {
        return false;
      }

      // Local path filter
      if (filterConfig.hasLocalPath === "yes" && !item.local_path) {
        return false;
      }
      if (filterConfig.hasLocalPath === "no" && item.local_path) {
        return false;
      }

      return true;
    });

    // Then sort the filtered data
    if (!sortConfig.field) {
      return { filtered, sorted: filtered };
    }

    const sorted = [...filtered].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      // Special handling for the name field
      if (sortConfig.field === "name") {
        aVal = getDisplayFilename(a);
        bVal = getDisplayFilename(b);
      } else {
        aVal = a[sortConfig.field as keyof MediaBlob];
        bVal = b[sortConfig.field as keyof MediaBlob];
      }

      // Handle null/undefined values - put them at the end
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return sortConfig.direction === "desc" ? -1 : 1;
      if (bVal == null) return sortConfig.direction === "desc" ? 1 : -1;

      // Handle different data types
      if (aVal instanceof Date && bVal instanceof Date) {
        aVal = aVal.getTime();
        bVal = bVal.getTime();
      } else if (
        sortConfig.field === "created_at" ||
        sortConfig.field === "updated_at"
      ) {
        // Handle date strings specifically with robust parsing
        if (aVal && typeof aVal === "string") {
          const parsedA = new Date(aVal);
          aVal = isNaN(parsedA.getTime()) ? 0 : parsedA.getTime();
        } else {
          aVal = 0; // Treat null/undefined as earliest date
        }

        if (bVal && typeof bVal === "string") {
          const parsedB = new Date(bVal);
          bVal = isNaN(parsedB.getTime()) ? 0 : parsedB.getTime();
        } else {
          bVal = 0; // Treat null/undefined as earliest date
        }
      } else if (typeof aVal === "string" && typeof bVal === "string") {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      } else if (typeof aVal === "number" && typeof bVal === "number") {
        // Numbers are already comparable
      } else {
        // Convert to strings for comparison
        aVal = String(aVal || "").toLowerCase();
        bVal = String(bVal || "").toLowerCase();
      }

      let result = 0;
      if (aVal < bVal) result = -1;
      else if (aVal > bVal) result = 1;

      return sortConfig.direction === "desc" ? -result : result;
    });

    return { filtered, sorted };
  });

  // Expose separate accessors for filtered and sorted data
  const filteredData = createMemo(() => processedData().filtered);
  const sortedData = createMemo(() => processedData().sorted);

  // Derive MIME categories from current data
  const mimeCategories = createMemo(() => {
    return [
      ...new Set(
        props
          .items()
          .map((item) => item.mime?.split("/")[0])
          .filter(Boolean)
      ),
    ].sort() as string[];
  });

  // Derive blob types from current data
  const blobTypes = createMemo(() => {
    const unique = [
      ...new Set(props.items().map((item) => item.blob_type)),
    ].filter(Boolean);
    return unique.sort() as string[];
  });

  // Statistics
  const stats = createMemo(() => ({
    totalCount: props.items().length,
    filteredCount: filteredData().length,
    hiddenCount: props.items().length - filteredData().length,
  }));

  return {
    // Processed data
    filteredData,
    sortedData,

    // Derived categories
    mimeCategories,
    blobTypes,

    // Statistics
    stats,
  };
}

export default useFreqholeData;

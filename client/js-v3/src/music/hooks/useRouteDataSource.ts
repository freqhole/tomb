// hook to detect route context (local vs remote)
// only used for determining URL prefixes for navigation
// actual data source switching is handled by App.tsx on initial load

import { useParams } from "@solidjs/router";
import { getCurrentRemote } from "../data";

export function useRouteDataSource() {
  const params = useParams<{ remoteId?: string }>();

  return {
    isLocal: () => {
      // if no remoteId in route, check current data source
      if (!params.remoteId) {
        return !getCurrentRemote();
      }
      return params.remoteId === "local";
    },
    remoteId: () => {
      // if no remoteId in route, use current remote's id
      if (!params.remoteId) {
        const remote = getCurrentRemote();
        return remote?.remote_id || "local";
      }
      return params.remoteId;
    },
  };
}

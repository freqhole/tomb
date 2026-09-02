// remote lifecycle handlers (switch/recheck/delete/rename) used by AppLayout's
// TopNav wiring - extracted so AppLayout.tsx doesn't have to carry every
// remote connect/disconnect/rename/delete code path inline.
import type { Navigator } from "@solidjs/router";
import type { QueryClient } from "@tanstack/solid-query";
import { useLocalSource } from "../../../music/data";
import { getDefaultRoute } from "../../../music/utils/routing";
import { preCacheRemoteTransport } from "../../../music/services/storage/blobResolver";
import { clearBlobCache } from "../../../music/services/cache/blobCache";
import { toast } from "../../../components/feedback/Toast";
import { debug } from "../../../utils/logger";
import { connectToRemote, recheckRemote } from "./connectionProgress";
import { getAllRemotes, getRemoteById, deleteRemote, updateRemote } from "./remoteManager";
import { initAppDB } from "../storage/db";
import { STORE_QUEUE_HISTORY, type QueueHistoryEntry, type Remote } from "../storage/types";
import { isCharnelMode, updateServerInfo } from "../charnel";

export interface RemoteSwitchingDeps {
  navigate: Navigator;
  queryClient: QueryClient;
  setRemotes: (remotes: Remote[]) => void;
}

export function createRemoteSwitchingHandlers(deps: RemoteSwitchingDeps) {
  const { navigate, queryClient, setRemotes } = deps;

  const refreshRemotes = async () => {
    const allRemotes = await getAllRemotes();
    setRemotes(allRemotes);
    return allRemotes;
  };

  // handle switching to local source
  const handleSwitchToLocal = async () => {
    try {
      debug("AppLayout", "switching to local source...");
      // switch data source first
      await useLocalSource();
      // navigate to local route
      navigate(getDefaultRoute("local"));
      // invalidate all queries to refetch from local source
      queryClient.invalidateQueries();
      debug("AppLayout", "switched to local source");
    } catch (error) {
      console.error("failed to switch to local:", error);
    }
  };

  // handle switching to remote source (from TopNav)
  const handleSwitchToRemote = async (remoteId: string) => {
    try {
      debug("AppLayout", `switching to remote: ${remoteId}...`);

      // pre-cache transport type for blob resolution (avoids flicker on image load)
      await preCacheRemoteTransport(remoteId);

      // connect with progress modal support
      const result = await connectToRemote(remoteId);

      if (result.cancelled) {
        debug("AppLayout", "connection cancelled by user");
        return;
      }

      if (!result.success) {
        debug("AppLayout", `remote ${remoteId} is offline, not switching`);
        // refresh remotes list to show updated status
        await refreshRemotes();
        return;
      }

      // navigate to remote route
      navigate(getDefaultRoute(remoteId));
      // invalidate all queries to refetch from remote source
      queryClient.invalidateQueries();

      // refresh remotes list to show updated status
      await refreshRemotes();

      debug("AppLayout", `switched to remote: ${remoteId}`);
    } catch (error) {
      console.error("failed to switch to remote:", error);
    }
  };

  // handle rechecking a remote's status (with progress modal)
  const handleRecheckRemote = async (remoteId: string): Promise<boolean> => {
    try {
      debug("AppLayout", `rechecking remote: ${remoteId}...`);

      const isOnline = await recheckRemote(remoteId);

      // refresh remotes list to update UI
      await refreshRemotes();

      debug("AppLayout", `remote ${remoteId} recheck result: ${isOnline ? "online" : "offline"}`);
      return isOnline;
    } catch (error) {
      console.error("failed to recheck remote:", error);
      return false;
    }
  };

  // handle deleting a remote (called from topnav context menu)
  // topnav already handles user confirmation; here we just perform cleanup
  const handleDeleteRemote = async (remoteId: string): Promise<void> => {
    try {
      debug("AppLayout", `deleting remote: ${remoteId}...`);

      // clear queue history entries for this remote
      try {
        const db = await initAppDB();
        const allEntries = await db.getAll(STORE_QUEUE_HISTORY);
        const toDelete = (allEntries as QueueHistoryEntry[]).filter(
          (e) => e.server_remote_id === remoteId
        );
        for (const entry of toDelete) {
          await db.delete(STORE_QUEUE_HISTORY, entry.id);
        }
      } catch (e) {
        debug("AppLayout", "failed to clear queue history:", e);
      }

      // clear cached blobs for this remote
      try {
        await clearBlobCache(remoteId);
      } catch (e) {
        debug("AppLayout", "failed to clear blob cache:", e);
      }

      // delete the remote record
      await deleteRemote(remoteId);

      // refresh remotes list
      await refreshRemotes();

      toast.success("remote deleted");
    } catch (error) {
      console.error("failed to delete remote:", error);
      toast.error("failed to delete remote");
    }
  };

  // handle renaming a remote (called from topnav context menu).
  // rename is only offered for "local library" remotes in topnav:
  //   - web: synthetic row, routed through onRenameLocalLibrary (not here)
  //   - charnel (android/desktop): the is_charnel_managed sqlite row;
  //     its name lives in the freqhole config toml and gets re-seeded on
  //     every startup by `upsertTauriRemote(config.server_name)`. so for
  //     these we also update server.name in the config to make the
  //     rename survive a restart.
  const handleRenameRemote = async (remoteId: string, newName: string): Promise<void> => {
    try {
      await updateRemote(remoteId, { name: newName });
      if (isCharnelMode()) {
        const target = await getRemoteById(remoteId);
        if (target?.is_charnel_managed) {
          try {
            await updateServerInfo({ name: newName });
          } catch (err) {
            console.error("failed to persist server.name to charnel config:", err);
            // re-throw so the modal surfaces the failure; the IDB write
            // above will be undone on next startup anyway when charnel
            // re-seeds from the (un-updated) toml.
            throw err;
          }
        }
      }
      await refreshRemotes();
      toast.success("remote renamed");
    } catch (error) {
      console.error("failed to rename remote:", error);
      toast.error("failed to rename remote");
      throw error;
    }
  };

  return {
    handleSwitchToLocal,
    handleSwitchToRemote,
    handleRecheckRemote,
    handleDeleteRemote,
    handleRenameRemote,
  };
}

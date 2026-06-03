// startup task: re-check every pending remote stuck in `knock_pending` to
// see if the admin approved it while spume was closed, and finish the
// add-remote flow (createRemote + delete pending) automatically.
//
// mirrors the manual `handleRetryKnock` flow in AddRemoteModal.tsx, but
// runs unattended on app boot.
import { toast } from "../../../components/feedback/Toast";
import { getClientForRemote, isCharnelAvailable } from "../../api/client";
import {
  deletePendingRemote,
  getAllPendingRemotes,
  updatePendingRemote,
} from "../storage/db";
import type { PendingRemote } from "../storage/types";
import { createRemote } from "./remoteManager";

async function checkOne(pending: PendingRemote): Promise<void> {
  try {
    const client = await getClientForRemote({
      peer_addr: pending.peer_addr,
      transport_type: isCharnelAvailable() ? "app" : "wasm",
    });

    const statusResult = await client.admin.getKnockStatusPublic();
    if (!statusResult.success || !statusResult.data) return;

    const status = statusResult.data.status;

    if (status === "accepted") {
      try {
        const remote = await createRemote({ peer_addr: pending.peer_addr });
        await deletePendingRemote(pending.id);
        console.log(
          "[pendingKnockChecker] promoted approved knock to remote:",
          remote.name,
        );
        toast.success(`access granted - ${remote.name} added`);
      } catch (err) {
        // createRemote can fail (e.g. duplicate) - mark accepted so the
        // user can finish manually from the modal.
        console.warn(
          "[pendingKnockChecker] createRemote failed for approved knock:",
          err,
        );
        await updatePendingRemote(pending.id, { stage: "knock_accepted" });
      }
      return;
    }

    if (status === "rejected") {
      await updatePendingRemote(pending.id, { stage: "knock_rejected" });
      return;
    }

    // still pending - leave as-is
  } catch (err) {
    // peer offline / unreachable - leave as-is, try again next boot
    console.debug(
      "[pendingKnockChecker] failed to check pending knock for",
      pending.peer_addr.slice(0, 16) + "...",
      err,
    );
  }
}

export async function checkPendingKnockApprovals(): Promise<void> {
  try {
    const all = await getAllPendingRemotes();
    const candidates = all.filter((p) => p.stage === "knock_pending");
    if (candidates.length === 0) return;

    console.log(
      "[pendingKnockChecker] checking",
      candidates.length,
      "pending knock(s) for approval",
    );
    await Promise.all(candidates.map(checkOne));
  } catch (err) {
    console.debug("[pendingKnockChecker] failed:", err);
  }
}

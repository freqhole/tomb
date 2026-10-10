// repair library images - whole-library maintenance job (admin only).
//
// wraps the `RepairLibraryImages` job chain (backfill missing song
// waveforms / album thumbnails + clean up directory-sourced images that
// got over-applied across unrelated albums) in an enqueue-and-await flow
// with toast feedback. the server runs this as a chain of small batch
// jobs rather than one long one (so it stays cancelable/restartable) -
// each batch's result carries the running totals forward and names the
// next batch's job id, so this just chases that chain via
// `waitForJobResult` until a batch reports `done: true`.

import type { RepairLibraryImagesJobResult } from "@freqhole/api-client";
import { getClientForRemote, type RemoteRef } from "../../app/api/client";
import { waitForJobResult } from "../../app/services/jobs/jobService";
import { toast } from "../../components/feedback/Toast";

// generous per-batch timeout - each batch is small (one waveform batch or
// one directory batch), but a directory batch can involve several ffmpeg
// calls, so give it real headroom rather than timing out a healthy batch.
const BATCH_TIMEOUT_MS = 2 * 60 * 1000;
// safety cap on how many batches this will chase before giving up -
// avoids an unbounded client-side loop if something is wrong server-side.
const MAX_BATCHES = 5000;

function summarize(result: RepairLibraryImagesJobResult["totals"], dryRun: boolean): string {
  const verb = dryRun ? "would backfill" : "backfilled";
  const removeVerb = dryRun ? "would remove" : "removed";
  return (
    `${verb} ${result.songs_waveforms_backfilled} waveform(s), ` +
    `${result.albums_thumbnails_backfilled} thumbnail(s); ${removeVerb} ` +
    `${result.albums_thumbnails_removed_overapplied} over-applied image(s); ` +
    `${result.albums_left_ambiguous} album(s) left ambiguous`
  );
}

/**
 * enqueue a `RepairLibraryImages` job chain on `remote` and show toast
 * feedback as it starts and completes. resolves once the chain is done
 * (or a batch fails/times out) - callers that just want "fire and forget
 * with feedback" don't need to await it.
 */
export async function runRepairLibraryImages(
  remote: RemoteRef,
  opts: { dryRun?: boolean } = {}
): Promise<void> {
  const dryRun = opts.dryRun ?? false;

  let client;
  try {
    client = await getClientForRemote(remote);
  } catch (e) {
    toast.error(`failed to reach remote: ${(e as Error).message}`, { title: "repair library" });
    return;
  }

  const resp = await client.music.enqueueRepairLibraryImages({
    dry_run: dryRun,
    options: {
      backfill_waveforms: true,
      backfill_embedded_art: true,
      backfill_directory_art: true,
      remove_overapplied: false,
    },
  });
  if (!resp.success) {
    toast.error(resp.error?.message ?? "failed to start library repair", {
      title: "repair library",
    });
    return;
  }

  toast.info(
    dryRun
      ? "checking library for missing/over-applied images..."
      : "repairing library images - this can take a while for large libraries",
    { title: "repair library" }
  );

  let jobId: string = resp.data.job_id;
  let batches = 0;
  while (batches < MAX_BATCHES) {
    batches += 1;
    const polled = await waitForJobResult<RepairLibraryImagesJobResult>(
      remote,
      jobId,
      BATCH_TIMEOUT_MS
    );

    if (polled.status !== "completed" || !polled.result) {
      toast.error(polled.errorMessage ?? "library repair did not complete", {
        title: "repair library",
      });
      return;
    }

    if (polled.result.done) {
      const summary = summarize(polled.result.totals, dryRun);
      if (polled.result.totals.errors.length > 0) {
        toast.warning(`${summary} (${polled.result.totals.errors.length} error(s))`, {
          title: "repair library",
          duration: 8000,
        });
      } else {
        toast.success(summary, { title: "repair library", duration: 6000 });
      }
      return;
    }

    if (!polled.result.next_job_id) {
      // shouldn't happen (done=false implies a next batch was enqueued),
      // but don't loop forever on an inconsistent result.
      toast.warning("library repair stopped unexpectedly (no next batch)", {
        title: "repair library",
      });
      return;
    }
    jobId = polled.result.next_job_id;
  }

  toast.warning("library repair is taking unusually long - check the jobs list", {
    title: "repair library",
  });
}

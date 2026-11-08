import { getTauriManagedRemote } from "../remotes/remoteManager";
import { addWaveformToQueuedMedia } from "../storage/db";
import type { MediaItem } from "../storage/mediaItem";

/** attach a waveform the local (charnel-managed) grimoire generated for a
 * synced song or video to its queued copies, so the playerbar and queue rows
 * pick it up. the waveform lives in the local grimoire, so the image ref
 * points at the charnel self-remote rather than the media's source remote.
 * no-op outside charnel mode. */
export async function applyWaveform(
  kind: MediaItem["kind"],
  blake3: string,
  waveformBlobId: string
): Promise<void> {
  const self = await getTauriManagedRemote();
  if (!self?.remote_id) return;
  await addWaveformToQueuedMedia(kind, blake3, waveformBlobId, self.remote_id);
}

import { setCurrentSong, setQueue } from "../../../app/services/storage/db";
import { clearPendingUpNext } from "../audio/playerState";
import { stopTracking } from "./listenProgress";
import { stopVideoTracking } from "../../../video/services/queue/videoListenProgress";
import { clearAllQueueProgress } from "./queueProgress";
import { stopServerSession } from "./serverSession";

// shared state cleanup without player commands or radio/controller side effects.
export async function clearQueueState(reason: "abandoned" | "completed"): Promise<void> {
  stopTracking(true);
  stopVideoTracking(true);
  clearAllQueueProgress();
  clearPendingUpNext();
  void stopServerSession(reason);
  await setCurrentSong(null);
  await setQueue([]);
}

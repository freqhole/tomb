import { useGlobalEvents } from "./useGlobalEvents";
import type { Song } from "../../../lib/music/schemas/song";

export function useMusicBrainzModal() {
  const events = useGlobalEvents();

  const open = (songsToProcess: Song[]) => {
    // redirect to songInfoModal which now includes musicbrainz functionality
    events.emit("modal:open", {
      modal: "songInfoModal",
      data: { songs: songsToProcess },
    });
  };

  const close = () => {
    events.emit("modal:close", { modal: "songInfoModal" });
  };

  return {
    open,
    close,
  };
}

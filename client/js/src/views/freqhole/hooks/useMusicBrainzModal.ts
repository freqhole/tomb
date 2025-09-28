import { createSignal, onMount } from "solid-js";
import { useGlobalEvents } from "./useGlobalEvents";
import type { Song } from "../../../lib/music/schemas/song";

export function useMusicBrainzModal() {
  const events = useGlobalEvents();
  const [isOpen, setIsOpen] = createSignal(false);
  const [songs, setSongs] = createSignal<Song[]>([]);

  // listen for modal open events
  onMount(() => {
    events.on("musicbrainz-modal:open", (data) => {
      setSongs(data.songs);
      setIsOpen(true);
    });

    events.on("musicbrainz-modal:close", () => {
      setIsOpen(false);
      setSongs([]);
    });
  });

  const open = (songsToProcess: Song[]) => {
    events.emit("musicbrainz-modal:open", { songs: songsToProcess });
  };

  const close = () => {
    events.emit("musicbrainz-modal:close", {});
  };

  return {
    isOpen,
    songs,
    open,
    close,
  };
}

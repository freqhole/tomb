import { Show } from "solid-js";
import { LastFmReviewModal } from "../../components/LastFmReviewModal";
import { AudioDbReviewModal } from "../../components/AudioDbReviewModal";
import type { Remote } from "../../../app/services/storage/schemas/remote";

export interface PeekAlbum {
  album_id: string;
  title: string;
  artist_id: string | null;
  artist_name: string;
  metadata: string | null;
}

export function RawDataPeekModals(props: {
  album: PeekAlbum | null | undefined;
  remote: Remote;
  isAdmin: boolean;
  showLastFm: boolean;
  showAudioDb: boolean;
  onCloseLastFm: () => void;
  onCloseAudioDb: () => void;
}) {
  const albumShim = () => {
    const a = props.album;
    if (!a) return null;
    return {
      album_id: a.album_id,
      title: a.title,
      artist_id: a.artist_id ?? "",
      artist_name: a.artist_name ?? "",
      album_type: "",
      song_count: 0,
      total_duration: 0,
      metadata: a.metadata ?? null,
    };
  };
  return (
    <>
      <Show when={props.showLastFm && albumShim()}>
        <LastFmReviewModal
          isOpen={true}
          onClose={props.onCloseLastFm}
          album={albumShim() as any}
          remote={props.remote}
          isAdmin={props.isAdmin}
        />
      </Show>
      <Show when={props.showAudioDb && albumShim()}>
        <AudioDbReviewModal
          isOpen={true}
          onClose={props.onCloseAudioDb}
          album={albumShim() as any}
          remote={props.remote}
          isAdmin={props.isAdmin}
        />
      </Show>
    </>
  );
}

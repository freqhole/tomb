// shared share-modal types.
//
// `ShareTarget` describes the entity being shared. it intentionally carries
// only what the modal needs to render and to construct outbound payloads —
// not the full domain object. callers compute it once and pass it in.

export type ShareTargetKind = "album" | "playlist" | "song" | "artist";

export interface ShareTarget {
  kind: ShareTargetKind;
  /** entity id on the source remote (album_id / playlist_id / song_id / artist_id). */
  id: string;
  /** user-facing label for headers and toasts. */
  displayTitle: string;
}

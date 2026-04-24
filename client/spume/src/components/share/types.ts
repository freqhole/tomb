// shared share-modal types.
//
// `ShareTarget` describes the entity being shared. it intentionally carries
// only what the modal needs to render and to construct outbound payloads —
// not the full domain object. callers compute it once and pass it in.

export type ShareTargetKind = "album" | "playlist" | "song" | "artist" | "radio_station";

export interface ShareTarget {
  kind: ShareTargetKind;
  /** entity id on the source remote (album_id / playlist_id / song_id / artist_id). */
  id: string;
  /** user-facing label for headers and toasts. */
  displayTitle: string;
  /**
   * optional parent entity id used by the resolver to land on a useful page.
   * for `kind: "song"` this should be the album id so the recipient sees the
   * album view with the song row highlighted (no song-detail route exists).
   */
  parentId?: string;
}

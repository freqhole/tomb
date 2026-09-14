// local-idb `ReviewBackend` adapter - thin wrapper over
// music/services/storage/db/importReview.ts's already-existing CRUD, just
// giving it the same shape grimoireReviewBackend.ts exposes so
// useImportReview.ts / AddMediaModal.tsx can consume either through one
// interface (see reviewBackend.ts).
import type { PendingReviewSession } from "@freqhole/api-client";
import {
  getLocalImportSession,
  getLocalSessionAlbums,
  listLocalPendingSessions,
  markLocalAlbumReviewed,
  mergeLocalAlbums,
  moveLocalSong,
  patchLocalAlbum,
} from "../storage/db/importReview";
import type { ReviewBackend, ReviewSendTarget } from "./reviewBackend";

export function createLocalIdbReviewBackend(): ReviewBackend {
  return {
    kind: "local-idb",
    remote: null,

    async listPendingSessions(): Promise<PendingReviewSession[]> {
      const sessions = await listLocalPendingSessions();
      return Promise.all(
        sessions.map(async (s): Promise<PendingReviewSession> => {
          const albums = await getLocalSessionAlbums(s.session_id);
          return {
            session_id: s.session_id,
            created_at: Math.floor(s.created_at / 1000),
            uploader_username: null,
            albums: albums.map((a) => ({
              album_id: a.id,
              title: a.title,
              artist_id: a.artistId ?? null,
              artist_name: a.artist ?? null,
              artwork_blob_id: a.artworkBlobId ?? null,
              song_count: a.songs.length,
              pending_blob_count: a.songs.length,
            })),
            target_remote_id: s.target_remote_id,
            target_remote_name: s.target_remote_name,
          };
        })
      );
    },

    getSessionAlbums(sessionId) {
      return getLocalSessionAlbums(sessionId);
    },

    async getSessionTarget(sessionId): Promise<ReviewSendTarget | null> {
      const session = await getLocalImportSession(sessionId);
      if (!session?.target_remote_id || !session.target_remote_name) return null;
      return { id: session.target_remote_id, name: session.target_remote_name };
    },

    async patchAlbum(_sessionId, albumId, req) {
      await patchLocalAlbum(albumId, {
        title: req.title,
        artistId: req.artist_id,
        artistName: req.artist_name,
        albumType: req.album_type,
        releaseDate: req.release_date,
        label: req.label,
        songs: req.songs?.map((s) => ({
          songId: s.song_id,
          title: s.title,
          trackNumber: s.track_number,
          discNumber: s.disc_number,
          trackArtist: s.track_artist,
        })),
      });
    },

    async mergeAlbums(_sessionId, sourceIds, targetId) {
      await mergeLocalAlbums(sourceIds, targetId);
    },

    async moveSong(_sessionId, songId, toAlbumId, newAlbumTitle = null, newAlbumArtistName = null) {
      await moveLocalSong(songId, toAlbumId, newAlbumTitle, newAlbumArtistName);
    },

    async markAlbumReviewed(sessionId, albumId) {
      await markLocalAlbumReviewed(sessionId, albumId);
    },

    async markSessionReviewed(session) {
      for (const album of session.albums) {
        await markLocalAlbumReviewed(session.session_id, album.album_id);
      }
    },
  };
}

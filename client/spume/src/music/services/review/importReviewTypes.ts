// import-review domain types (ImportReviewAlbum/ImportReviewSong) - split out
// of ImportGroupingView.tsx (a UI component) so storage/service-layer code
// (importReview.ts, reviewBackend.ts, grimoireReviewBackend.ts,
// localIdbReviewBackend.ts) never has to import from a component file just
// to get a type - that direction-of-dependency was also what completed a
// (mostly type-only, but still fragile) import cycle back through
// MediaImage.tsx/blobResolver.ts. ImportGroupingView.tsx re-exports these
// for backward compatibility with existing call sites.
import type { ImageMetadata } from "../storage/types";

export interface ImportReviewSong {
  id: string;
  title: string;
  trackNumber?: number | null;
  discNumber?: number | null;
  durationSeconds?: number | null;
}

export interface ImportReviewAlbum {
  id: string;
  title: string;
  artist?: string | null;
  artistId?: string | null;
  artworkUrl?: string | null;
  /** local or remote blob id for the primary artwork - used by MediaImage */
  artworkBlobId?: string | null;
  /** remote server id (peer_addr for P2P, remote_id for HTTP) - used by MediaImage */
  remoteServerId?: string | null;
  /** entity URLs fetched from the album record */
  entityUrls?: { id?: string; name?: string | null; url: string }[];
  /** all images from the album record - used for image management in the editor */
  images?: ImageMetadata[];
  releaseDate?: string | null;
  label?: string | null;
  genres?: string[];
  albumType?: string | null;
  songs: ImportReviewSong[];
}

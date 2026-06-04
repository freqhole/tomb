// thin modal wrapper around `EnrichmentReviewPanel` for the last.fm
// raw-data peek surface used by the bulk enrichment review modal.
// the body lives in EnrichmentReviewPanel so the single-album editor
// modal can embed the same ui inline without nesting modals.

import { Modal } from "../../components/modals/Modal";
import type { Remote } from "../../app/services/storage/schemas/remote";
import type { AlbumSummary } from "../../music/data/types";
import { EnrichmentReviewPanel } from "./EnrichmentReviewPanel";

interface LastFmReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  album: AlbumSummary;
  remote: Remote;
  /** when false, the fetch/refetch button is disabled. non-admins can
   *  still open the modal to read the stored snapshot read-only. */
  isAdmin: boolean;
}

export function LastFmReviewModal(props: LastFmReviewModalProps) {
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={`last.fm — ${props.album.title}`}
      size="xl"
    >
      <div class="p-4">
        <EnrichmentReviewPanel
          source="lastfm"
          albumId={props.album.album_id}
          metadataRaw={props.album.metadata ?? null}
          remote={props.remote}
          isAdmin={props.isAdmin}
        />
      </div>
    </Modal>
  );
}

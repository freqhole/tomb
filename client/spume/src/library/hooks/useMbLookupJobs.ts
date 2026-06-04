// in-flight album-enrichment job tracker.
//
// scope: module-level signals so the LibraryView (header progress strip),
// the AlbumsTable rows (per-row pulse with per-source dots), and the bulk
// action bar can all share state without prop-drilling.
//
// sources: musicbrainz album-search (mb), last.fm album-detail (lastfm),
// theaudiodb album-detail (audiodb). a single click in "lookup all
// matching" or "enrich N selected" fans out to all three endpoints in
// parallel, registers each returned job_id under a `${source}:${album_id}`
// key, and the polling loop walks all in-flight jobs for the remote
// regardless of source.
//
// implementation is split across ./useMbLookupJobs/*; this file re-exports
// the public surface so existing import paths keep working.

export type {
  EnrichmentSource,
  InflightEntry,
  SourceCounts,
  MbSessionState,
} from "./useMbLookupJobs/types";
export { ENRICHMENT_SOURCES } from "./useMbLookupJobs/types";

export {
  getInflightJobs,
  isAlbumLookupRunning,
  getInflightSourcesForAlbum,
  getInflightJobForAlbum,
  useInflightJobs,
  getJobProgressMessage,
  useJobProgressMessages,
  registerInflightJob,
  rehydrateInflightForRemote,
} from "./useMbLookupJobs/inflight";

export { useMbSession, dismissMbSession } from "./useMbLookupJobs/session";

export { enqueueAlbumEnrichment } from "./useMbLookupJobs/enqueue";

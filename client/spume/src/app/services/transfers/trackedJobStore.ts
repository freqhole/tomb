// generic reactive job-list store, factored out of music/import/
// remoteImport.ts and video/import/remoteImport.ts - both files had their
// own hand-rolled `createStore<Job[]>` + id counter + `filter`/`produce`
// boilerplate around an otherwise IDENTICAL mechanism (add a row, patch it
// in place by id, remove one, clear completed/all). that mechanical part
// is what this factory extracts; each domain keeps its OWN richer job
// shape (music's albumId/artistId/songId vs video's videoId/warning/
// isRemoteSend etc.) rather than being forced into one artificial shared
// type - the two domains' resolved-entity shapes are genuinely different,
// and flattening them into a generic bag would lose real type safety at
// call sites for no real benefit.
//
// deliberately NOT built on `createTransferQueue` (bucket B) - that
// primitive assumes a FIXED list of items known up front, driven by one
// `sendOne` callback per item. these job lists are the opposite: rows are
// added one at a time, indefinitely, by several independent callers
// (`uploadFilesToRemote`, `uploadPathsToRemote`, `fetchUrlsOnRemote`,
// `sendReviewedSessionToRemote.ts`, ...) over the lifetime of an app
// session, then imperatively patched piecemeal from deep inside long,
// multi-step async functions (upload -> poll -> resolve entities) - not a
// single result returned from one call. see
// docs/transfer-unification-plan.md's phase 3b section for the fuller
// reasoning behind this design split.

import { createStore, produce } from "solid-js/store";

export interface TrackedJobCore {
  id: string;
  status: string;
}

export interface TrackedJobStore<TJob extends TrackedJobCore> {
  /** reactive job list (solid store - read inside a tracking scope). */
  getJobs(): TJob[];
  /** add a new row. */
  addJob(job: TJob): void;
  /** patch a row in place by id - no-op if the id isn't present (e.g. it
   *  was already removed/cleared). accepts a plain partial object or a
   *  `produce`-style mutator for patches that need to read the existing
   *  value first (e.g. appending to an array field). */
  updateJob(id: string, patch: Partial<TJob> | ((job: TJob) => void)): void;
  /** remove a single row (e.g. dismissing a failed one). */
  removeJob(id: string): void;
  /** remove every row matching `predicate` (e.g. `(j) => j.status ===
   *  "completed"`, called when a modal closes). */
  clearJobsWhere(predicate: (job: TJob) => boolean): void;
  /** remove every row. */
  clearAllJobs(): void;
  /** generate the next client-side id for this store, e.g. `nextId("upload")
   *  -> "upload-1"`, `"upload-2"`, ... - one counter per store instance. */
  nextId(prefix: string): string;
}

/** create a fresh, independent job-list store instance - call this ONCE
 *  per domain (music, video, ...) at module scope, same as the
 *  `createStore` calls it replaces. */
export function createTrackedJobStore<TJob extends TrackedJobCore>(): TrackedJobStore<TJob> {
  const [jobs, setJobs] = createStore<TJob[]>([]);
  let counter = 1;

  return {
    getJobs: () => jobs,
    addJob: (job) => setJobs((prev) => [...prev, job]),
    updateJob: (id, patch) => {
      const mutate = typeof patch === "function" ? patch : (j: TJob) => Object.assign(j, patch);
      setJobs(
        (j) => j.id === id,
        produce((j: TJob) => mutate(j))
      );
    },
    removeJob: (id) => setJobs((prev) => prev.filter((j) => j.id !== id)),
    clearJobsWhere: (predicate) => setJobs((prev) => prev.filter((j) => !predicate(j))),
    clearAllJobs: () => setJobs([]),
    nextId: (prefix) => `${prefix}-${counter++}`,
  };
}

-- migration 093: claimed-path bookkeeping for the "reorganize library
-- files" maintenance job (maintenance::reorganize_library) - moves
-- randomly-named fetched music/video into a user-chosen directory under
-- a human-readable Artist/Album (or series/movie) layout.
--
-- structurally mirrors external_storage_claimed_pathz (migration 053),
-- generalized from "per removable device" to "per target root directory"
-- since this isn't a removable-storage sync concept at all - it's a
-- one-time (or re-run-to-resume) bulk reorganization of the main
-- library's own files. the PRIMARY KEY is this table's real safety net:
-- an `INSERT ... ON CONFLICT DO NOTHING` against it is how two different
-- songs that sanitize to the same path (e.g. both missing artist/album
-- tags) are guaranteed to never be assigned the same destination, even
-- when multiple job workers are claiming paths concurrently.
CREATE TABLE library_reorganize_claimed_pathz (
    target_root   TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    song_id       TEXT,
    video_id      TEXT,
    claimed_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (target_root, relative_path),
    CHECK (
        (song_id IS NOT NULL AND video_id IS NULL) OR
        (song_id IS NULL AND video_id IS NOT NULL)
    )
);

-- reverse lookups: "has this song/video already been assigned a path
-- under this target root" (used to resume a previous partial run - reuse
-- the existing claim instead of re-deriving/re-uniquifying a new one).
CREATE INDEX idx_library_reorganize_claimed_pathz_song
    ON library_reorganize_claimed_pathz(target_root, song_id);
CREATE INDEX idx_library_reorganize_claimed_pathz_video
    ON library_reorganize_claimed_pathz(target_root, video_id);

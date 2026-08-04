-- indexes to support sorting the local-files list (filez tab 2) by size or
-- filename without a full table sort each time. substring search (LIKE
-- '%...%') still requires a scan regardless - sqlite can't use a btree
-- index for mid-string matches.

CREATE INDEX blobz_size_idx ON blobz (size);
CREATE INDEX blobz_filename_idx ON blobz (filename);

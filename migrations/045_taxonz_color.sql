-- 045_taxonz_color.sql
--
-- adds an optional `color` column to `taxonz` so individual taxon
-- nodes (group-role nodes in the hierarchy editor) can carry their
-- own color rather than inheriting purely from the kind. leaf value
-- nodes leave this null and resolve to the kind color client-side.

ALTER TABLE taxonz ADD COLUMN color TEXT;

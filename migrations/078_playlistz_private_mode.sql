-- 078: add private mode to playlistz
--
-- when true, only the playlist's owner or an admin can see it at all (not
-- just edit it - unlike `collaborative`, this is a visibility restriction).
-- deliberately a NEW column, not a repurposed `is_public` - `is_public`
-- defaults to 0 for every existing playlist and is only ever enforced in
-- playlist search (see search/queries.rs, search/suggestions.rs), so
-- treating `!is_public` as "hide everywhere" would have suddenly hidden
-- every pre-existing playlist from every other member.
ALTER TABLE playlistz ADD COLUMN private INTEGER NOT NULL DEFAULT 0;

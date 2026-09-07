-- 077: add collaborative mode to playlistz
--
-- when true, any authenticated member (not just the owner or an admin) may
-- edit the playlist's song/item membership (add/remove/reorder) - renaming,
-- deleting, and toggling this flag itself remain owner-or-admin only.
ALTER TABLE playlistz ADD COLUMN collaborative INTEGER NOT NULL DEFAULT 0;

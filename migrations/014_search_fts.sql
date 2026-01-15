-- full-text search implementation using sqlite fts5
-- creates virtual tables, triggers, and indexes for search across all music entities

-- =============================================================================
-- FTS5 Virtual Tables
-- =============================================================================

-- songs fts with comprehensive field coverage
CREATE VIRTUAL TABLE IF NOT EXISTS songz_fts USING fts5(
    song_id UNINDEXED,
    title,
    artist_name,
    album_name,
    genre_name,
    sub_genre_names,
    filename,
    lyrics,
    metadata_text,
    tokenize = 'porter unicode61'
);

-- artists fts with genre associations
CREATE VIRTUAL TABLE IF NOT EXISTS artistz_fts USING fts5(
    artist_id UNINDEXED,
    name,
    genre_names,
    tokenize = 'porter unicode61'
);

-- albums fts with genre and sub-genre
CREATE VIRTUAL TABLE IF NOT EXISTS albumz_fts USING fts5(
    album_id UNINDEXED,
    title,
    artist_name,
    genre_name,
    sub_genre_names,
    tokenize = 'porter unicode61'
);

-- genres fts
CREATE VIRTUAL TABLE IF NOT EXISTS genrez_fts USING fts5(
    genre_id UNINDEXED,
    name,
    tokenize = 'porter unicode61'
);

-- sub-genres fts with parent genre
CREATE VIRTUAL TABLE IF NOT EXISTS sub_genrez_fts USING fts5(
    sub_genre_id UNINDEXED,
    name,
    parent_genre_name,
    tokenize = 'porter unicode61'
);

-- playlists fts
CREATE VIRTUAL TABLE IF NOT EXISTS playlistz_fts USING fts5(
    playlist_id UNINDEXED,
    title,
    description,
    tokenize = 'porter unicode61'
);

-- =============================================================================
-- Triggers for songz
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS songz_fts_insert AFTER INSERT ON songz
BEGIN
    INSERT INTO songz_fts(
        song_id,
        title,
        artist_name,
        album_name,
        genre_name,
        sub_genre_names,
        filename,
        lyrics,
        metadata_text
    )
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM artist_songz
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE artist_songz.song_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT album.title
            FROM album_songz
            JOIN albumz album ON album_songz.album_id = album.id
            WHERE album_songz.song_id = NEW.id AND album.deleted_at IS NULL
            LIMIT 1
        ), ''),
        COALESCE((
            SELECT genre.name
            FROM album_songz
            JOIN albumz album ON album_songz.album_id = album.id
            JOIN genrez genre ON album.genre_id = genre.id
            WHERE album_songz.song_id = NEW.id AND album.deleted_at IS NULL AND genre.deleted_at IS NULL
            LIMIT 1
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(sub_genre_name, ', ')
            FROM (
                SELECT DISTINCT sub_genre.name as sub_genre_name
                FROM album_songz
                JOIN album_sub_genrez ON album_songz.album_id = album_sub_genrez.album_id
                JOIN sub_genrez sub_genre ON album_sub_genrez.sub_genre_id = sub_genre.id
                WHERE album_songz.song_id = NEW.id AND sub_genre.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = NEW.media_blob_id
        ), ''),
        COALESCE(NEW.lyrics, ''),
        COALESCE(NEW.metadata, '{}');
END;

CREATE TRIGGER IF NOT EXISTS songz_fts_update AFTER UPDATE ON songz
BEGIN
    DELETE FROM songz_fts WHERE song_id = OLD.id;
    INSERT INTO songz_fts(
        song_id,
        title,
        artist_name,
        album_name,
        genre_name,
        sub_genre_names,
        filename,
        lyrics,
        metadata_text
    )
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM artist_songz
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE artist_songz.song_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT album.title
            FROM album_songz
            JOIN albumz album ON album_songz.album_id = album.id
            WHERE album_songz.song_id = NEW.id AND album.deleted_at IS NULL
            LIMIT 1
        ), ''),
        COALESCE((
            SELECT genre.name
            FROM album_songz
            JOIN albumz album ON album_songz.album_id = album.id
            JOIN genrez genre ON album.genre_id = genre.id
            WHERE album_songz.song_id = NEW.id AND album.deleted_at IS NULL AND genre.deleted_at IS NULL
            LIMIT 1
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(sub_genre_name, ', ')
            FROM (
                SELECT DISTINCT sub_genre.name as sub_genre_name
                FROM album_songz
                JOIN album_sub_genrez ON album_songz.album_id = album_sub_genrez.album_id
                JOIN sub_genrez sub_genre ON album_sub_genrez.sub_genre_id = sub_genre.id
                WHERE album_songz.song_id = NEW.id AND sub_genre.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = NEW.media_blob_id
        ), ''),
        COALESCE(NEW.lyrics, ''),
        COALESCE(NEW.metadata, '{}');
END;

CREATE TRIGGER IF NOT EXISTS songz_fts_delete AFTER DELETE ON songz
BEGIN
    DELETE FROM songz_fts WHERE song_id = OLD.id;
END;

-- =============================================================================
-- Triggers for artistz
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS artistz_fts_insert AFTER INSERT ON artistz
BEGIN
    INSERT INTO artistz_fts(artist_id, name, genre_names)
    SELECT
        NEW.id,
        NEW.name,
        COALESCE((
            SELECT GROUP_CONCAT(genre_name, ', ')
            FROM (
                SELECT DISTINCT genre.name as genre_name
                FROM artist_songz
                JOIN album_songz ON artist_songz.song_id = album_songz.song_id
                JOIN albumz album ON album_songz.album_id = album.id
                JOIN genrez genre ON album.genre_id = genre.id
                WHERE artist_songz.artist_id = NEW.id AND genre.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER IF NOT EXISTS artistz_fts_update AFTER UPDATE ON artistz
BEGIN
    DELETE FROM artistz_fts WHERE artist_id = OLD.id;
    INSERT INTO artistz_fts(artist_id, name, genre_names)
    SELECT
        NEW.id,
        NEW.name,
        COALESCE((
            SELECT GROUP_CONCAT(genre_name, ', ')
            FROM (
                SELECT DISTINCT genre.name as genre_name
                FROM artist_songz
                JOIN album_songz ON artist_songz.song_id = album_songz.song_id
                JOIN albumz album ON album_songz.album_id = album.id
                JOIN genrez genre ON album.genre_id = genre.id
                WHERE artist_songz.artist_id = NEW.id AND genre.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER IF NOT EXISTS artistz_fts_delete AFTER DELETE ON artistz
BEGIN
    DELETE FROM artistz_fts WHERE artist_id = OLD.id;
END;

-- =============================================================================
-- Triggers for albumz
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS albumz_fts_insert AFTER INSERT ON albumz
BEGIN
    INSERT INTO albumz_fts(album_id, title, artist_name, genre_name, sub_genre_names)
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM album_songz
                JOIN artist_songz ON album_songz.song_id = artist_songz.song_id
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE album_songz.album_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT genre.name
            FROM genrez genre
            WHERE genre.id = NEW.genre_id AND genre.deleted_at IS NULL
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(sub_genre_name, ', ')
            FROM (
                SELECT DISTINCT sub_genre.name as sub_genre_name
                FROM album_sub_genrez
                JOIN sub_genrez sub_genre ON album_sub_genrez.sub_genre_id = sub_genre.id
                WHERE album_sub_genrez.album_id = NEW.id AND sub_genre.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER IF NOT EXISTS albumz_fts_update AFTER UPDATE ON albumz
BEGIN
    DELETE FROM albumz_fts WHERE album_id = OLD.id;
    INSERT INTO albumz_fts(album_id, title, artist_name, genre_name, sub_genre_names)
    SELECT
        NEW.id,
        NEW.title,
        COALESCE((
            SELECT GROUP_CONCAT(artist_name, ', ')
            FROM (
                SELECT DISTINCT artist.name as artist_name
                FROM album_songz
                JOIN artist_songz ON album_songz.song_id = artist_songz.song_id
                JOIN artistz artist ON artist_songz.artist_id = artist.id
                WHERE album_songz.album_id = NEW.id AND artist.deleted_at IS NULL
            )
        ), ''),
        COALESCE((
            SELECT genre.name
            FROM genrez genre
            WHERE genre.id = NEW.genre_id AND genre.deleted_at IS NULL
        ), ''),
        COALESCE((
            SELECT GROUP_CONCAT(sub_genre_name, ', ')
            FROM (
                SELECT DISTINCT sub_genre.name as sub_genre_name
                FROM album_sub_genrez
                JOIN sub_genrez sub_genre ON album_sub_genrez.sub_genre_id = sub_genre.id
                WHERE album_sub_genrez.album_id = NEW.id AND sub_genre.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER IF NOT EXISTS albumz_fts_delete AFTER DELETE ON albumz
BEGIN
    DELETE FROM albumz_fts WHERE album_id = OLD.id;
END;

-- =============================================================================
-- Triggers for genrez
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS genrez_fts_insert AFTER INSERT ON genrez
BEGIN
    INSERT INTO genrez_fts(genre_id, name)
    VALUES (NEW.id, NEW.name);
END;

CREATE TRIGGER IF NOT EXISTS genrez_fts_update AFTER UPDATE ON genrez
BEGIN
    DELETE FROM genrez_fts WHERE genre_id = OLD.id;
    INSERT INTO genrez_fts(genre_id, name)
    VALUES (NEW.id, NEW.name);
END;

CREATE TRIGGER IF NOT EXISTS genrez_fts_delete AFTER DELETE ON genrez
BEGIN
    DELETE FROM genrez_fts WHERE genre_id = OLD.id;
END;

-- =============================================================================
-- Triggers for sub_genrez
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS sub_genrez_fts_insert AFTER INSERT ON sub_genrez
BEGIN
    INSERT INTO sub_genrez_fts(sub_genre_id, name, parent_genre_name)
    SELECT
        NEW.id,
        NEW.name,
        COALESCE((
            SELECT genre.name
            FROM genrez genre
            WHERE genre.id = NEW.parent_genre_id AND genre.deleted_at IS NULL
        ), '');
END;

CREATE TRIGGER IF NOT EXISTS sub_genrez_fts_update AFTER UPDATE ON sub_genrez
BEGIN
    DELETE FROM sub_genrez_fts WHERE sub_genre_id = OLD.id;
    INSERT INTO sub_genrez_fts(sub_genre_id, name, parent_genre_name)
    SELECT
        NEW.id,
        NEW.name,
        COALESCE((
            SELECT genre.name
            FROM genrez genre
            WHERE genre.id = NEW.parent_genre_id AND genre.deleted_at IS NULL
        ), '');
END;

CREATE TRIGGER IF NOT EXISTS sub_genrez_fts_delete AFTER DELETE ON sub_genrez
BEGIN
    DELETE FROM sub_genrez_fts WHERE sub_genre_id = OLD.id;
END;

-- =============================================================================
-- Triggers for playlistz
-- =============================================================================

CREATE TRIGGER IF NOT EXISTS playlistz_fts_insert AFTER INSERT ON playlistz
BEGIN
    INSERT INTO playlistz_fts(playlist_id, title, description)
    VALUES (NEW.id, NEW.title, COALESCE(NEW.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS playlistz_fts_update AFTER UPDATE ON playlistz
BEGIN
    DELETE FROM playlistz_fts WHERE playlist_id = OLD.id;
    INSERT INTO playlistz_fts(playlist_id, title, description)
    VALUES (NEW.id, NEW.title, COALESCE(NEW.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS playlistz_fts_delete AFTER DELETE ON playlistz
BEGIN
    DELETE FROM playlistz_fts WHERE playlist_id = OLD.id;
END;

-- =============================================================================
-- Indexes for Performance
-- =============================================================================

-- user preferences indexes (for fast joins in search queries)
CREATE INDEX IF NOT EXISTS idx_user_ratingz_target
    ON user_ratingz(target_type, target_id, user_id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_favoritez_target
    ON user_favoritez(target_type, target_id, user_id);

-- tag/genre filtering indexes
CREATE INDEX IF NOT EXISTS idx_album_tagz_lookup
    ON album_tagz(album_id, tag_id);

CREATE INDEX IF NOT EXISTS idx_album_tagz_reverse
    ON album_tagz(tag_id, album_id);

CREATE INDEX IF NOT EXISTS idx_album_sub_genrez_lookup
    ON album_sub_genrez(album_id, sub_genre_id);

CREATE INDEX IF NOT EXISTS idx_album_sub_genrez_reverse
    ON album_sub_genrez(sub_genre_id, album_id);

CREATE INDEX IF NOT EXISTS idx_albumz_genre
    ON albumz(genre_id)
    WHERE deleted_at IS NULL;

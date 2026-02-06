-- 009: full-text search - FTS5 tables and sync triggers

-- songs FTS (main searchable content)
CREATE VIRTUAL TABLE songz_fts USING fts5(
    song_id UNINDEXED,
    title,
    artist_name,
    album_name,
    genre_name,
    sub_genre_names,  -- kept for backward compatibility, will be empty
    filename,
    lyrics,
    metadata_text,
    tokenize = 'porter unicode61'
);

-- artists FTS
CREATE VIRTUAL TABLE artistz_fts USING fts5(
    artist_id UNINDEXED,
    name,
    genre_names,
    tokenize = 'porter unicode61'
);

-- albums FTS
CREATE VIRTUAL TABLE albumz_fts USING fts5(
    album_id UNINDEXED,
    title,
    artist_name,
    genre_name,
    sub_genre_names,  -- kept for backward compatibility, will be empty
    tokenize = 'porter unicode61'
);

-- genres FTS
CREATE VIRTUAL TABLE genrez_fts USING fts5(
    genre_id UNINDEXED,
    name,
    tokenize = 'porter unicode61'
);

-- sub_genres FTS (kept for backward compatibility)
CREATE VIRTUAL TABLE sub_genrez_fts USING fts5(
    sub_genre_id UNINDEXED,
    name,
    parent_genre_name,
    tokenize = 'porter unicode61'
);

-- playlists FTS
CREATE VIRTUAL TABLE playlistz_fts USING fts5(
    playlist_id UNINDEXED,
    title,
    description,
    tokenize = 'porter unicode61'
);

-- FTS sync triggers for artists
CREATE TRIGGER artistz_fts_insert AFTER INSERT ON artistz
BEGIN
    INSERT INTO artistz_fts(artist_id, name, genre_names)
    SELECT
        NEW.id,
        NEW.name,
        COALESCE((
            SELECT GROUP_CONCAT(genre_name, ', ')
            FROM (
                SELECT DISTINCT g.name as genre_name
                FROM artist_songz ars
                JOIN album_songz als ON ars.song_id = als.song_id
                JOIN albumz a ON als.album_id = a.id
                JOIN album_genrez ag ON a.id = ag.album_id
                JOIN genrez g ON ag.genre_id = g.id
                WHERE ars.artist_id = NEW.id AND g.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER artistz_fts_update AFTER UPDATE ON artistz
BEGIN
    DELETE FROM artistz_fts WHERE artist_id = OLD.id;
    INSERT INTO artistz_fts(artist_id, name, genre_names)
    SELECT
        NEW.id,
        NEW.name,
        COALESCE((
            SELECT GROUP_CONCAT(genre_name, ', ')
            FROM (
                SELECT DISTINCT g.name as genre_name
                FROM artist_songz ars
                JOIN album_songz als ON ars.song_id = als.song_id
                JOIN albumz a ON als.album_id = a.id
                JOIN album_genrez ag ON a.id = ag.album_id
                JOIN genrez g ON ag.genre_id = g.id
                WHERE ars.artist_id = NEW.id AND g.deleted_at IS NULL
            )
        ), '');
END;

CREATE TRIGGER artistz_fts_delete AFTER DELETE ON artistz
BEGIN
    DELETE FROM artistz_fts WHERE artist_id = OLD.id;
END;

-- FTS sync triggers for songs
CREATE TRIGGER songz_fts_insert AFTER INSERT ON songz
BEGIN
    INSERT INTO songz_fts(
        song_id, title, artist_name, album_name, genre_name,
        sub_genre_names, filename, lyrics, metadata_text
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
            SELECT g.name
            FROM album_songz als
            JOIN albumz a ON als.album_id = a.id
            JOIN album_genrez ag ON a.id = ag.album_id
            JOIN genrez g ON ag.genre_id = g.id
            WHERE als.song_id = NEW.id AND a.deleted_at IS NULL AND g.deleted_at IS NULL
            LIMIT 1
        ), ''),
        '',
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = NEW.media_blob_id
        ), ''),
        COALESCE(NEW.lyrics, ''),
        COALESCE(NEW.metadata, '{}');
END;

CREATE TRIGGER songz_fts_update AFTER UPDATE ON songz
BEGIN
    DELETE FROM songz_fts WHERE song_id = OLD.id;
    INSERT INTO songz_fts(
        song_id, title, artist_name, album_name, genre_name,
        sub_genre_names, filename, lyrics, metadata_text
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
            SELECT g.name
            FROM album_songz als
            JOIN albumz a ON als.album_id = a.id
            JOIN album_genrez ag ON a.id = ag.album_id
            JOIN genrez g ON ag.genre_id = g.id
            WHERE als.song_id = NEW.id AND a.deleted_at IS NULL AND g.deleted_at IS NULL
            LIMIT 1
        ), ''),
        '',
        COALESCE((
            SELECT media_blob.filename
            FROM media_blobz media_blob
            WHERE media_blob.id = NEW.media_blob_id
        ), ''),
        COALESCE(NEW.lyrics, ''),
        COALESCE(NEW.metadata, '{}');
END;

CREATE TRIGGER songz_fts_delete AFTER DELETE ON songz
BEGIN
    DELETE FROM songz_fts WHERE song_id = OLD.id;
END;

-- FTS sync triggers for albums
CREATE TRIGGER albumz_fts_insert AFTER INSERT ON albumz
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
            SELECT GROUP_CONCAT(genre_name, ', ')
            FROM (
                SELECT DISTINCT g.name as genre_name
                FROM album_genrez ag
                JOIN genrez g ON ag.genre_id = g.id
                WHERE ag.album_id = NEW.id AND g.deleted_at IS NULL
            )
        ), ''),
        '';
END;

CREATE TRIGGER albumz_fts_update AFTER UPDATE ON albumz
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
            SELECT GROUP_CONCAT(genre_name, ', ')
            FROM (
                SELECT DISTINCT g.name as genre_name
                FROM album_genrez ag
                JOIN genrez g ON ag.genre_id = g.id
                WHERE ag.album_id = NEW.id AND g.deleted_at IS NULL
            )
        ), ''),
        '';
END;

CREATE TRIGGER albumz_fts_delete AFTER DELETE ON albumz
BEGIN
    DELETE FROM albumz_fts WHERE album_id = OLD.id;
END;

-- FTS sync triggers for genres
CREATE TRIGGER genrez_fts_insert AFTER INSERT ON genrez
BEGIN
    INSERT INTO genrez_fts(genre_id, name) VALUES (NEW.id, NEW.name);
END;

CREATE TRIGGER genrez_fts_update AFTER UPDATE ON genrez
BEGIN
    DELETE FROM genrez_fts WHERE genre_id = OLD.id;
    INSERT INTO genrez_fts(genre_id, name) VALUES (NEW.id, NEW.name);
END;

CREATE TRIGGER genrez_fts_delete AFTER DELETE ON genrez
BEGIN
    DELETE FROM genrez_fts WHERE genre_id = OLD.id;
END;

-- FTS sync triggers for playlists
CREATE TRIGGER playlistz_fts_insert AFTER INSERT ON playlistz
BEGIN
    INSERT INTO playlistz_fts(playlist_id, title, description)
    VALUES (NEW.id, NEW.title, COALESCE(NEW.description, ''));
END;

CREATE TRIGGER playlistz_fts_update AFTER UPDATE ON playlistz
BEGIN
    DELETE FROM playlistz_fts WHERE playlist_id = OLD.id;
    INSERT INTO playlistz_fts(playlist_id, title, description)
    VALUES (NEW.id, NEW.title, COALESCE(NEW.description, ''));
END;

CREATE TRIGGER playlistz_fts_delete AFTER DELETE ON playlistz
BEGIN
    DELETE FROM playlistz_fts WHERE playlist_id = OLD.id;
END;

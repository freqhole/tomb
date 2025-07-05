-- SQLite Photos Domain Schema
-- Photos, galleries, and image-related tables

-- Photos table for image domain
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    media_blob_id TEXT NOT NULL,
    thumbnail_blob_id TEXT,
    title TEXT,
    caption TEXT,
    alt_text TEXT,
    location TEXT,
    latitude REAL,
    longitude REAL,
    taken_at DATETIME,
    camera_make TEXT,
    camera_model TEXT,
    lens_info TEXT,
    focal_length INTEGER,
    aperture REAL,
    shutter_speed TEXT,
    iso INTEGER,
    flash_used BOOLEAN,
    orientation INTEGER,
    width_px INTEGER,
    height_px INTEGER,
    color_space TEXT,
    rating INTEGER,
    is_favorite BOOLEAN DEFAULT FALSE,
    tags TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    deleted_at DATETIME,
    deleted_by TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1,

    CHECK (focal_length > 0),
    CHECK (aperture > 0),
    CHECK (iso > 0),
    CHECK (orientation >= 1 AND orientation <= 8),
    CHECK (width_px > 0),
    CHECK (height_px > 0),
    CHECK (rating >= 1 AND rating <= 5),
    FOREIGN KEY (media_blob_id) REFERENCES media_blobs(id) ON DELETE CASCADE,
    FOREIGN KEY (thumbnail_blob_id) REFERENCES media_blobs(id) ON DELETE SET NULL,
    FOREIGN KEY (deleted_by) REFERENCES users(id)
);

-- Indexes for photos table
CREATE INDEX IF NOT EXISTS idx_photos_media_blob_id ON photos(media_blob_id);
CREATE INDEX IF NOT EXISTS idx_photos_title ON photos(title) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_taken_at ON photos(taken_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_location ON photos(location) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_camera_make ON photos(camera_make) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_camera_model ON photos(camera_model) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_rating ON photos(rating) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_is_favorite ON photos(is_favorite) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_deleted_at ON photos(deleted_at);
CREATE INDEX IF NOT EXISTS idx_photos_active ON photos(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photos_location_coords ON photos(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND deleted_at IS NULL;

-- Galleries table
CREATE TABLE IF NOT EXISTS galleries (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL,
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_by TEXT NOT NULL,
    thumbnail_blob_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME,

    CHECK (length(name) > 0),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (thumbnail_blob_id) REFERENCES media_blobs(id) ON DELETE SET NULL
);

-- Indexes for galleries
CREATE INDEX IF NOT EXISTS idx_galleries_name ON galleries(name);
CREATE INDEX IF NOT EXISTS idx_galleries_created_by ON galleries(created_by);
CREATE INDEX IF NOT EXISTS idx_galleries_is_public ON galleries(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_galleries_created_at ON galleries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_galleries_deleted_at ON galleries(deleted_at);

-- Gallery photos junction table
CREATE TABLE IF NOT EXISTS gallery_photos (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    gallery_id TEXT NOT NULL,
    photo_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK (position > 0),
    FOREIGN KEY (gallery_id) REFERENCES galleries(id) ON DELETE CASCADE,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
    UNIQUE (gallery_id, photo_id),
    UNIQUE (gallery_id, position)
);

-- Indexes for gallery_photos
CREATE INDEX IF NOT EXISTS idx_gallery_photos_gallery ON gallery_photos(gallery_id);
CREATE INDEX IF NOT EXISTS idx_gallery_photos_photo ON gallery_photos(photo_id);
CREATE INDEX IF NOT EXISTS idx_gallery_photos_position ON gallery_photos(gallery_id, position);

-- Views for common queries
CREATE VIEW IF NOT EXISTS active_photos AS
SELECT * FROM photos WHERE deleted_at IS NULL;

CREATE VIEW IF NOT EXISTS active_galleries AS
SELECT * FROM galleries WHERE deleted_at IS NULL;

CREATE VIEW IF NOT EXISTS photos_with_files AS
SELECT
    p.*,
    mb.mime,
    mb.size,
    mb.local_path,
    thumb.id as thumbnail_id,
    thumb.mime as thumbnail_mime,
    thumb.size as thumbnail_size
FROM photos p
JOIN media_blobs mb ON p.media_blob_id = mb.id
LEFT JOIN media_blobs thumb ON p.thumbnail_blob_id = thumb.id
WHERE p.deleted_at IS NULL
AND mb.deleted_at IS NULL;

-- Trigger to update updated_at timestamp on photos
CREATE TRIGGER IF NOT EXISTS update_photos_updated_at
    AFTER UPDATE ON photos
    FOR EACH ROW
    BEGIN
        UPDATE photos SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Trigger to update updated_at timestamp on galleries
CREATE TRIGGER IF NOT EXISTS update_galleries_updated_at
    AFTER UPDATE ON galleries
    FOR EACH ROW
    BEGIN
        UPDATE galleries SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

-- Trigger to maintain gallery positions on delete
CREATE TRIGGER IF NOT EXISTS maintain_gallery_positions_delete
    AFTER DELETE ON gallery_photos
    FOR EACH ROW
    BEGIN
        UPDATE gallery_photos
        SET position = position - 1
        WHERE gallery_id = OLD.gallery_id
        AND position > OLD.position;
    END;

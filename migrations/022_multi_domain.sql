-- 022: multi-domain media — audio, photos, videos, documents, files, and cross-domain collections

-- ============================================================================
-- audioz — audio files (samples, voice memos, in-progress tracks, NOT the music library)
-- ============================================================================

CREATE TABLE audioz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  media_blob_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  original_filename TEXT,
  duration INTEGER,
  sample_rate INTEGER,
  channels INTEGER,
  bitrate INTEGER,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,
  UNIQUE (media_blob_id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

CREATE INDEX idx_audioz_title ON audioz(title);
CREATE INDEX idx_audioz_created_at ON audioz(created_at DESC);
CREATE INDEX idx_audioz_deleted_at ON audioz(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_audioz_media_blob_id ON audioz(media_blob_id);

CREATE TRIGGER trg_audioz_updated_at
AFTER UPDATE ON audioz
FOR EACH ROW
BEGIN
  UPDATE audioz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- audio images
CREATE TABLE audio_imagez (
  audio_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (audio_id, media_blob_id),
  FOREIGN KEY (audio_id) REFERENCES audioz(id) ON DELETE CASCADE,
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id) ON DELETE CASCADE
);

CREATE INDEX idx_audio_imagez_audio_id ON audio_imagez(audio_id);
CREATE INDEX idx_audio_imagez_blob ON audio_imagez(media_blob_id);
CREATE INDEX idx_audio_imagez_primary ON audio_imagez(audio_id, is_primary) WHERE is_primary = 1;

-- audio tags
CREATE TABLE audio_tagz (
  audio_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (audio_id, tag_id),
  FOREIGN KEY (audio_id) REFERENCES audioz(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tagz(id) ON DELETE CASCADE
);

CREATE INDEX idx_audio_tagz_audio_id ON audio_tagz(audio_id);
CREATE INDEX idx_audio_tagz_tag_id ON audio_tagz(tag_id);

-- ============================================================================
-- photoz — photographs and images
-- ============================================================================

CREATE TABLE photoz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  media_blob_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  original_filename TEXT,
  taken_at INTEGER,
  width INTEGER,
  height INTEGER,
  camera_make TEXT,
  camera_model TEXT,
  gps_lat REAL,
  gps_lon REAL,
  orientation INTEGER,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,
  UNIQUE (media_blob_id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

CREATE INDEX idx_photoz_title ON photoz(title);
CREATE INDEX idx_photoz_created_at ON photoz(created_at DESC);
CREATE INDEX idx_photoz_deleted_at ON photoz(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_photoz_media_blob_id ON photoz(media_blob_id);

CREATE TRIGGER trg_photoz_updated_at
AFTER UPDATE ON photoz
FOR EACH ROW
BEGIN
  UPDATE photoz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- photo images (thumbnails, crops, etc.)
CREATE TABLE photo_imagez (
  photo_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (photo_id, media_blob_id),
  FOREIGN KEY (photo_id) REFERENCES photoz(id) ON DELETE CASCADE,
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id) ON DELETE CASCADE
);

CREATE INDEX idx_photo_imagez_photo_id ON photo_imagez(photo_id);
CREATE INDEX idx_photo_imagez_blob ON photo_imagez(media_blob_id);
CREATE INDEX idx_photo_imagez_primary ON photo_imagez(photo_id, is_primary) WHERE is_primary = 1;

-- photo tags
CREATE TABLE photo_tagz (
  photo_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (photo_id, tag_id),
  FOREIGN KEY (photo_id) REFERENCES photoz(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tagz(id) ON DELETE CASCADE
);

CREATE INDEX idx_photo_tagz_photo_id ON photo_tagz(photo_id);
CREATE INDEX idx_photo_tagz_tag_id ON photo_tagz(tag_id);

-- ============================================================================
-- videoz — video files
-- ============================================================================

CREATE TABLE videoz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  media_blob_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  original_filename TEXT,
  duration INTEGER,
  width INTEGER,
  height INTEGER,
  codec TEXT,
  framerate REAL,
  bitrate INTEGER,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,
  UNIQUE (media_blob_id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

CREATE INDEX idx_videoz_title ON videoz(title);
CREATE INDEX idx_videoz_created_at ON videoz(created_at DESC);
CREATE INDEX idx_videoz_deleted_at ON videoz(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_videoz_media_blob_id ON videoz(media_blob_id);

CREATE TRIGGER trg_videoz_updated_at
AFTER UPDATE ON videoz
FOR EACH ROW
BEGIN
  UPDATE videoz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- video images (thumbnails, poster frames)
CREATE TABLE video_imagez (
  video_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (video_id, media_blob_id),
  FOREIGN KEY (video_id) REFERENCES videoz(id) ON DELETE CASCADE,
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id) ON DELETE CASCADE
);

CREATE INDEX idx_video_imagez_video_id ON video_imagez(video_id);
CREATE INDEX idx_video_imagez_blob ON video_imagez(media_blob_id);
CREATE INDEX idx_video_imagez_primary ON video_imagez(video_id, is_primary) WHERE is_primary = 1;

-- video tags
CREATE TABLE video_tagz (
  video_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (video_id, tag_id),
  FOREIGN KEY (video_id) REFERENCES videoz(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tagz(id) ON DELETE CASCADE
);

CREATE INDEX idx_video_tagz_video_id ON video_tagz(video_id);
CREATE INDEX idx_video_tagz_tag_id ON video_tagz(tag_id);

-- ============================================================================
-- documentz — documents (pdf, epub, html, txt, docx, etc.)
-- ============================================================================

CREATE TABLE documentz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  media_blob_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  original_filename TEXT,
  author TEXT,
  page_count INTEGER,
  doc_type TEXT,
  language TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,
  UNIQUE (media_blob_id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

CREATE INDEX idx_documentz_title ON documentz(title);
CREATE INDEX idx_documentz_created_at ON documentz(created_at DESC);
CREATE INDEX idx_documentz_deleted_at ON documentz(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_documentz_media_blob_id ON documentz(media_blob_id);

CREATE TRIGGER trg_documentz_updated_at
AFTER UPDATE ON documentz
FOR EACH ROW
BEGIN
  UPDATE documentz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- document images (cover pages, thumbnails)
CREATE TABLE document_imagez (
  document_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, media_blob_id),
  FOREIGN KEY (document_id) REFERENCES documentz(id) ON DELETE CASCADE,
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id) ON DELETE CASCADE
);

CREATE INDEX idx_document_imagez_document_id ON document_imagez(document_id);
CREATE INDEX idx_document_imagez_blob ON document_imagez(media_blob_id);
CREATE INDEX idx_document_imagez_primary ON document_imagez(document_id, is_primary) WHERE is_primary = 1;

-- document tags
CREATE TABLE document_tagz (
  document_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (document_id, tag_id),
  FOREIGN KEY (document_id) REFERENCES documentz(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tagz(id) ON DELETE CASCADE
);

CREATE INDEX idx_document_tagz_document_id ON document_tagz(document_id);
CREATE INDEX idx_document_tagz_tag_id ON document_tagz(tag_id);

-- ============================================================================
-- filez — catch-all for any file type not covered by other domains
-- ============================================================================

CREATE TABLE filez (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  media_blob_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  original_filename TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,
  UNIQUE (media_blob_id),
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id)
);

CREATE INDEX idx_filez_title ON filez(title);
CREATE INDEX idx_filez_created_at ON filez(created_at DESC);
CREATE INDEX idx_filez_deleted_at ON filez(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_filez_media_blob_id ON filez(media_blob_id);

CREATE TRIGGER trg_filez_updated_at
AFTER UPDATE ON filez
FOR EACH ROW
BEGIN
  UPDATE filez SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- file images
CREATE TABLE file_imagez (
  file_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (file_id, media_blob_id),
  FOREIGN KEY (file_id) REFERENCES filez(id) ON DELETE CASCADE,
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id) ON DELETE CASCADE
);

CREATE INDEX idx_file_imagez_file_id ON file_imagez(file_id);
CREATE INDEX idx_file_imagez_blob ON file_imagez(media_blob_id);
CREATE INDEX idx_file_imagez_primary ON file_imagez(file_id, is_primary) WHERE is_primary = 1;

-- file tags
CREATE TABLE file_tagz (
  file_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (file_id, tag_id),
  FOREIGN KEY (file_id) REFERENCES filez(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tagz(id) ON DELETE CASCADE
);

CREATE INDEX idx_file_tagz_file_id ON file_tagz(file_id);
CREATE INDEX idx_file_tagz_tag_id ON file_tagz(tag_id);

-- ============================================================================
-- collectionz — cross-domain collections (playlists, galleries, reading lists, etc.)
-- ============================================================================

CREATE TABLE collectionz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  title TEXT NOT NULL,
  description TEXT,
  collection_type TEXT,
  cover_blob_id TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at INTEGER,
  deleted_by TEXT,
  created_by TEXT,
  updated_by TEXT,
  FOREIGN KEY (cover_blob_id) REFERENCES media_blobz(id)
);

CREATE INDEX idx_collectionz_title ON collectionz(title);
CREATE INDEX idx_collectionz_created_at ON collectionz(created_at DESC);
CREATE INDEX idx_collectionz_deleted_at ON collectionz(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TRIGGER trg_collectionz_updated_at
AFTER UPDATE ON collectionz
FOR EACH ROW
BEGIN
  UPDATE collectionz SET updated_at = unixepoch() WHERE id = NEW.id;
END;

-- collection images
CREATE TABLE collection_imagez (
  collection_id TEXT NOT NULL,
  media_blob_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, media_blob_id),
  FOREIGN KEY (collection_id) REFERENCES collectionz(id) ON DELETE CASCADE,
  FOREIGN KEY (media_blob_id) REFERENCES media_blobz(id) ON DELETE CASCADE
);

CREATE INDEX idx_collection_imagez_collection_id ON collection_imagez(collection_id);
CREATE INDEX idx_collection_imagez_blob ON collection_imagez(media_blob_id);
CREATE INDEX idx_collection_imagez_primary ON collection_imagez(collection_id, is_primary) WHERE is_primary = 1;

-- ============================================================================
-- collection_itemz — items within a collection, referencing any domain entity
-- ============================================================================

CREATE TABLE collection_itemz (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  collection_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (collection_id, item_type, item_id),
  FOREIGN KEY (collection_id) REFERENCES collectionz(id) ON DELETE CASCADE,
  CHECK (item_type IN ('audio', 'photo', 'video', 'document', 'file', 'song'))
);

CREATE INDEX idx_collection_itemz_collection_id ON collection_itemz(collection_id);
CREATE INDEX idx_collection_itemz_position ON collection_itemz(collection_id, position);
CREATE INDEX idx_collection_itemz_item ON collection_itemz(item_type, item_id);

-- 023: document page image support
-- adds columns to track individual PDF page renders alongside existing thumbnails/covers

-- step 1: add page_number column (null for non-page images like thumbnails and covers)
ALTER TABLE document_imagez ADD COLUMN page_number INTEGER;

-- step 2: add total_pages column (null for non-page images)
ALTER TABLE document_imagez ADD COLUMN total_pages INTEGER;

-- step 3: add image_type column to distinguish page renders from thumbnails/covers
-- values: 'thumbnail' (default, existing behavior), 'page_render' (individual page images)
ALTER TABLE document_imagez ADD COLUMN image_type TEXT NOT NULL DEFAULT 'thumbnail';

-- step 4: add index for efficient page lookup queries
-- supports queries like: WHERE document_id = ? AND image_type = 'page_render' ORDER BY page_number
CREATE INDEX idx_document_imagez_page_lookup ON document_imagez(document_id, image_type, page_number);

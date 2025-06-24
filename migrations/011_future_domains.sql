-- Future Domain Tables (Books and Documents)
-- This migration creates the books and documents domain tables for future phases

-- Create books table for document/ebook domain
CREATE TABLE books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id UUID NOT NULL REFERENCES media_blobs(id) ON DELETE CASCADE,
    thumbnail_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    author TEXT,
    isbn TEXT UNIQUE,
    isbn13 TEXT UNIQUE,
    publisher TEXT,
    published_date DATE,
    language TEXT,
    page_count INTEGER CHECK (page_count > 0),
    word_count INTEGER CHECK (word_count > 0),
    format TEXT CHECK (format IN ('pdf', 'epub', 'mobi', 'azw3', 'txt', 'html', 'docx')),
    series_name TEXT,
    series_number INTEGER CHECK (series_number > 0),
    reading_progress DECIMAL(5,2) DEFAULT 0.0 CHECK (reading_progress >= 0 AND reading_progress <= 100),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    is_favorite BOOLEAN DEFAULT false,
    tags TEXT[] DEFAULT '{}',
    notes TEXT,
    bookmarks JSONB DEFAULT '[]',
    highlights JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT txid_current()
);

-- Add comments for books table
COMMENT ON TABLE books IS 'Books domain: ebooks, documents, and reading metadata';
COMMENT ON COLUMN books.media_blob_id IS 'Reference to the actual book file blob (PDF, EPUB, etc.)';
COMMENT ON COLUMN books.thumbnail_blob_id IS 'Reference to book cover image blob';
COMMENT ON COLUMN books.isbn IS 'ISBN-10 identifier';
COMMENT ON COLUMN books.isbn13 IS 'ISBN-13 identifier';
COMMENT ON COLUMN books.page_count IS 'Number of pages in the book';
COMMENT ON COLUMN books.word_count IS 'Approximate word count';
COMMENT ON COLUMN books.format IS 'File format of the book';
COMMENT ON COLUMN books.series_name IS 'Name of book series (if applicable)';
COMMENT ON COLUMN books.series_number IS 'Book number within series';
COMMENT ON COLUMN books.reading_progress IS 'Percentage of book read (0-100)';
COMMENT ON COLUMN books.notes IS 'User reading notes and thoughts';
COMMENT ON COLUMN books.bookmarks IS 'Array of bookmark positions with metadata';
COMMENT ON COLUMN books.highlights IS 'Text highlights with positions and notes';
COMMENT ON COLUMN books.metadata IS 'Extended metadata (table of contents, DRM info, etc.)';

-- Create indexes for books table
CREATE INDEX idx_books_media_blob_id ON books(media_blob_id);
CREATE INDEX idx_books_title ON books(title) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_author ON books(author) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_isbn ON books(isbn) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_isbn13 ON books(isbn13) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_publisher ON books(publisher) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_published_date ON books(published_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_language ON books(language) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_format ON books(format) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_series ON books(series_name, series_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_rating ON books(rating) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_is_favorite ON books(is_favorite) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_reading_progress ON books(reading_progress) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_deleted_at ON books(deleted_at);
CREATE INDEX idx_books_active ON books(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_version ON books(version);
CREATE INDEX idx_books_created_at ON books(created_at) WHERE deleted_at IS NULL;

-- Composite indexes for common queries
CREATE INDEX idx_books_author_series ON books(author, series_name, series_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_search ON books(title, author, publisher) WHERE deleted_at IS NULL;

-- GIN indexes for array and JSONB columns
CREATE INDEX idx_books_tags ON books USING GIN(tags) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_bookmarks ON books USING GIN(bookmarks) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_highlights ON books USING GIN(highlights) WHERE deleted_at IS NULL;
CREATE INDEX idx_books_metadata ON books USING GIN(metadata) WHERE deleted_at IS NULL;

-- Create view for active books
CREATE VIEW active_books AS
SELECT * FROM books WHERE deleted_at IS NULL;

-- Create view for books with file information
CREATE VIEW books_with_files AS
SELECT
    b.*,
    mb.mime,
    mb.size,
    mb.local_path,
    thumb.id as thumbnail_id,
    thumb.mime as thumbnail_mime,
    thumb.size as thumbnail_size
FROM books b
JOIN media_blobs mb ON b.media_blob_id = mb.id
LEFT JOIN media_blobs thumb ON b.thumbnail_blob_id = thumb.id
WHERE b.deleted_at IS NULL
AND mb.deleted_at IS NULL;

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_books_updated_at
    BEFORE UPDATE ON books
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create documents table for user-generated content
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id UUID NOT NULL REFERENCES media_blobs(id) ON DELETE CASCADE,
    thumbnail_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    content_type TEXT DEFAULT 'html' CHECK (content_type IN ('html', 'markdown', 'text', 'json')),
    word_count INTEGER CHECK (word_count >= 0),
    character_count INTEGER CHECK (character_count >= 0),
    language TEXT,
    folder_path TEXT,
    tags TEXT[] DEFAULT '{}',
    is_published BOOLEAN DEFAULT false,
    published_at TIMESTAMPTZ,
    version INTEGER DEFAULT 1 CHECK (version > 0),
    parent_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    author_notes TEXT,
    collaborators UUID[],
    last_edited_by UUID REFERENCES users(id),
    edit_count INTEGER DEFAULT 0 CHECK (edit_count >= 0),
    is_template BOOLEAN DEFAULT false,
    template_category TEXT,
    metadata JSONB DEFAULT '{}',
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    db_version BIGINT NOT NULL DEFAULT txid_current()
);

-- Add comments for documents table
COMMENT ON TABLE documents IS 'Documents domain: user-generated content and collaborative editing';
COMMENT ON COLUMN documents.media_blob_id IS 'Reference to the actual document content blob';
COMMENT ON COLUMN documents.thumbnail_blob_id IS 'Reference to document preview/thumbnail blob';
COMMENT ON COLUMN documents.content_type IS 'Content format: html, markdown, text, json';
COMMENT ON COLUMN documents.word_count IS 'Word count for text content';
COMMENT ON COLUMN documents.character_count IS 'Character count including whitespace';
COMMENT ON COLUMN documents.folder_path IS 'Virtual folder organization path';
COMMENT ON COLUMN documents.is_published IS 'Whether document is publicly accessible';
COMMENT ON COLUMN documents.published_at IS 'When document was first published';
COMMENT ON COLUMN documents.version IS 'Document version number for revision tracking';
COMMENT ON COLUMN documents.parent_document_id IS 'Reference to parent document for versioning/forking';
COMMENT ON COLUMN documents.author_notes IS 'Private notes about this document version';
COMMENT ON COLUMN documents.collaborators IS 'Array of user IDs with edit permissions';
COMMENT ON COLUMN documents.last_edited_by IS 'User who made the most recent edit';
COMMENT ON COLUMN documents.edit_count IS 'Total number of edits made to this document';
COMMENT ON COLUMN documents.is_template IS 'Whether this document serves as a template';
COMMENT ON COLUMN documents.template_category IS 'Category for template organization';
COMMENT ON COLUMN documents.metadata IS 'Editor preferences, formatting, revision history, etc.';

-- Create indexes for documents table
CREATE INDEX idx_documents_media_blob_id ON documents(media_blob_id);
CREATE INDEX idx_documents_title ON documents(title) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_content_type ON documents(content_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_folder_path ON documents(folder_path) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_is_published ON documents(is_published) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_published_at ON documents(published_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_parent_document_id ON documents(parent_document_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_last_edited_by ON documents(last_edited_by) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_is_template ON documents(is_template) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_template_category ON documents(template_category) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_deleted_at ON documents(deleted_at);
CREATE INDEX idx_documents_active ON documents(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_db_version ON documents(db_version);
CREATE INDEX idx_documents_created_at ON documents(created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_updated_at ON documents(updated_at) WHERE deleted_at IS NULL;

-- Composite indexes for common queries
CREATE INDEX idx_documents_folder_title ON documents(folder_path, title) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_published_content ON documents(is_published, content_type, published_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_template_category_idx ON documents(is_template, template_category) WHERE deleted_at IS NULL;

-- GIN indexes for array and JSONB columns
CREATE INDEX idx_documents_tags ON documents USING GIN(tags) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_collaborators ON documents USING GIN(collaborators) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_metadata ON documents USING GIN(metadata) WHERE deleted_at IS NULL;

-- Create view for active documents
CREATE VIEW active_documents AS
SELECT * FROM documents WHERE deleted_at IS NULL;

-- Create view for documents with file information
CREATE VIEW documents_with_files AS
SELECT
    d.*,
    mb.mime,
    mb.size,
    mb.local_path,
    thumb.id as thumbnail_id,
    thumb.mime as thumbnail_mime,
    thumb.size as thumbnail_size
FROM documents d
JOIN media_blobs mb ON d.media_blob_id = mb.id
LEFT JOIN media_blobs thumb ON d.thumbnail_blob_id = thumb.id
WHERE d.deleted_at IS NULL
AND mb.deleted_at IS NULL;

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_documents_updated_at
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to increment edit count on content changes
CREATE OR REPLACE FUNCTION increment_document_edit_count()
RETURNS TRIGGER AS $$
BEGIN
    -- Only increment if the actual content changed (media_blob_id changed)
    IF OLD.media_blob_id != NEW.media_blob_id THEN
        NEW.edit_count = OLD.edit_count + 1;
        NEW.last_edited_by = NEW.last_edited_by; -- This should be set by application
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to track document edits
CREATE TRIGGER track_document_edits
    BEFORE UPDATE ON documents
    FOR EACH ROW
    EXECUTE FUNCTION increment_document_edit_count();

-- Create function to find documents by folder hierarchy
CREATE OR REPLACE FUNCTION get_documents_in_folder(
    folder_pattern TEXT,
    include_subfolders BOOLEAN DEFAULT false,
    max_results INTEGER DEFAULT 100
)
RETURNS TABLE (
    document_id UUID,
    title TEXT,
    folder_path TEXT,
    content_type TEXT,
    is_published BOOLEAN,
    word_count INTEGER,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        d.id,
        d.title,
        d.folder_path,
        d.content_type,
        d.is_published,
        d.word_count,
        d.updated_at
    FROM documents d
    WHERE d.deleted_at IS NULL
    AND (
        (include_subfolders AND d.folder_path LIKE folder_pattern || '%') OR
        (NOT include_subfolders AND d.folder_path = folder_pattern)
    )
    ORDER BY d.folder_path, d.title
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Create materialized view for books statistics
CREATE MATERIALIZED VIEW books_statistics AS
SELECT
    COUNT(*) as total_books,
    COUNT(*) FILTER (WHERE reading_progress > 0) as books_started,
    COUNT(*) FILTER (WHERE reading_progress >= 100) as books_completed,
    COUNT(*) FILTER (WHERE rating IS NOT NULL) as rated_books,
    COUNT(*) FILTER (WHERE is_favorite = true) as favorite_books,
    COUNT(DISTINCT author) as unique_authors,
    COUNT(DISTINCT series_name) FILTER (WHERE series_name IS NOT NULL) as unique_series,
    COUNT(DISTINCT format) as unique_formats,
    COUNT(DISTINCT language) as unique_languages,
    AVG(rating) as average_rating,
    AVG(reading_progress) as average_progress,
    SUM(page_count) as total_pages,
    SUM(word_count) as total_words
FROM active_books;

-- Create materialized view for documents statistics
CREATE MATERIALIZED VIEW documents_statistics AS
SELECT
    COUNT(*) as total_documents,
    COUNT(*) FILTER (WHERE is_published = true) as published_documents,
    COUNT(*) FILTER (WHERE is_template = true) as template_documents,
    COUNT(DISTINCT content_type) as unique_content_types,
    COUNT(DISTINCT folder_path) as unique_folders,
    COUNT(DISTINCT template_category) FILTER (WHERE template_category IS NOT NULL) as unique_template_categories,
    AVG(word_count) as average_word_count,
    AVG(edit_count) as average_edit_count,
    SUM(word_count) as total_words,
    MAX(edit_count) as max_edit_count
FROM active_documents;

-- Create indexes on materialized views
CREATE UNIQUE INDEX idx_books_statistics_singleton ON books_statistics(total_books);
CREATE UNIQUE INDEX idx_documents_statistics_singleton ON documents_statistics(total_documents);

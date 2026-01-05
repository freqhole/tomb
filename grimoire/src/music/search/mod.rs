//! search module for music discovery using sqlite full-text search
//! simplified replacement for postgresql-based search with sqlite fts5

mod models;
mod service;

// re-export public types
pub use models::{
    SearchFilter, SearchQuery, SearchRequest, SearchResult, SearchType, SongSearchResult,
};
pub use service::{
    create_search_index, rebuild_search_index, search_albums, search_artists, search_songs,
    update_search_index,
};

// placeholder for sqlite fts functionality
// TODO: migrate from legacylib/src/search/ with sqlite fts5
// - full-text search across song titles, artists, albums
// - structured filters (genre, year, rating, etc.)
// - search result ranking and relevance scoring
// - search index maintenance (create, update, rebuild)
// - query parsing and sanitization
// - faceted search capabilities
// - search analytics and suggestions

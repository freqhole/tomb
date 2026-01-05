//! genres module
//! handles genre domain logic

mod models;
mod service;

// re-export public types
pub use models::{
    CreateGenreRequest, CreateSubGenreRequest, Genre, GenreStat, GenreStatsResponse, SubGenre,
};
pub use service::{
    create_genre, create_sub_genre, get_genre, get_genre_stats, get_sub_genre, list_genres,
    list_sub_genres,
};

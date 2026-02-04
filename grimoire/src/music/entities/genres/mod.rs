//! genres module
//! handles genre domain logic

mod models;
mod repository;

// re-export public types
pub use models::{CreateGenreRequest, Genre, GenreStat, GenreWithStats};
pub use repository::{
    add_genre_to_album, create_genre, delete_genre, find_or_create_genre, get_album_genre_ids,
    get_genre, get_genre_stats, list_genres, list_genres_with_stats, query_genres,
    remove_genre_from_album, set_album_genres,
};

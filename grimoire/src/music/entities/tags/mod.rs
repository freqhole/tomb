//! tag entity module

mod models;
mod repository;

pub use models::{CreateTagRequest, Tag};
pub use repository::{
    add_album_tags, create_tag, delete_tag, find_or_create_tag, find_or_create_tags,
    get_album_tags, get_tag, list_tags, query_tags, remove_album_tags, replace_album_tags,
};

//! tag entity module

mod models;
mod repository;

pub use models::{
    AddAlbumsTagsRequest, CreateTagRequest, DeleteTagRequest, GetAlbumsTagsRequest, GetTagRequest,
    QueryTagsRequest, RemoveAlbumsTagsRequest, ReplaceAlbumsTagsRequest, Tag,
};
pub use repository::{
    add_albums_tags, create_tag, delete_tag, find_or_create_tags, get_albums_tags, get_tag,
    list_tags, query_tags, remove_albums_tags, replace_albums_tags,
};

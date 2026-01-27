// local IDB adapter functions
// converts IDB query results to domain types with complete field mapping

import type { AlbumQueryResult } from "../../services/storage/types";
import type { AlbumSummary } from "../types";

// output type: enforces all AlbumSummary fields are mapped
export type LocalAlbumSummary = Required<Pick<AlbumSummary,
  | 'album_id' | 'title' | 'artist_id' | 'artist_name' | 'album_type'
  | 'year' | 'release_date' | 'label' | 'genre_id' | 'song_count' 
  | 'total_duration'
>> & Partial<Pick<AlbumSummary,
  | 'genre' | 'sub_genres' | 'images' | 'is_favorite' | 'user_rating' | 'tags'
>>;

// adapter to convert IDB album query result to domain AlbumSummary type
export function adaptAlbumFromIDB(result: AlbumQueryResult): LocalAlbumSummary {
  return {
    // required fields
    album_id: result.album.album_id,
    title: result.album.title,
    artist_id: result.album.artist_id || "",
    artist_name: result.artist_name,
    album_type: result.album.album_type,
    year: result.album.year ?? undefined,
    release_date: result.album.release_date ?? undefined,
    label: result.album.label ?? undefined,
    genre_id: result.album.genre_id ?? undefined,
    song_count: result.song_count,
    total_duration: result.total_duration,
    
    // optional fields
    genre: result.genre_name,
    sub_genres: result.sub_genres,
    images: result.album.images,
    is_favorite: result.album.is_favorite,
    user_rating: result.album.user_rating,
  };
}

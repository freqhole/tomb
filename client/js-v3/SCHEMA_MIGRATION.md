# normalized schema migration

## what changed

we migrated from a denormalized single-table structure to a normalized multi-table schema matching the server's database design.

### before (v1)
```typescript
// single table: music_songs
{
  id: string,
  title: string,
  artist: string,  // ❌ just a string!
  album: string,   // ❌ just a string!
  duration: number,
  // ... other fields
}
```

**problems:**
- no way to handle multiple artists with same name
- can't query "all albums by this artist" efficiently
- no proper foreign keys
- must load all songs to get artist/album lists

### after (v2)
```typescript
// artists table
{
  artist_id: string,  // ✅ uuid
  name: string,
  created_at: number,
  updated_at: number
}

// albums table
{
  album_id: string,   // ✅ uuid
  title: string,
  artist_id: string,  // ✅ FK to artists
  album_type: string,
  year: number,
  // ...
}

// songs table
{
  song_id: string,    // ✅ uuid
  title: string,
  artist_id: string,  // ✅ FK to artists
  album_id: string,   // ✅ FK to albums
  track_number: number,
  disc_number: number,
  duration: number,
  // local storage fields
  opfs_path: string,
  file_name: string,
  file_size: number,
  // ...
}

// genres, playlists, favorites, ratings tables
```

## benefits

1. **no ambiguity** - different artists with same name have different IDs
2. **efficient queries** - can query albums/songs by artist_id directly
3. **matches server** - same structure as remote api, easy sync
4. **proper normalization** - update artist name once, affects all songs
5. **no loading everything** - can query artists/albums without loading all songs

## migration path

the database version was bumped from 1 → 2, so:

1. **existing users:** idb will run upgrade transaction, creating new tables
2. **old data:** songs in old `music_songs` table will remain (backwards compat)
3. **new data:** all new songs use normalized schema

### automatic migration (todo)

we should add migration logic to convert old songs to new schema:

```typescript
// in upgrade transaction
if (oldVersion < 2) {
  const oldSongs = await db.getAll('music_songs');
  
  for (const oldSong of oldSongs) {
    // create/lookup artist
    const artist = await getOrCreateArtist(oldSong.artist);
    
    // create/lookup album
    const album = await getOrCreateAlbum(
      oldSong.album, 
      artist.artist_id
    );
    
    // create new song with foreign keys
    const newSong: Song = {
      song_id: oldSong.id,
      title: oldSong.title,
      artist_id: artist.artist_id,
      album_id: album.album_id,
      duration: oldSong.duration,
      opfs_path: oldSong.opfs_path,
      // ... map other fields
    };
    
    await db.put(SONGS, newSong);
  }
  
  // optionally: delete old table
  // db.deleteObjectStore('music_songs');
}
```

## file processor changes needed

when processing new files, we now:

1. **extract metadata** (title, artist name, album title)
2. **find or create artist** by name → get artist_id
3. **find or create album** by artist_id + title → get album_id
4. **create song** with artist_id and album_id as foreign keys

```typescript
// old way
const song = {
  id: uuid(),
  title: "song name",
  artist: "artist name",  // ❌ just a string
  album: "album name",    // ❌ just a string
};

// new way
const artist = await getOrCreateArtist("artist name");
const album = await getOrCreateAlbum("album name", artist.artist_id);
const song = {
  song_id: uuid(),
  title: "song name",
  artist_id: artist.artist_id,  // ✅ FK
  album_id: album.album_id,     // ✅ FK
};
```

## data source changes needed

the local data source needs to update its queries to use joins:

```typescript
// query songs with artist + album info
const results = await querySongsWithDetails({
  limit: 50,
  offset: 0
});

// returns: SongQueryResult[]
{
  song: Song,
  artist: Artist,  // ✅ joined
  album: Album,    // ✅ joined
  genre: Genre | null,
  is_favorite: boolean,
  rating: number | null
}
```

## next steps

1. ✅ create normalized schema types
2. ✅ update database initialization with new tables
3. ⏳ update file processor to use new schema
4. ⏳ add migration logic for existing data
5. ⏳ update local data source to use joins
6. ⏳ test with real data

## deduplication improvements

with the new schema, duplicate detection is more robust:

**file identity:**
- `file_name` + `file_size` + `last_modified` (compound index)
- catches exact same file being added twice

**artist/album identity:**
- artist: `name` (unique index)
- album: `artist_id` + `title` (compound unique index)
- prevents duplicate artists/albums with same name

## storage efficiency

**before:** every song stored full artist/album strings
```
song 1: { artist: "The Beatles", album: "Abbey Road" }
song 2: { artist: "The Beatles", album: "Abbey Road" }
song 3: { artist: "The Beatles", album: "Abbey Road" }
// "The Beatles" stored 3 times ❌
```

**after:** artists/albums stored once, referenced by id
```
artist: { artist_id: "uuid1", name: "The Beatles" }
album: { album_id: "uuid2", title: "Abbey Road", artist_id: "uuid1" }
song 1: { artist_id: "uuid1", album_id: "uuid2" }
song 2: { artist_id: "uuid1", album_id: "uuid2" }
song 3: { artist_id: "uuid1", album_id: "uuid2" }
// "The Beatles" stored once ✅
```

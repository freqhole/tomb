//! theaudiodb response models.
//!
//! their json convention is `str*` for strings, `int*` for integers (which
//! arrive as strings, naturally), and `null` for missing fields. we only
//! map fields we actually intend to use; add more as needed.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDbSearchAlbumsResponse {
    /// `null` (deserialized as None) when no matches.
    pub album: Option<Vec<AudioDbAlbum>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDbAlbumLookupResponse {
    pub album: Option<Vec<AudioDbAlbum>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDbArtistLookupResponse {
    pub artists: Option<Vec<AudioDbArtist>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AudioDbAlbum {
    #[serde(rename = "idAlbum")]
    pub id_album: Option<String>,
    #[serde(rename = "idArtist")]
    pub id_artist: Option<String>,
    #[serde(rename = "strAlbum")]
    pub title: Option<String>,
    #[serde(rename = "strArtist")]
    pub artist: Option<String>,
    #[serde(rename = "intYearReleased")]
    pub year_released: Option<String>,
    #[serde(rename = "strGenre")]
    pub genre: Option<String>,
    #[serde(rename = "strSubGenre")]
    pub subgenre: Option<String>,
    #[serde(rename = "strStyle")]
    pub style: Option<String>,
    #[serde(rename = "strMood")]
    pub mood: Option<String>,
    #[serde(rename = "strTheme")]
    pub theme: Option<String>,
    #[serde(rename = "strSpeed")]
    pub speed: Option<String>,
    #[serde(rename = "strLabel")]
    pub label: Option<String>,
    #[serde(rename = "intScore")]
    pub score: Option<String>,
    #[serde(rename = "intScoreVotes")]
    pub score_votes: Option<String>,
    #[serde(rename = "strDescriptionEN")]
    pub description_en: Option<String>,
    #[serde(rename = "strAlbumThumb")]
    pub album_thumb: Option<String>,
    #[serde(rename = "strAlbumThumbHQ")]
    pub album_thumb_hq: Option<String>,
    #[serde(rename = "strAlbumThumbBack")]
    pub album_thumb_back: Option<String>,
    #[serde(rename = "strAlbumCDart")]
    pub album_cdart: Option<String>,
    #[serde(rename = "strAlbumSpine")]
    pub album_spine: Option<String>,
    #[serde(rename = "strAlbum3DCase")]
    pub album_3d_case: Option<String>,
    #[serde(rename = "strMusicBrainzID")]
    pub musicbrainz_release_group_id: Option<String>,
    #[serde(rename = "strMusicBrainzArtistID")]
    pub musicbrainz_artist_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AudioDbArtist {
    #[serde(rename = "idArtist")]
    pub id_artist: Option<String>,
    #[serde(rename = "strArtist")]
    pub name: Option<String>,
    #[serde(rename = "strGenre")]
    pub genre: Option<String>,
    #[serde(rename = "strStyle")]
    pub style: Option<String>,
    #[serde(rename = "strMood")]
    pub mood: Option<String>,
    #[serde(rename = "strBiographyEN")]
    pub biography_en: Option<String>,
    #[serde(rename = "strCountry")]
    pub country: Option<String>,
    #[serde(rename = "intFormedYear")]
    pub formed_year: Option<String>,
    #[serde(rename = "strArtistThumb")]
    pub artist_thumb: Option<String>,
    #[serde(rename = "strArtistFanart")]
    pub artist_fanart: Option<String>,
    #[serde(rename = "strMusicBrainzID")]
    pub musicbrainz_artist_id: Option<String>,
}

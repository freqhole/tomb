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
    /// audiodb's english description lives in the unsuffixed
    /// `strDescription` field. the `strDescription{DE,FR,...}` siblings
    /// hold translations. there is NO `strDescriptionEN`; reading from
    /// it would always yield None (was a real bug — fixed).
    #[serde(rename = "strDescription")]
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
    // ---- additional fields surfaced after the api-sample audit ----
    #[serde(rename = "strReview")]
    pub review: Option<String>,
    #[serde(rename = "strDiscogsID")]
    pub discogs_id: Option<String>,
    #[serde(rename = "strItunesID")]
    pub itunes_id: Option<String>,
    #[serde(rename = "strAmazonID")]
    pub amazon_id: Option<String>,
    #[serde(rename = "strAllMusicID")]
    pub allmusic_id: Option<String>,
    #[serde(rename = "strWikipediaID")]
    pub wikipedia_id: Option<String>,
    #[serde(rename = "strWikidataID")]
    pub wikidata_id: Option<String>,
    #[serde(rename = "strLocation")]
    pub location: Option<String>,
    #[serde(rename = "strAlbumBack")]
    pub album_back: Option<String>,
    #[serde(rename = "strAlbum3DFace")]
    pub album_3d_face: Option<String>,
    #[serde(rename = "strAlbum3DFlat")]
    pub album_3d_flat: Option<String>,
    #[serde(rename = "strAlbum3DThumb")]
    pub album_3d_thumb: Option<String>,
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
    /// audiodb's english biography lives in the unsuffixed
    /// `strBiography` field. the `strBiography{DE,FR,...}` siblings
    /// hold translations. there is NO `strBiographyEN`; reading from
    /// it would always yield None (was a real bug — fixed).
    #[serde(rename = "strBiography")]
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
    // ---- additional fields surfaced after the api-sample audit ----
    #[serde(rename = "strLabel")]
    pub label: Option<String>,
    #[serde(rename = "strWebsite")]
    pub website: Option<String>,
    #[serde(rename = "strFacebook")]
    pub facebook: Option<String>,
    #[serde(rename = "strTwitter")]
    pub twitter: Option<String>,
    #[serde(rename = "intBornYear")]
    pub born_year: Option<String>,
    #[serde(rename = "intDiedYear")]
    pub died_year: Option<String>,
    #[serde(rename = "strDisbanded")]
    pub disbanded: Option<String>,
    #[serde(rename = "intMembers")]
    pub members: Option<String>,
    #[serde(rename = "strGender")]
    pub gender: Option<String>,
    #[serde(rename = "strCountryCode")]
    pub country_code: Option<String>,
    #[serde(rename = "strArtistLogo")]
    pub artist_logo: Option<String>,
    #[serde(rename = "strArtistCutout")]
    pub artist_cutout: Option<String>,
    #[serde(rename = "strArtistClearart")]
    pub artist_clearart: Option<String>,
    #[serde(rename = "strArtistWideThumb")]
    pub artist_wide_thumb: Option<String>,
    #[serde(rename = "strArtistFanart2")]
    pub artist_fanart_2: Option<String>,
    #[serde(rename = "strArtistFanart3")]
    pub artist_fanart_3: Option<String>,
    #[serde(rename = "strArtistFanart4")]
    pub artist_fanart_4: Option<String>,
    #[serde(rename = "strArtistBanner")]
    pub artist_banner: Option<String>,
    #[serde(rename = "intCharted")]
    pub charted: Option<String>,
}

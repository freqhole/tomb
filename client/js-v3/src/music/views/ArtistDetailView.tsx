// artist detail view - shows artist info with songs grouped by album
import { useNavigate, useParams } from "@solidjs/router";
import { createMemo, Show } from "solid-js";
import { setQueue } from "../../app/services/storage/db";
import { ArtistDetailPanel } from "../../components/artists/ArtistDetailPanel";
import { DetailViewWrapper } from "../../components/layout/DetailViewWrapper";
import { getDataSource } from "../data";
import { showArtistEditor, showImageCarousel } from "../modals";
import { useArtistQuery, useArtistSongsQuery } from "../queries/songs";
import { useSetRatingMutation } from "../queries/ratings";
import { useToggleFavoriteMutation } from "../queries/favorites";
import { playSong } from "../services/audio/player";
import { buildRoute } from "../utils/routing";
import { sortSongsCanonical } from "../utils/songSort";

export function ArtistDetailView() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();

  // fetch artist entity to get favorite status and metadata
  const artistQuery = useArtistQuery(() => params.id);

  // rating mutation
  const setRatingMutation = useSetRatingMutation();

  // favorite mutation
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  // fetch artist songs using tanstack query (works with local + remote)
  const artistSongsQuery = useArtistSongsQuery(() => params.id);

  // map to song array
  const songs = createMemo(() => {
    const result = artistSongsQuery.data;
    if (!result || result.items.length === 0) return [];
    return result.items;
  });

  // artist data for panel
  const artistData = createMemo(() => {
    const artist = artistQuery.data;
    const songList = songs();

    if (!artist || songList.length === 0) return null;

    return {
      artist_id: artist.artist_id,
      name: artist.name,
      bio: artist.bio,
      song_count: songList.length,
      album_count: new Set(songList.map((s) => s.album_id)).size,
      total_duration: songList.reduce((sum, song) => sum + song.duration_seconds, 0),
      images: artist.images,
      is_favorite: artist.is_favorite,
    };
  });

  // play all artist songs
  const handlePlayArtist = async () => {
    const songList = songs();
    if (songList.length === 0) return;

    await setQueue(songList);
    await playSong(songList[0]);
  };

  // shuffle all songs
  const handleShuffleArtist = async () => {
    const songList = songs();
    if (songList.length === 0) return;

    const shuffled = [...songList].sort(() => Math.random() - 0.5);
    await setQueue(shuffled);
    await playSong(shuffled[0]);
  };

  // add all songs to queue
  const handleAddArtistToQueue = async () => {
    const songList = songs();
    if (songList.length === 0) return;

    const currentQueue = songs() ?? [];
    await setQueue([...currentQueue, ...songList]);
  };

  // play specific album
  const handlePlayAlbum = async (albumId: string) => {
    const albumSongs = songs().filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(albumSongs);

    await setQueue(sortedSongs);
    await playSong(sortedSongs[0]);
  };

  // add album to queue
  const handleAddAlbumToQueue = async (albumId: string) => {
    const albumSongs = songs().filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(albumSongs);

    const currentQueue = songs() ?? [];
    await setQueue([...currentQueue, ...sortedSongs]);
  };

  const handleSongDoubleClick = async (songId: string, albumId: string) => {
    // set queue to all album songs and play the clicked one
    const albumSongs = songs().filter((s) => s.album_id === albumId);
    const sortedSongs = sortSongsCanonical(albumSongs);

    await setQueue(sortedSongs);
    await playSong(songId);
  };

  const handleAlbumClick = (albumId: string) => {
    navigate(buildRoute(`/albums/${albumId}`));
  };

  const handleEditArtist = () => {
    const artist = artistData();
    if (artist) {
      showArtistEditor({ artistId: artist.artist_id });
    }
  };

  // handle rating change
  const handleRatingChange = (rating: number) => {
    setRatingMutation.mutate({
      targetType: "artist",
      targetId: params.id,
      rating,
    });
  };

  // handle song rating change
  const handleSongRatingChange = (songId: string, rating: number) => {
    setRatingMutation.mutate({
      targetType: "song",
      targetId: songId,
      rating,
    });
  };

  // handle album rating change
  const handleAlbumRatingChange = (albumId: string, rating: number) => {
    setRatingMutation.mutate({
      targetType: "album",
      targetId: albumId,
      rating,
    });
  };

  // handle album favorite toggle
  const handleAlbumFavoriteToggle = (albumId: string, isFavorite: boolean) => {
    toggleFavoriteMutation.mutate({
      targetType: "album",
      targetId: albumId,
      isFavorite,
    });
  };

  // handle artist favorite toggle
  const handleArtistFavoriteToggle = (isFavorite: boolean) => {
    toggleFavoriteMutation.mutate({
      targetType: "artist",
      targetId: params.id,
      isFavorite,
    });
  };

  // handle song favorite toggle
  const handleSongFavoriteToggle = (songId: string, isFavorite: boolean) => {
    const song = songs().find((s) => s.id === songId);
    toggleFavoriteMutation.mutate({
      targetType: "song",
      targetId: songId,
      sha256: song?.sha256,
      isFavorite,
    });
  };

  // handle artist image click - show all artist, album, and song images in carousel
  const handleArtistImageClick = async () => {
    const artist = artistData();
    if (!artist) return;

    const songList = songs();
    const imageMap = new Map<string, string>();

    // add all artist images (except waveforms), deduplicate by blob_id
    if (artist.images?.length) {
      for (const img of artist.images) {
        if (img.blob_type !== "waveform") {
          const blobId = img.remote_blob_id || img.local_blob_id;
          const url = img.remote_url || img.local_blob_id;
          if (blobId && url) imageMap.set(blobId, url);
        }
      }
    }

    // collect all song and album images (except waveforms), deduplicate by blob_id
    for (const song of songList) {
      if (song.images?.length) {
        for (const img of song.images) {
          if (img.blob_type !== "waveform") {
            const blobId = img.remote_blob_id || img.local_blob_id;
            const url = img.remote_url || img.local_blob_id;
            if (blobId && url) imageMap.set(blobId, url);
          }
        }
      }
    }

    const imageUrls = Array.from(imageMap.values());

    if (imageUrls.length === 0) {
      console.warn("no images found for artist");
      return;
    }

    showImageCarousel({
      images: imageUrls,
      title: `${artist.name} images`,
    });
  };

  // navigate to genre detail
  const handleGenreClick = (genreId: string, genreName: string) => {
    navigate(buildRoute(`/genres/${genreId}`));
  };

  return (
    <DetailViewWrapper
      pageTitle="artist"
      pageCount={songs().length}
      onBack={buildRoute("/artists")}
    >
      <Show when={artistData()} fallback={<div class="p-4">loading...</div>}>
        {(artist) => {
          const songList = songs();
          return (
            <ArtistDetailPanel
              artist={artist()}
              songs={songList}
              onPlayAll={handlePlayArtist}
              onShuffle={handleShuffleArtist}
              onAddToQueue={handleAddArtistToQueue}
              onAlbumFavoriteToggle={handleAlbumFavoriteToggle}
              onFavoriteToggle={handleArtistFavoriteToggle}
              onAlbumClick={handleAlbumClick}
              onPlayAlbum={handlePlayAlbum}
              onAddAlbumToQueue={handleAddAlbumToQueue}
              onSongDoubleClick={handleSongDoubleClick}
              getSongData={(songId) => songs().find((s) => s.id === songId)}
              onEditArtist={handleEditArtist}
              onRatingChange={handleRatingChange}
              onSongRatingChange={handleSongRatingChange}
              onSongFavoriteToggle={handleSongFavoriteToggle}
              onAlbumRatingChange={handleAlbumRatingChange}
              onImageClick={handleArtistImageClick}
              onGenreClick={handleGenreClick}
            />
          );
        }}
      </Show>
    </DetailViewWrapper>
  );
}

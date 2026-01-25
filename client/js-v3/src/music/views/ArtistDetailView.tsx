// artist detail view - shows artist info with songs grouped by album
import { useNavigate, useParams } from "@solidjs/router";
import { createMemo, Show } from "solid-js";
import { setQueue } from "../../app/services/storage/db";
import { ArtistDetailPanel } from "../../components/artists/ArtistDetailPanel";
import { getCurrentRemote } from "../data";
import { showArtistEditor, showImageCarousel } from "../modals";
import { useArtistQuery, useArtistSongsQuery } from "../queries/songs";
import { playSong } from "../services/audio/player";
import { getBlobImageUrl } from "../utils/images";
import { buildRoute } from "../utils/routing";
import { sortSongsCanonical } from "../utils/songSort";
import * as api from "freqhole-api-client";

export function ArtistDetailView() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();

  // fetch artist entity to get favorite status and metadata
  const artistQuery = useArtistQuery(() => params.id);

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
      album_count: new Set(songList.map(s => s.album_id)).size,
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

  // handle artist image click - show all artist images in carousel
  const handleArtistImageClick = async () => {
    const artist = artistData();
    if (!artist) return;

    try {
      const remote = getCurrentRemote();
      if (!remote) return;
      
      const result = await api.music.getArtistImages(remote.base_url, { id: artist.artist_id });
      if (!result.success) {
        console.error("failed to fetch artist images");
        return;
      }
      
      const imageUrls = result.data.map(id => getBlobImageUrl(id)!).filter(Boolean);
      
      if (imageUrls.length > 0) {
        showImageCarousel({
          images: imageUrls,
          title: `${artist.name} images`,
        });
      }
    } catch (error) {
      console.error("failed to fetch artist images:", error);
    }
  };

  return (
    <div class="flex flex-col h-full">
      <Show when={artistData()} fallback={<div class="p-4">loading...</div>}>
        {(artist) => (
          <ArtistDetailPanel
            artist={artist()}
            songs={songs()}
            onPlayAll={handlePlayArtist}
            onShuffle={handleShuffleArtist}
            onAddToQueue={handleAddArtistToQueue}
            onAlbumClick={handleAlbumClick}
            onPlayAlbum={handlePlayAlbum}
            onAddAlbumToQueue={handleAddAlbumToQueue}
            onSongDoubleClick={handleSongDoubleClick}
            getSongData={(songId) => songs().find(s => s.id === songId)}
            onEditArtist={handleEditArtist}
            onImageClick={handleArtistImageClick}
          />
        )}
      </Show>
    </div>
  );
}
// storybook stories for VirtualGenreDetail component
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { VirtualGenreDetailSong } from "../src/components/virtualized/VirtualGenreDetail";
import { VirtualGenreDetail } from "../src/components/virtualized/VirtualGenreDetail";
import {
  getAlbumsByArtist,
  getSongsByAlbum,
  mockAlbums,
  mockSongs,
} from "./mockData";

const meta = {
  title: "Components/Virtualized/VirtualGenreDetail",
  component: VirtualGenreDetail,
  tags: ["autodocs"],
  argTypes: {
    songs: { control: false }, // disable control to reduce clutter
    onAlbumClick: { action: "album clicked" },
    onPlayAlbum: { action: "play album" },
    onArtistClick: { action: "artist clicked" },
    gridColumns: { control: "number" },
  },
} satisfies Meta<typeof VirtualGenreDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

// helper to convert mock songs to VirtualGenreDetailSong format
function convertMockSongs(songs: typeof mockSongs): VirtualGenreDetailSong[] {
  return songs.map((song, index) => ({
    sha256: song.id,
    title: song.title,
    artist_id: `artist-${song.artist}`,
    artist_name: song.artist,
    album_id: `album-${song.album}`,
    album_title: song.album,
    duration_seconds: song.durationSeconds,
    year: 1970 + Math.floor(Math.random() * 50),
    thumbnail_blob_id: null,
  }));
}

// generate songs from mock albums to ensure proper grouping
function generateGenreSongs(albumCount: number = 20): VirtualGenreDetailSong[] {
  const songs: VirtualGenreDetailSong[] = [];
  const albums = mockAlbums.slice(0, albumCount);

  albums.forEach((album) => {
    const albumSongs = getSongsByAlbum(album.title);
    albumSongs.forEach((song, index) => {
      songs.push({
        sha256: song.id,
        title: song.title,
        artist_id: `artist-${album.artist}`,
        artist_name: album.artist,
        album_id: album.id,
        album_title: album.title,
        duration_seconds: song.durationSeconds,
        year: album.year,
      });
    });
  });

  return songs;
}

export const Default: Story = {
  args: {
    songs: generateGenreSongs(30),
    height: 600,
    gridColumns: 5,
  },
};

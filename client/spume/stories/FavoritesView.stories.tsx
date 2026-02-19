import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { FavoritesLayout, type FavoriteItem } from "../src/components/layout/FavoritesLayout";
import { mockFavorites } from "./mockData";

const meta = {
  title: "Layout/FavoritesView",
  component: FavoritesLayout,
  tags: ["autodocs"],
} satisfies Meta<typeof FavoritesLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [favorites, setFavorites] = createSignal<FavoriteItem[]>(mockFavorites);

    // helper to get ID from favorite item
    const getId = (item: FavoriteItem): string => {
      if (item.type === "song") return item.id;
      if (item.type === "album") return item.album_id;
      if (item.type === "artist") return item.artist_id;
      if (item.type === "playlist") return item.playlist_id;
      return "";
    };

    return (
      <FavoritesLayout
        favorites={favorites()}
        height={window.innerHeight}
        onSongClick={(song) => console.log("song click:", song)}
        onSongPlay={(song) => console.log("song play:", song)}
        onSongFavoriteToggle={(songId, isFavorite) => {
          console.log("song favorite toggle:", songId, isFavorite);
          if (!isFavorite) {
            setFavorites((prev) => prev.filter((fav) => getId(fav) !== songId));
          }
        }}
        onAlbumClick={(album) => console.log("album click:", album)}
        onAlbumPlay={(album) => console.log("album play:", album)}
        onAlbumFavoriteToggle={(albumId, isFavorite) => {
          console.log("album favorite toggle:", albumId, isFavorite);
          if (!isFavorite) {
            setFavorites((prev) => prev.filter((fav) => getId(fav) !== albumId));
          }
        }}
        onArtistClick={(artist) => console.log("artist click:", artist)}
        onArtistPlay={(artist) => console.log("artist play:", artist)}
        onArtistFavoriteToggle={(artistId, isFavorite) => {
          console.log("artist favorite toggle:", artistId, isFavorite);
          if (!isFavorite) {
            setFavorites((prev) => prev.filter((fav) => getId(fav) !== artistId));
          }
        }}
        onPlaylistClick={(playlist) => console.log("playlist click:", playlist)}
        onPlaylistPlay={(playlist) => console.log("playlist play:", playlist)}
        onPlaylistFavoriteToggle={(playlistId, isFavorite) => {
          console.log("playlist favorite toggle:", playlistId, isFavorite);
          if (!isFavorite) {
            setFavorites((prev) => prev.filter((fav) => getId(fav) !== playlistId));
          }
        }}
        onArtistNavigate={(artistId) => console.log("navigate to artist:", artistId)}
        onAlbumNavigate={(albumId) => console.log("navigate to album:", albumId)}
        onGenreClick={(genre) => console.log("genre click:", genre)}
      />
    );
  },
};

export const Loading: Story = {
  args: {
    favorites: [],
    isLoading: true,
    height: 600,
  },
};

export const Empty: Story = {
  args: {
    favorites: [],
    isLoading: false,
    height: 600,
  },
};

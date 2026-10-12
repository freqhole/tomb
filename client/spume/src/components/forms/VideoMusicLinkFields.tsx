// artist + album pickers for music_video/karaoke videos, shared by
// EditVideoModal.tsx and the import review's ImportVideoEditorPanel.tsx
// (mirrors how VideoSeriesAutocomplete/VideoSeasonAutocomplete serve both
// for series).
//
// state is name-based on purpose: an artist/album picked from the dropdown
// carries its id, anything else typed in is sent by name and found-or-created
// (case-insensitively) server-side when the video is saved - so a guessed
// artist prefill and a hand-typed "create new" row behave identically, and
// no artist/album row exists until the save actually happens. an empty album
// means "the artist's default album" ("music videos"/"karaoke videos").
import { Show } from "solid-js";
import { ArtistAutocomplete } from "./ArtistAutocomplete";
import { AlbumAutocomplete } from "./AlbumAutocomplete";
import { defaultAlbumTitle, isMusicContentType } from "../../video/utils/contentType";
import { guessVideoTitle } from "../../video/services/guessVideoTitle";

export interface VideoMusicLink {
  /** existing artist picked from the dropdown. */
  artistId: string | null;
  /** artist display text - also the by-name find-or-create value when no
   * `artistId` is set. */
  artistName: string;
  albumId: string | null;
  albumTitle: string;
  /** true while the artist is a prefill from the title guess (shows a hint,
   * dropped as soon as the user picks/clears something themselves). */
  guessed?: boolean;
}

export const EMPTY_MUSIC_LINK: VideoMusicLink = {
  artistId: null,
  artistName: "",
  albumId: null,
  albumTitle: "",
};

/** build a `VideoMusicLink` from a video's resolved artist/album rows. */
export function musicLinkFromVideo(video: {
  artistId?: string | null;
  artistName?: string | null;
  albumId?: string | null;
  albumTitle?: string | null;
}): VideoMusicLink {
  return {
    artistId: video.artistId ?? null,
    artistName: video.artistName ?? "",
    albumId: video.albumId ?? null,
    albumTitle: video.albumTitle ?? "",
  };
}

/** best-guess artist from a video's title, as a `VideoMusicLink` to prefill
 * the pickers with - null when nothing useful could be guessed. */
export async function guessMusicLink(title: string): Promise<VideoMusicLink | null> {
  const guess = await guessVideoTitle(title);
  if (!guess?.artist) return null;
  return { ...EMPTY_MUSIC_LINK, artistName: guess.artist, guessed: true };
}

/** the artist/album fields of an update-video request for the given link.
 * the link is always the literal desired final state: no artist clears
 * both, no album picks the artist's default album. */
export function musicLinkToUpdateFields(link: VideoMusicLink) {
  const artistName = link.artistName.trim();
  const albumTitle = link.albumTitle.trim();
  return {
    artist_id: link.artistId,
    artist_name: link.artistId ? null : artistName || null,
    album_id: link.albumId,
    album_title: link.albumId ? null : albumTitle || null,
    clear_artist_id: !link.artistId && !artistName,
    clear_album_id: !link.albumId && !albumTitle,
  };
}

export interface VideoMusicLinkFieldsProps {
  /** "music_video" | "karaoke" - decides the default-album hint. */
  contentType: string;
  value: VideoMusicLink;
  onChange: (next: VideoMusicLink) => void;
  disabled?: boolean;
}

// an id no artist can have: filters the album dropdown down to nothing but
// "create new" while the artist is only a typed (not yet existing) name.
const NO_ARTIST_ID = "no-such-artist";

export function VideoMusicLinkFields(props: VideoMusicLinkFieldsProps) {
  const hasArtist = () => !!(props.value.artistId || props.value.artistName.trim());
  const defaultAlbum = () => defaultAlbumTitle(props.contentType);

  const handleArtistSelect = (selection: { id?: string; name: string; isNew: boolean }) => {
    const sameArtist = !selection.isNew && selection.id && selection.id === props.value.artistId;
    props.onChange({
      artistId: selection.isNew ? null : (selection.id ?? null),
      artistName: selection.name,
      // a different artist invalidates the album picked for the old one
      albumId: sameArtist ? props.value.albumId : null,
      albumTitle: sameArtist ? props.value.albumTitle : "",
    });
  };

  const handleClearArtist = () => props.onChange({ ...EMPTY_MUSIC_LINK });

  const handleAlbumSelect = (selection: { id?: string; title: string; isNew: boolean }) => {
    props.onChange({
      ...props.value,
      guessed: false,
      albumId: selection.isNew ? null : (selection.id ?? null),
      albumTitle: selection.title,
    });
  };

  const handleClearAlbum = () => props.onChange({ ...props.value, albumId: null, albumTitle: "" });

  const artistHint = () => {
    const { artistId, artistName, guessed } = props.value;
    if (artistId || !artistName.trim()) return undefined;
    return guessed
      ? `"${artistName}" guessed from the title - pick an existing artist or press enter to confirm. an artist with this name is reused, otherwise it's created on save`
      : `"${artistName}" will be matched by name, or created as a new artist on save`;
  };

  const albumHint = () => {
    if (!isMusicContentType(props.contentType)) return undefined;
    if (props.value.albumId || props.value.albumTitle.trim()) {
      return !props.value.albumId
        ? `"${props.value.albumTitle}" will be created as a new album on save`
        : undefined;
    }
    return defaultAlbum() ? `leave empty to use the "${defaultAlbum()}" album` : undefined;
  };

  return (
    <div class="space-y-4">
      <div>
        <ArtistAutocomplete
          label="artist"
          value={props.value.artistName}
          onSelect={handleArtistSelect}
          placeholder="search or type artist name..."
          hint={artistHint()}
          disabled={props.disabled}
        />
        <Show when={hasArtist()}>
          <button
            type="button"
            onClick={handleClearArtist}
            disabled={props.disabled}
            class="mt-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
          >
            remove artist
          </button>
        </Show>
      </div>

      <Show when={hasArtist()}>
        <div>
          <AlbumAutocomplete
            label="album"
            value={props.value.albumTitle}
            onSelect={handleAlbumSelect}
            artistId={() => props.value.artistId ?? NO_ARTIST_ID}
            placeholder={defaultAlbum() ?? "search or type album title..."}
            hint={albumHint()}
            disabled={props.disabled}
          />
          <Show when={props.value.albumId || props.value.albumTitle.trim()}>
            <button
              type="button"
              onClick={handleClearAlbum}
              disabled={props.disabled}
              class="mt-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            >
              use default album
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

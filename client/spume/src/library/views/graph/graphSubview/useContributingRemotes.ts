import type { Remote } from "../../../../app/services/storage/schemas/remote";
import type { AlbumNodeData, ArtistNodeData } from "../../../../components/graph/types";
import type { ContributingRemote } from "../../../../components/graph/RemoteSplitButton";
import { slug } from "../../../../components/graph/data/nodeIds";

export interface ContributingRemotesDeps {
  remotes: () => Remote[];
  artistsByRemote: () => Map<string, ArtistNodeData[]>;
  nodesByRemote: () => Map<string, AlbumNodeData[]>;
}

export function createContributingRemotes(deps: ContributingRemotesDeps) {
  const { remotes, artistsByRemote, nodesByRemote } = deps;

  const toContributingRemote = (r: Remote): ContributingRemote => ({
    id: r.remote_id,
    name: r.name,
    isCharnelManaged: !!r.is_charnel_managed,
    imageUrl: r.image_url ?? null,
  });
  const sortContributingRemotes = (refs: ContributingRemote[]): ContributingRemote[] =>
    [...refs].sort((a, b) => {
      if (!!a.isCharnelManaged !== !!b.isCharnelManaged) {
        return a.isCharnelManaged ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  const contributingRemotesForArtist = (artist: ArtistNodeData): ContributingRemote[] => {
    const target = slug(artist.name);
    if (!target) return [];
    const out: ContributingRemote[] = [];
    const byRemote = artistsByRemote();
    for (const r of remotes()) {
      const list = byRemote.get(r.remote_id) ?? [];
      if (list.some((a) => slug(a.name) === target)) {
        out.push(toContributingRemote(r));
      }
    }
    return sortContributingRemotes(out);
  };
  const contributingRemotesForAlbum = (album: AlbumNodeData): ContributingRemote[] => {
    const targetTitle = slug(album.title);
    const targetArtist = slug(album.artistName ?? "");
    if (!targetTitle) return [];
    const out: ContributingRemote[] = [];
    const byRemote = nodesByRemote();
    for (const r of remotes()) {
      const list = byRemote.get(r.remote_id) ?? [];
      if (
        list.some((a) => slug(a.title) === targetTitle && slug(a.artistName ?? "") === targetArtist)
      ) {
        out.push(toContributingRemote(r));
      }
    }
    return sortContributingRemotes(out);
  };
  const resolvePickedRemote = (
    picked: string | undefined,
    fallback: Remote | undefined
  ): Remote | undefined => {
    if (picked) {
      const match = remotes().find((r) => r.remote_id === picked);
      if (match) return match;
    }
    return fallback;
  };

  const artistForRemote = (artist: ArtistNodeData, remoteId: string): ArtistNodeData => {
    const target = slug(artist.name);
    if (!target) return artist;
    const list = artistsByRemote().get(remoteId);
    if (!list) return artist;
    const found = list.find((a) => slug(a.name) === target);
    return found ?? artist;
  };

  const albumForRemote = (album: AlbumNodeData, remoteId: string): AlbumNodeData => {
    const targetTitle = slug(album.title);
    const targetArtist = slug(album.artistName ?? "");
    if (!targetTitle) return album;
    const list = nodesByRemote().get(remoteId);
    if (!list) return album;
    const found = list.find(
      (a) => slug(a.title) === targetTitle && slug(a.artistName ?? "") === targetArtist
    );
    return found ?? album;
  };

  return {
    contributingRemotesForArtist,
    contributingRemotesForAlbum,
    resolvePickedRemote,
    artistForRemote,
    albumForRemote,
  };
}

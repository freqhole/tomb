// fetch the authoritative album before sending, rather than reconstructing
// it from a song projection that omits album metadata and external links.
import {
  FreqholeClient,
  type EntityUrl,
  type TaxonRef,
  type Transport,
} from "@freqhole/api-client";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { ImageMetadata } from "../storage/types";
import { getAlbumById, getAlbumTaxons, getAlbumTags, getGenreById } from "../storage/db";
import { isLocalBrowserSourceRemote } from "./localBrowserSource";

export interface AlbumSendMetadata {
  title: string;
  albumType: string;
  releaseDate?: string | null;
  label?: string | null;
  genres: string[];
  taxons: TaxonRef[];
  metadata?: string | null;
  entityUrls: EntityUrl[];
  images: ImageMetadata[];
  tags?: string[];
}

export async function loadAlbumSendMetadata(
  albumId: string,
  source: Remote,
  transport: Transport
): Promise<AlbumSendMetadata> {
  if (isLocalBrowserSourceRemote(source)) {
    const [album, taxonRows, tags] = await Promise.all([
      getAlbumById(albumId),
      getAlbumTaxons(albumId),
      getAlbumTags(albumId),
    ]);
    if (!album) throw new Error(`source album not found: ${albumId}`);
    const taxons = taxonRows.map((taxon) => ({
      id: taxon.taxon_id,
      kind_slug: taxon.kind_slug,
      label: taxon.label,
    }));
    const genres = taxons
      .filter((taxon) => taxon.kind_slug === "genre")
      .map((taxon) => taxon.label);
    if (album.genre_id && genres.length === 0) {
      const genre = await getGenreById(album.genre_id);
      if (genre) genres.push(genre.name);
    }
    return {
      title: album.title,
      albumType: album.album_type,
      releaseDate: album.release_date,
      label: album.label,
      genres,
      taxons,
      metadata: album.metadata,
      entityUrls: album.urls ?? [],
      images: album.images ?? [],
      tags: tags.map((tag) => tag.name),
    };
  }
  const client = new FreqholeClient(transport);
  const [result, tagResult] = await Promise.all([
    client.music.getAlbum({ id: albumId }),
    client.music.getAlbumsTags({ album_ids: [albumId] }),
  ]);
  if (!result.success) throw new Error(`failed to load source album metadata: ${result.error}`);
  if (!tagResult.success) throw new Error(`failed to load source album tags: ${tagResult.error}`);
  const album = result.data;
  return {
    title: album.title,
    albumType: album.album_type,
    releaseDate: album.release_date,
    label: album.label,
    genres: album.genres?.map((genre) => genre.name) ?? [],
    taxons: album.taxons ?? [],
    metadata: album.metadata,
    entityUrls: album.urls ?? [],
    tags: tagResult.data.map((tag) => tag.name),
    images: (album.images ?? []).map((image) => ({
      remote_blob_id: image.blob_id,
      is_primary: !!image.is_primary,
      blob_type: image.blob_type,
    })),
  };
}

// local taxon-kind metadata CRUD (see `TaxonKindRow` doc comment in
// `../types` for why this is a separate store from `taxons`).
import { initMusicDB } from "./init";
import { STORE_TAXON_KINDS, type TaxonKindRow } from "../types";

export async function createTaxonKind(input: {
  kind_slug: string;
  domain: string;
  label: string;
  description?: string | null;
  color?: string | null;
  value_type?: string | null;
  unit?: string | null;
  display_order?: number | null;
}): Promise<TaxonKindRow> {
  const db = await initMusicDB();
  const existing = (await db.get(STORE_TAXON_KINDS, [input.domain, input.kind_slug])) as
    TaxonKindRow | undefined;
  if (existing) return existing;

  const row: TaxonKindRow = {
    kind_slug: input.kind_slug,
    domain: input.domain,
    label: input.label,
    description: input.description ?? null,
    color: input.color ?? null,
    value_type: input.value_type ?? "categorical",
    unit: input.unit ?? null,
    display_order: input.display_order ?? 0,
    created_at: Date.now(),
  };
  await db.put(STORE_TAXON_KINDS, row);
  return row;
}

export async function getTaxonKindsForDomain(domain: string): Promise<TaxonKindRow[]> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_TAXON_KINDS).store.index("by_domain");
  return index.getAll(domain);
}

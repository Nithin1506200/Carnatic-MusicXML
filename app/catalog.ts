import { catalogUrl, scoreGroups } from "./generated-content";

/**
 * The score catalog: every score's title and headline metadata, grouped by
 * the directories under scores/. It is a lazily fetched, dictionary-encoded
 * JSON file built by `scripts/build-index.mjs`; nothing per score is in the
 * entry bundle, so 15,000 scores cost one ~250 kB gzipped request the first
 * time a score group is expanded.
 */

export interface CatalogFile {
  groups: string[];
  ragas: string[];
  composers: string[];
  talas: string[];
  /** [slug, title, group index, raga index, composer index, tala index] */
  scores: [string, string, number, number, number, number][];
}

export interface CatalogEntry {
  id: string;
  slug: string;
  group: string;
  title: string;
  raga: string;
  composer: string;
  tala: string;
  contentUrl: string;
}

export interface Catalog {
  byId: Map<string, CatalogEntry>;
  byGroup: Map<string, CatalogEntry[]>;
}

export const isScoreId = (id: string) => id.startsWith("scores/");

export const scoreContentUrl = (id: string) => `/generated-content/${id}.json`;

/** Group key of a score id (`scores/04_kritis/...` → `04_kritis`). */
export const scoreGroupOf = (id: string) => id.split("/")[1] ?? "";

export const scoreGroupLabel = (key: string) =>
  scoreGroups.find((group) => group.key === key)?.label ?? key;

/** Turns the last path segment of a score id into a readable fallback title. */
export const humanizeSlug = (id: string) =>
  (id.split("/").at(-1) ?? id)
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");

/** Decodes the columnar catalog file into lookup maps. Rows arrive sorted. */
export const decodeCatalog = (file: CatalogFile): Catalog => {
  const pick = (values: string[], index: number) =>
    index >= 0 ? (values[index] ?? "") : "";
  const byId = new Map<string, CatalogEntry>();
  const byGroup = new Map<string, CatalogEntry[]>();
  for (const key of file.groups) byGroup.set(key, []);
  for (const [slug, title, group, raga, composer, tala] of file.scores) {
    const groupKey = file.groups[group] ?? "";
    const id = `scores/${groupKey}/${slug}`;
    const entry: CatalogEntry = {
      id,
      slug,
      group: groupKey,
      title,
      raga: pick(file.ragas, raga),
      composer: pick(file.composers, composer),
      tala: pick(file.talas, tala),
      contentUrl: scoreContentUrl(id),
    };
    byId.set(id, entry);
    let list = byGroup.get(groupKey);
    if (!list) {
      list = [];
      byGroup.set(groupKey, list);
    }
    list.push(entry);
  }
  return { byId, byGroup };
};

/** "Kalyani · Adi · Tyagaraja" — the parts that exist, in that order. */
export const entrySubtitle = (entry: Pick<CatalogEntry, "raga" | "tala" | "composer">) =>
  [entry.raga, entry.tala, entry.composer].filter(Boolean).join(" · ");

let catalogPromise: Promise<Catalog> | null = null;

/** Fetches and decodes the catalog once per page load. */
export const loadCatalog = (): Promise<Catalog> => {
  catalogPromise ??= fetch(catalogUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Catalog request failed (${response.status})`);
      }
      return response.json() as Promise<CatalogFile>;
    })
    .then(decodeCatalog)
    .catch((error: unknown) => {
      catalogPromise = null;
      throw error;
    });
  return catalogPromise;
};

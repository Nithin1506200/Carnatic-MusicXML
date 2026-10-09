import fs from "node:fs";
import path from "node:path";

/**
 * Builders for the two lazily loaded library files the app fetches on
 * demand instead of bundling every score into the entry chunk:
 *
 * - the catalog (`app/generated/catalog.json`), which the sidebar and browse
 *   views use to list scores by group; and
 * - the search source (`app/generated/search-index.json`), which the search
 *   palette indexes in the browser on first use.
 *
 * Both are columnar: repeated strings (raga, composer, tala, keywords) live
 * in dictionaries and each score is a positional row, which keeps 15,000
 * scores to a few hundred kilobytes gzipped. `app/catalog.ts` and
 * `app/search.ts` decode them; `scripts/build-index.test.ts` round-trips.
 *
 * These functions are pure over document records so they can be unit-tested.
 */

/** Score groups: the directories under scores/, labelled by their README. */
export const scoreGroupsFor = (scoresRoot) => {
  if (!fs.existsSync(scoresRoot)) return [];
  return fs
    .readdirSync(scoresRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      const readme = path.join(scoresRoot, key, "README.md");
      const heading = fs.existsSync(readme)
        ? /^#\s+(.+)$/m.exec(fs.readFileSync(readme, "utf8"))?.[1]?.trim()
        : undefined;
      return { key, label: heading ?? humanize(key) };
    });
};

const humanize = (key) =>
  key
    .replace(/^\d+_/, "")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");

const text = (value) =>
  Array.isArray(value)
    ? value.map(text).filter(Boolean).join(" · ")
    : value === undefined || value === null
      ? ""
      : String(value).trim();

const list = (value) =>
  Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : text(value)
      ? text(value)
          .split(/\s*[,;]\s*/)
          .filter(Boolean)
      : [];

/** The searchable fields of one score record. */
export const scoreEntryFor = (record) => {
  const [, group = "", ...rest] = record.id.split("/");
  return {
    id: record.id,
    slug: rest.join("/"),
    group,
    title: record.title,
    alt: text(record.metadata.alternate_titles),
    raga: text(record.metadata.raga),
    composer: text(record.metadata.composer),
    tala: text(record.metadata.tala),
    keywords: list(record.metadata.keywords),
  };
};

/** Interns strings; the empty string maps to -1 so rows stay compact. */
const dictionary = () => {
  const values = [];
  const indexes = new Map();
  return {
    values,
    add(value) {
      if (!value) return -1;
      let index = indexes.get(value);
      if (index === undefined) {
        index = values.length;
        indexes.set(value, index);
        values.push(value);
      }
      return index;
    },
  };
};

const byGroupThenTitle = (left, right) =>
  left.group.localeCompare(right.group) ||
  left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) ||
  left.slug.localeCompare(right.slug);

/** Builds the catalog: what the sidebar needs to list scores by group. */
export const buildCatalog = (scoreRecords, groups) => {
  const groupIndex = new Map(groups.map((group, index) => [group.key, index]));
  const ragas = dictionary();
  const composers = dictionary();
  const talas = dictionary();
  const entries = scoreRecords.map(scoreEntryFor).sort(byGroupThenTitle);
  return {
    groups: groups.map((group) => group.key),
    ragas: ragas.values,
    composers: composers.values,
    talas: talas.values,
    scores: entries.map((entry) => [
      entry.slug,
      entry.title,
      groupIndex.get(entry.group) ?? -1,
      ragas.add(entry.raga),
      composers.add(entry.composer),
      talas.add(entry.tala),
    ]),
  };
};

/**
 * Builds the search source: catalog fields plus alternate titles and
 * keywords per score, and title + body text for the few non-score documents.
 */
export const buildSearchSource = (scoreRecords, docRecords, groups) => {
  const groupIndex = new Map(groups.map((group, index) => [group.key, index]));
  const ragas = dictionary();
  const composers = dictionary();
  const talas = dictionary();
  const keywords = dictionary();
  const entries = scoreRecords.map(scoreEntryFor).sort(byGroupThenTitle);
  return {
    groups: groups.map((group) => group.key),
    ragas: ragas.values,
    composers: composers.values,
    talas: talas.values,
    keywords: keywords.values,
    docs: docRecords.map((record) => ({
      id: record.id,
      title: record.title,
      category: record.category,
      excerpt: record.excerpt,
      body: record.plainText ?? "",
    })),
    scores: entries.map((entry) => [
      entry.slug,
      groupIndex.get(entry.group) ?? -1,
      entry.title,
      entry.alt,
      ragas.add(entry.raga),
      composers.add(entry.composer),
      talas.add(entry.tala),
      entry.keywords.map((keyword) => keywords.add(keyword)),
    ]),
  };
};

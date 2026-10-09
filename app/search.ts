import MiniSearch, { type SearchOptions } from "minisearch";
import { searchIndexUrl } from "./generated-content";
import { entrySubtitle, scoreContentUrl } from "./catalog";

/**
 * Library search. The search source is a lazily fetched, dictionary-encoded
 * JSON file (`scripts/build-index.mjs`); it is expanded into a MiniSearch
 * index in the browser the first time search is needed. Scores are matched
 * on title, alternate titles, raga, composer, tala, and keywords; the few
 * non-score documents also match on their body text. Ranking keeps the
 * intent of the original substring search: title first, then raga,
 * composer, and tala, then keywords, with a bonus for a whole-query title
 * match.
 *
 * Every hit reports which fields matched and the matched terms, so the
 * palette can label a result "Composer" or "Raga" and highlight the words
 * that put it there (`highlightSegments`).
 */

export interface SearchSourceFile {
  groups: string[];
  ragas: string[];
  composers: string[];
  talas: string[];
  keywords: string[];
  docs: { id: string; title: string; category: string; excerpt: string; body: string }[];
  /** [slug, group, title, alt titles, raga, composer, tala, keyword indexes] */
  scores: [string, number, string, string, number, number, number, number[]][];
}

export interface SearchDocument {
  id: string;
  title: string;
  category: string;
  alt: string;
  raga: string;
  composer: string;
  tala: string;
  keywords: string;
  body: string;
  excerpt: string;
}

export type MatchField =
  | "title"
  | "alt"
  | "raga"
  | "composer"
  | "tala"
  | "keywords"
  | "body";

/** Field labels shown on a result, in display priority order. */
export const MATCH_FIELD_LABELS: Record<MatchField, string> = {
  title: "Title",
  alt: "Also known as",
  raga: "Raga",
  composer: "Composer",
  tala: "Tala",
  keywords: "Keyword",
  body: "Text",
};

const FIELDS: MatchField[] = ["title", "alt", "raga", "composer", "tala", "keywords", "body"];

export interface SearchHit {
  id: string;
  title: string;
  category: string;
  /** Raga · tala · composer for scores, the excerpt for other documents. */
  subtitle: string;
  contentUrl: string;
  score: number;
  /** Index terms that matched the query (folded), for highlighting. */
  terms: string[];
  /** Fields that matched, in display priority order. */
  fields: MatchField[];
  /**
   * The matched value of a field that the title and subtitle do not show:
   * an alternate title, the matching keywords, or a snippet of a document.
   */
  context?: { field: MatchField; text: string };
}

export interface SearchEngine {
  search(query: string, limit?: number): SearchHit[];
  readonly size: number;
}

/** Lower-cases and strips diacritics: "Śaṅkarābharaṇam" and "Ṡ" fold to ASCII. */
export const foldTerm = (term: string) =>
  term
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();

const RANKING: SearchOptions = {
  boost: { title: 10, alt: 6, raga: 5, composer: 5, tala: 4, keywords: 2, body: 1 },
  prefix: true,
  fuzzy: 0.15,
  combineWith: "AND",
};

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/**
 * Splits `text` into plain and highlighted segments wherever a term occurs,
 * comparing on folded characters so "Kalyani" lights up for "kalyani" and
 * "Śaṅkarābharaṇam" for "sankarabharanam". Overlapping hits merge.
 */
export const highlightSegments = (
  text: string,
  terms: string[],
): HighlightSegment[] => {
  const needles = [...new Set(terms.map(foldTerm).filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );
  if (!text || needles.length === 0) return [{ text, hit: false }];

  // Folded text with a map from each folded character back to its source.
  let folded = "";
  const origin: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const piece = foldTerm(text[index]);
    for (const character of piece) {
      folded += character;
      origin.push(index);
    }
  }

  const ranges: [number, number][] = [];
  for (const needle of needles) {
    let from = folded.indexOf(needle);
    while (from !== -1) {
      const start = origin[from];
      const end = origin[from + needle.length - 1] + 1;
      ranges.push([start, end]);
      from = folded.indexOf(needle, from + 1);
    }
  }
  if (ranges.length === 0) return [{ text, hit: false }];

  ranges.sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
    segments.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
};

/** A window of `body` around the first matched term, trimmed to word edges. */
const snippetAround = (body: string, terms: string[], width = 110): string => {
  const folded = foldTerm(body);
  let at = -1;
  for (const term of terms) {
    const index = folded.indexOf(foldTerm(term));
    if (index !== -1 && (at === -1 || index < at)) at = index;
  }
  if (at === -1) return body.slice(0, width);
  // Folding does not change the length of ASCII text; for accented text the
  // offset drifts by at most a few characters, which the window absorbs.
  let start = Math.max(0, at - Math.floor(width / 3));
  let end = Math.min(body.length, start + width);
  if (start > 0) start = body.lastIndexOf(" ", start) + 1 || start;
  if (end < body.length) end = body.indexOf(" ", end) === -1 ? end : body.indexOf(" ", end);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).trim()}${end < body.length ? "…" : ""}`;
};

/** Expands the columnar file into flat documents. */
export const expandSearchSource = (file: SearchSourceFile): SearchDocument[] => {
  const pick = (values: string[], index: number) =>
    index >= 0 ? (values[index] ?? "") : "";
  const scores = file.scores.map<SearchDocument>(
    ([slug, group, title, alt, raga, composer, tala, keywordIds]) => ({
      id: `scores/${file.groups[group] ?? ""}/${slug}`,
      title,
      category: "Scores",
      alt,
      raga: pick(file.ragas, raga),
      composer: pick(file.composers, composer),
      tala: pick(file.talas, tala),
      keywords: keywordIds.map((index) => pick(file.keywords, index)).join(" · "),
      body: "",
      excerpt: "",
    }),
  );
  const docs = file.docs.map<SearchDocument>((doc) => ({
    id: doc.id,
    title: doc.title,
    category: doc.category,
    alt: "",
    raga: "",
    composer: "",
    tala: "",
    keywords: "",
    body: doc.body,
    excerpt: doc.excerpt,
  }));
  return [...docs, ...scores];
};

type StoredFields = Pick<
  SearchDocument,
  "title" | "category" | "raga" | "composer" | "tala" | "excerpt" | "alt" | "keywords" | "body"
>;

/** Builds a search engine over expanded documents (also used by tests). */
export const createSearchEngine = (documents: SearchDocument[]): SearchEngine => {
  const index = new MiniSearch<SearchDocument>({
    fields: [...FIELDS],
    storeFields: [
      "title",
      "category",
      "raga",
      "composer",
      "tala",
      "excerpt",
      "alt",
      "keywords",
      "body",
    ],
    processTerm: (term) => {
      const folded = foldTerm(term);
      return folded.length > 0 ? folded : null;
    },
    searchOptions: RANKING,
  });
  index.addAll(documents);

  const toHit = (
    result: { id: string; score: number; terms: string[]; match: Record<string, string[]> } &
      Record<string, unknown>,
  ): SearchHit => {
    const stored = result as unknown as StoredFields;
    const isScore = stored.category === "Scores";
    const matched = new Set<MatchField>();
    for (const fields of Object.values(result.match)) {
      for (const field of fields) matched.add(field as MatchField);
    }
    const fields = FIELDS.filter((field) => matched.has(field));
    const terms = [...new Set(result.terms)];

    let context: SearchHit["context"];
    if (matched.has("alt") && stored.alt) {
      context = { field: "alt", text: stored.alt };
    } else if (matched.has("keywords") && stored.keywords) {
      const hits = stored.keywords
        .split(" · ")
        .filter((keyword) => highlightSegments(keyword, terms).some((segment) => segment.hit));
      context = { field: "keywords", text: (hits.length ? hits : [stored.keywords]).join(" · ") };
    } else if (matched.has("body") && !matched.has("title") && stored.body) {
      context = { field: "body", text: snippetAround(stored.body, terms) };
    }

    return {
      id: result.id,
      title: stored.title,
      category: stored.category,
      subtitle: isScore ? entrySubtitle(stored) : stored.excerpt,
      contentUrl: isScore
        ? scoreContentUrl(result.id)
        : `/generated-content/${result.id}.json`,
      score: result.score,
      terms,
      fields,
      context,
    };
  };

  return {
    get size() {
      return index.documentCount;
    },
    search(query, limit = 10) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      let results = index.search(trimmed);
      if (results.length === 0) {
        results = index.search(trimmed, { combineWith: "OR" });
      }
      const folded = foldTerm(trimmed);
      const ranked = results
        .map((result) => {
          const title = foldTerm(String(result.title ?? ""));
          // A whole-query title match outranks scattered field hits, as the
          // original substring search's phrase bonus did.
          const score = title.includes(folded) ? result.score * 1.5 : result.score;
          return { ...result, score };
        })
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
      return ranked.map(toHit);
    },
  };
};

let enginePromise: Promise<SearchEngine> | null = null;

/** Fetches the search source and builds the engine once per page load. */
export const loadSearch = (): Promise<SearchEngine> => {
  enginePromise ??= fetch(searchIndexUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Search index request failed (${response.status})`);
      }
      return response.json() as Promise<SearchSourceFile>;
    })
    .then((file) => createSearchEngine(expandSearchSource(file)))
    .catch((error: unknown) => {
      enginePromise = null;
      throw error;
    });
  return enginePromise;
};

/** Starts loading the search engine when the browser is idle. */
export const warmSearch = () => {
  const start = () => void loadSearch().catch(() => undefined);
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(start, { timeout: 4000 });
  } else {
    window.setTimeout(start, 2000);
  }
};

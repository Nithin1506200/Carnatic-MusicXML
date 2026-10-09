import { describe, expect, it } from "vitest";
import {
  buildCatalog,
  buildSearchSource,
  scoreEntryFor,
} from "./build-index.mjs";
import { decodeCatalog, type CatalogFile } from "../app/catalog.ts";
import { expandSearchSource, type SearchSourceFile } from "../app/search.ts";

const groups = [
  { key: "04_kritis", label: "Kriti Scores" },
  { key: "06_bhajans", label: "Bhajan Scores" },
];

const score = (
  id: string,
  title: string,
  metadata: Record<string, unknown>,
) => ({
  id,
  title,
  category: "Scores",
  excerpt: "",
  metadata,
  plainText: "",
});

const scores = [
  score("scores/06_bhajans/bhagyada", "Bhagyada Lakshmi", {
    raga: "Madhyamavathi",
    tala: "Aadi",
    composer: "Purandara Dasa",
    keywords: ["bhajan", "Carnatic saxophone"],
  }),
  score("scores/04_kritis/vatapi", "Vatapi Ganapatim", {
    raga: "Hamsadhwani",
    tala: "Aadi",
    composer: "Muthuswami Dikshitar",
    alternate_titles: ["Vathapi Ganapathim"],
    keywords: "kriti, Carnatic saxophone",
  }),
  score("scores/04_kritis/anonymous", "Anonymous Sketch", {}),
];

const docs = [
  {
    id: "docs/score-notation",
    title: "Score Notation",
    category: "Reference",
    excerpt: "How to write notation…",
    plainText: "Rhythm is read from the cells. One token is one unit.",
  },
];

describe("score entries", () => {
  it("splits the id into group and slug and normalises metadata", () => {
    expect(scoreEntryFor(scores[1])).toEqual({
      id: "scores/04_kritis/vatapi",
      slug: "vatapi",
      group: "04_kritis",
      title: "Vatapi Ganapatim",
      alt: "Vathapi Ganapathim",
      raga: "Hamsadhwani",
      composer: "Muthuswami Dikshitar",
      tala: "Aadi",
      keywords: ["kriti", "Carnatic saxophone"],
    });
  });

  it("tolerates missing metadata", () => {
    const entry = scoreEntryFor(scores[2]);
    expect(entry.raga).toBe("");
    expect(entry.keywords).toEqual([]);
  });
});

describe("catalog", () => {
  const catalog = buildCatalog(scores, groups) as CatalogFile;

  it("dictionary-encodes repeated values and sorts by group then title", () => {
    expect(catalog.groups).toEqual(["04_kritis", "06_bhajans"]);
    expect(catalog.talas).toEqual(["Aadi"]);
    expect(catalog.scores.map((row) => row[0])).toEqual([
      "anonymous",
      "vatapi",
      "bhagyada",
    ]);
    // Both Aadi scores point at the same dictionary index; no tala is -1.
    expect(catalog.scores.map((row) => row[5])).toEqual([-1, 0, 0]);
  });

  it("round-trips through the app decoder", () => {
    const decoded = decodeCatalog(catalog);
    const vatapi = decoded.byId.get("scores/04_kritis/vatapi");
    expect(vatapi).toMatchObject({
      title: "Vatapi Ganapatim",
      raga: "Hamsadhwani",
      composer: "Muthuswami Dikshitar",
      tala: "Aadi",
      group: "04_kritis",
      contentUrl: "/generated-content/scores/04_kritis/vatapi.json",
    });
    expect(decoded.byGroup.get("04_kritis")?.map((entry) => entry.slug)).toEqual([
      "anonymous",
      "vatapi",
    ]);
    expect(decoded.byGroup.get("06_bhajans")).toHaveLength(1);
  });

  it("stays compact", () => {
    const bytes = Buffer.byteLength(JSON.stringify(catalog));
    expect(bytes / scores.length).toBeLessThan(250);
  });
});

describe("search source", () => {
  const source = buildSearchSource(scores, docs, groups) as SearchSourceFile;

  it("carries keywords and alternate titles for scores, body text for docs", () => {
    // Interned in row order (group, then title): vatapi's keywords first.
    expect(source.keywords).toEqual(["kriti", "Carnatic saxophone", "bhajan"]);
    expect(source.docs[0]).toMatchObject({
      id: "docs/score-notation",
      body: "Rhythm is read from the cells. One token is one unit.",
    });
  });

  it("expands into flat search documents with reconstructed ids", () => {
    const expanded = expandSearchSource(source);
    expect(expanded.map((document) => document.id)).toEqual([
      "docs/score-notation",
      "scores/04_kritis/anonymous",
      "scores/04_kritis/vatapi",
      "scores/06_bhajans/bhagyada",
    ]);
    const vatapi = expanded.find((document) => document.id.endsWith("vatapi"));
    expect(vatapi).toMatchObject({
      category: "Scores",
      alt: "Vathapi Ganapathim",
      keywords: "kriti · Carnatic saxophone",
      body: "",
    });
  });
});

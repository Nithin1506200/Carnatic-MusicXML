import { describe, expect, it } from "vitest";
import {
  createSearchEngine,
  foldTerm,
  highlightSegments,
  type SearchDocument,
} from "./search.ts";

const doc = (partial: Partial<SearchDocument> & Pick<SearchDocument, "id" | "title">): SearchDocument => ({
  category: "Scores",
  alt: "",
  raga: "",
  composer: "",
  tala: "",
  keywords: "",
  body: "",
  excerpt: "",
  ...partial,
});

const engine = createSearchEngine([
  doc({
    id: "scores/04_kritis/vatapi",
    title: "Vatapi Ganapatim",
    raga: "Hamsadhwani",
    tala: "Aadi",
    composer: "Muthuswami Dikshitar",
    keywords: "kriti · ganesha",
  }),
  doc({
    id: "scores/04_kritis/kalyani_varnam",
    title: "Vanajakshi",
    alt: "Vanajakshiro",
    raga: "Kalyani",
    tala: "Ata",
    composer: "Pallavi Gopala Iyer",
  }),
  doc({
    id: "scores/04_kritis/nidhi",
    title: "Nidhi Chala Sukhama",
    raga: "Kalyani",
    tala: "Misra Chapu",
    composer: "Tyagaraja",
  }),
  doc({
    id: "scores/03_jatiswara/sankarabharanam_jatiswara",
    title: "Jatiswara in Śaṅkarābharaṇam",
    raga: "Shankarabharanam",
    tala: "Aadi",
  }),
  doc({
    id: "docs/score-notation",
    title: "Score Notation",
    category: "Reference",
    excerpt: "How notation is written",
    body: "Rhythm is read from the cells; a tuplet shares one unit. Kalyani appears here only as prose.",
  }),
]);

const ids = (query: string) => engine.search(query).map((hit) => hit.id);

describe("library search", () => {
  it("folds diacritics and case", () => {
    expect(foldTerm("Śaṅkarābharaṇam")).toBe("sankarabharanam");
    expect(foldTerm("Ṡ")).toBe("s");
  });

  it("ranks a title match above a raga-only match", () => {
    expect(ids("kalyani")[0]).toBe("scores/04_kritis/kalyani_varnam");
    expect(ids("vanajakshi")[0]).toBe("scores/04_kritis/kalyani_varnam");
    expect(ids("nidhi chala")[0]).toBe("scores/04_kritis/nidhi");
  });

  it("matches prefixes and alternate titles", () => {
    expect(ids("kalya")).toContain("scores/04_kritis/nidhi");
    expect(ids("vanajakshiro")[0]).toBe("scores/04_kritis/kalyani_varnam");
  });

  it("matches transliteration variants through diacritic folding", () => {
    expect(ids("sankarabharanam")[0]).toBe(
      "scores/03_jatiswara/sankarabharanam_jatiswara",
    );
  });

  it("requires every term, then falls back to any term", () => {
    expect(ids("kalyani tyagaraja")).toEqual(["scores/04_kritis/nidhi"]);
    expect(ids("tyagaraja zzzz")).toEqual(["scores/04_kritis/nidhi"]);
  });

  it("searches document bodies but never score bodies", () => {
    expect(ids("tuplet")).toEqual(["docs/score-notation"]);
    const hits = engine.search("kalyani");
    expect(hits.find((hit) => hit.id === "docs/score-notation")).toBeDefined();
    expect(hits[0].category).toBe("Scores");
  });

  it("describes hits with a metadata subtitle for scores and the excerpt for docs", () => {
    const [vatapi] = engine.search("vatapi");
    expect(vatapi.subtitle).toBe("Hamsadhwani · Aadi · Muthuswami Dikshitar");
    expect(vatapi.contentUrl).toBe("/generated-content/scores/04_kritis/vatapi.json");
    const [notation] = engine.search("tuplet");
    expect(notation.subtitle).toBe("How notation is written");
  });

  it("reports which fields matched, in display order", () => {
    const [byComposer] = engine.search("dikshitar");
    expect(byComposer.fields).toEqual(["composer"]);
    expect(byComposer.terms).toEqual(["dikshitar"]);
    const [byRaga] = engine.search("hamsadhwani");
    expect(byRaga.fields).toEqual(["raga"]);
    const both = engine.search("kalyani").find((hit) => hit.id.endsWith("kalyani_varnam"));
    expect(both?.fields).toEqual(["raga"]);
  });

  it("adds a context line for fields the result does not otherwise show", () => {
    const [alt] = engine.search("vanajakshiro");
    expect(alt.context).toEqual({ field: "alt", text: "Vanajakshiro" });
    const [keyword] = engine.search("ganesha");
    expect(keyword.fields).toEqual(["keywords"]);
    expect(keyword.context).toEqual({ field: "keywords", text: "ganesha" });
    const [body] = engine.search("tuplet");
    expect(body.context?.field).toBe("body");
    expect(body.context?.text).toContain("tuplet");
    const [title] = engine.search("vatapi");
    expect(title.context).toBeUndefined();
  });

  it("returns nothing for an empty query and reports its size", () => {
    expect(engine.search("   ")).toEqual([]);
    expect(engine.size).toBe(5);
  });
});

describe("highlight segments", () => {
  it("marks every occurrence of a term, folding case and diacritics", () => {
    expect(highlightSegments("Jatiswara in Śaṅkarābharaṇam", ["sankarabharanam"])).toEqual([
      { text: "Jatiswara in ", hit: false },
      { text: "Śaṅkarābharaṇam", hit: true },
    ]);
    expect(highlightSegments("Kalyani · Ata · Kalyani Iyer", ["kalyani"])).toEqual([
      { text: "Kalyani", hit: true },
      { text: " · Ata · ", hit: false },
      { text: "Kalyani", hit: true },
      { text: " Iyer", hit: false },
    ]);
  });

  it("merges overlapping terms and leaves unmatched text alone", () => {
    expect(highlightSegments("Nidhi Chala Sukhama", ["nidhi", "nidhi chala"])).toEqual([
      { text: "Nidhi Chala", hit: true },
      { text: " Sukhama", hit: false },
    ]);
    expect(highlightSegments("Nidhi", ["zzz"])).toEqual([{ text: "Nidhi", hit: false }]);
    expect(highlightSegments("", ["a"])).toEqual([{ text: "", hit: false }]);
  });
});

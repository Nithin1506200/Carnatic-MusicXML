import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { notationBlocksFor } from "../scripts/validate-notation";
import {
  classifyOctave,
  NotationDirectiveKeyword,
  NotationParseError,
  NotationRowKind,
  NotationSectionKind,
  NotationSectionKeyword,
  OctavePosition,
  parseNotationDirective,
  parseNotationLine,
  parseNotationText,
  parseScoreNotation,
  SwaraTable,
  TalaDivider,
} from "./score-notation";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const carnaticBlocks = (source: string) =>
  [...source.matchAll(/```carnatic\r?\n([\s\S]*?)\r?\n```/g)].map(
    (match) => match[1],
  );

describe("notation enums", () => {
  it("defines stable serialized values used by MDX and CSS", () => {
    expect(TalaDivider.Anga).toBe("|");
    expect(TalaDivider.Measure).toBe("||");
    expect(NotationSectionKind.Lyrics).toBe("lyrics");
    expect(NotationSectionKind.Swaras).toBe("swaras");
    expect(NotationSectionKeyword.Swaras).toBe("swaras");
    expect(NotationRowKind.Swara).toBe("swara");
  });
});

describe("parseNotationLine", () => {
  it("parses documented anga and measure boundaries", () => {
    expect(parseNotationLine("S R G M | P D | N Ṡ ||")).toEqual({
      tokens: ["S", "R", "G", "M", "P", "D", "N", "Ṡ"],
      solidBefore: [4, 6],
      doubleBefore: [],
      doubleEnd: true,
    });
  });

  it("parses an internal measure boundary", () => {
    expect(parseNotationLine("S R || G M").doubleBefore).toEqual([2]);
  });

  it("accepts token arrays without implicit dividers", () => {
    expect(parseNotationLine(["S", "R", "G"]).tokens).toEqual(["S", "R", "G"]);
  });

  it.each([
    ["", "at least one token"],
    ["| S R", "before the first"],
    ["S R |", "single tala divider cannot end"],
    ["S R | || G", "Consecutive tala dividers"],
  ])("rejects malformed grouped notation %j", (value, message) => {
    expect(() => parseNotationLine(value)).toThrow(message);
  });

  it("rejects divider tokens in token arrays", () => {
    expect(() => parseNotationLine(["S", "|", "R"])).toThrow(
      "use a grouped string",
    );
  });
});

describe("octave classification", () => {
  it("recognizes lower, middle, and upper swaras", () => {
    expect(classifyOctave("Ṇ")).toBe(OctavePosition.Lower);
    expect(classifyOctave("S")).toBe(OctavePosition.Middle);
    expect(classifyOctave("Ṡ")).toBe(OctavePosition.Upper);
  });
});

describe("directive parsing", () => {
  it("parses known keywords case-insensitively", () => {
    expect(parseNotationDirective("@SaHiTyA: Ninnu kori")).toEqual({
      keyword: NotationDirectiveKeyword.Sahitya,
      label: "SaHiTyA",
      value: "Ninnu kori",
    });
  });

  it("recognizes source, repeat, return, and custom keywords", () => {
    expect(parseNotationDirective("@source: score.mscz")?.keyword).toBe(
      NotationDirectiveKeyword.Source,
    );
    expect(parseNotationDirective("@Repeat: Pallavi")?.keyword).toBe(
      NotationDirectiveKeyword.Repeat,
    );
    expect(parseNotationDirective("@Return: Charanam")?.keyword).toBe(
      NotationDirectiveKeyword.Return,
    );
    expect(parseNotationDirective("@Tempo: Slowly")?.keyword).toBe(
      NotationDirectiveKeyword.Custom,
    );
  });

  it("rejects malformed @Keyword directives", () => {
    expect(() => parseNotationDirective("@Repeat the pallavi")).toThrow(
      "@Keyword: value",
    );
  });
});

describe("documented score notation contract", () => {
  const guide = fs.readFileSync(
    path.join(root, "docs", "score-notation.md"),
    "utf8",
  );
  const [example] = carnaticBlocks(guide);

  it("keeps an executable carnatic example in the guide", () => {
    expect(example).toBeTruthy();
    const parsed = parseScoreNotation(example);

    expect(parsed.museScoreSource).toBe("composition_name.mscz");
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]).toMatchObject({
      key: "pallavi",
      title: "Pallavi",
      kind: NotationSectionKind.Lyrics,
    });
    expect(parsed.sections[0].before[0].keyword).toBe(
      NotationDirectiveKeyword.Sahitya,
    );
    expect(parsed.sections[0].after[0].keyword).toBe(
      NotationDirectiveKeyword.Repeat,
    );
    expect(parsed.sections[1]).toMatchObject({
      key: "practicePhrase",
      kind: NotationSectionKind.Swaras,
    });
  });

  it("returns the keyed structure used by MDX exercises", () => {
    const notation = parseNotationText(example);
    expect(notation.pallavi).toHaveLength(2);
    expect(notation.practicePhrase).toEqual([
      "S R G M | P D | N Ṡ ||",
      "Ṡ N D P | M G | R S ||",
    ]);
  });

  it("renders octave and tala styling from the practical example", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SwaraTable, {
        swaras: "Ṇ S | R Ṡ ||",
        lyrics: "- sa | ri - ||",
        number: 1,
      }),
    );

    expect(markup).toContain("tala-solid-before");
    expect(markup).toContain("tala-double-end");
    expect(markup).toContain("<em>Ṇ</em>");
    expect(markup).toContain("<strong>Ṡ</strong>");
    expect(markup).toContain("swara-lyrics");
  });
});

describe("complete score validation", () => {
  it("accepts every fenced carnatic block in the repository", () => {
    const scoreFiles = fs
      .readdirSync(path.join(root, "scores"), {
        recursive: true,
        withFileTypes: true,
      })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".mdx"))
      .map((entry) => path.join(entry.parentPath, entry.name));

    const blocks = scoreFiles.flatMap((file) =>
      notationBlocksFor(fs.readFileSync(file, "utf8")).map(({ source }) => ({
        file,
        source,
      })),
    );
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(() => parseScoreNotation(block.source), block.file).not.toThrow();
    }
  });

  it.each([
    ["notation before a heading", "S R G M ||", "before a section heading"],
    [
      "a directive before a heading",
      "@Repeat: Pallavi\n# A [swaras]\nS R ||",
      "directive appears before",
    ],
    ["an empty section", "# Empty", "section is empty"],
    [
      "duplicate sections",
      "# A [swaras]\nS R ||\n# A [swaras]\nR S ||",
      "Duplicate notation section",
    ],
    [
      "a misspelled swaras marker",
      "# Ettugada Swara 1 [swardas]\nS R ||",
      "Unknown notation section marker [swardas]. Use [swaras]",
    ],
    [
      "an unclosed swaras marker",
      "# Ettugada Swara 1 [swaras\nS R ||",
      "Unknown notation section marker bracketed marker",
    ],
    [
      "an odd lyrical row count",
      "# Pallavi\nS R ||",
      "alternating swara and lyric lines",
    ],
    [
      "different cell counts",
      "# Pallavi\nS R G ||\nsa ri ||",
      "same number of cells",
    ],
    [
      "different divider positions",
      "# Pallavi\nS R | G M ||\nsa | ri ga ma ||",
      "same positions",
    ],
    [
      "a misplaced source",
      "# A [swaras]\nS R ||\n@source: a.mscz",
      "before the first notation section",
    ],
    [
      "a non-MuseScore source",
      "@source: a.musicxml\n# A [swaras]\nS R ||",
      ".mscz file",
    ],
    [
      "duplicate sources",
      "@source: a.mscz\n@source: b.mscz\n# A [swaras]\nS R ||",
      "only one @source",
    ],
  ])("rejects %s", (_name, source, message) => {
    expect(() => parseScoreNotation(source)).toThrow(message);
  });

  it("reports the failing notation row", () => {
    try {
      parseScoreNotation(
        "@source: example.mscz\n# Pallavi\nS R | G M ||\nsa | ri ga ma ||",
      );
      expect.unreachable("invalid lyric alignment should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotationParseError);
      expect(error).toMatchObject({ line: 4, column: 1 });
    }
  });
});

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { notationBlocksFor } from "../scripts/validate-notation";
import {
  classifyOctave,
  normalizeSwaraToken,
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
  parseSwaraDurations,
  parseTimeSignature,
  splitSwaraSlots,
  splitLyricSlots,
  SwaraTable,
  swaraSlotCount,
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

  it("keeps octave styling when marks are attached to the swara", () => {
    expect(classifyOctave("Ṡ,")).toBe(OctavePosition.Upper);
    expect(classifyOctave("Ṇ,")).toBe(OctavePosition.Lower);
  });
});

describe("octave aliases", () => {
  it("rewrites apostrophe and lowercase aliases to dotted swaras", () => {
    expect(normalizeSwaraToken("S'")).toBe("Ṡ");
    expect(normalizeSwaraToken("n")).toBe("Ṇ");
    expect(normalizeSwaraToken("S'R'")).toBe("ṠṘ");
    expect(normalizeSwaraToken("nn,")).toBe("ṆṆ,");
    expect(normalizeSwaraToken("Ṡ")).toBe("Ṡ"); // canonical form passes through
    expect(normalizeSwaraToken("Ṇ")).toBe("Ṇ");
    expect(normalizeSwaraToken("|")).toBe("|");
  });

  it("rejects contradictory alias forms as unparseable swaras", () => {
    // A lowercase letter already names mandra; adding a tāra apostrophe is
    // garbage and must not silently normalize — the token stays opaque and
    // pitch resolution in the .mscz generator rejects it.
    expect(normalizeSwaraToken("n'")).toBe("n'");
    expect(
      parseScoreNotation("# A [swaras]\nn' S ||").sections[0].content,
    ).toEqual(["n' S ||"]);
    expect(
      parseScoreNotation("# A [swaras]\nṠ' S ||").sections[0].content,
    ).toEqual(["Ṡ' S ||"]);
  });

  it("stores canonical dotted text for aliased swara rows", () => {
    const parsed = parseScoreNotation("# A [swaras]\nS' n ||");
    expect(parsed.sections[0].content).toEqual(["Ṡ Ṇ ||"]);
  });

  it("keeps a trailing tāra alias at the end of a row", () => {
    expect(
      parseScoreNotation("# A [swaras]\nD S' ||").sections[0].content[0],
    ).toBe("D Ṡ ||");
  });

  it("keeps apostrophes in lyric rows verbatim", () => {
    const parsed = parseScoreNotation("# P\nS R ||\ndon't stop ||");
    const [section] = parsed.sections;
    if (section.kind !== NotationSectionKind.Lyrics) {
      throw new Error("expected a lyrical section");
    }
    expect(section.content[0].lyrics).toBe("don't stop ||");
  });

  it("pairs compact aliased tokens with lyric cells", () => {
    const parsed = parseScoreNotation("# P\ns, | S' ||\nla | ta ||");
    const [section] = parsed.sections;
    if (section.kind !== NotationSectionKind.Lyrics) {
      throw new Error("expected a lyrical section");
    }
    expect(section.content[0].swaras).toBe("Ṣ, | Ṡ ||");
  });

  it("renders aliased props with the usual octave styling", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SwaraTable, {
        swaras: "S' n ||",
        lyrics: "- sa ||",
        number: 1,
      }),
    );
    expect(markup).toContain("<strong>Ṡ</strong>");
    expect(markup).toContain("<em>Ṇ</em>");
  });
});

describe("slot splitting", () => {
  it("splits letters and attached marks into ordered slots", () => {
    expect(splitSwaraSlots("G,")).toEqual([
      { kind: "sound", text: "G" },
      { kind: "mark", text: "," },
    ]);
    expect(splitSwaraSlots(",N")).toEqual([
      { kind: "mark", text: "," },
      { kind: "sound", text: "N" },
    ]);
  });

  it("counts slots for lyric alignment", () => {
    expect(swaraSlotCount("S")).toBe(1);
    expect(swaraSlotCount("G,")).toBe(2);
    expect(swaraSlotCount("SRGM")).toBe(4);
    expect(swaraSlotCount(",,")).toBe(2);
  });

  it("rejects tokens that are not swara cells", () => {
    expect(splitSwaraSlots("G%")).toBeNull();
    expect(splitSwaraSlots("%")).toBeNull();
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

  it("recognizes source, repeat, return, time, and custom keywords", () => {
    expect(parseNotationDirective("@source: score.mscz")?.keyword).toBe(
      NotationDirectiveKeyword.Source,
    );
    expect(parseNotationDirective("@Repeat: Pallavi")?.keyword).toBe(
      NotationDirectiveKeyword.Repeat,
    );
    expect(parseNotationDirective("@Return: Charanam")?.keyword).toBe(
      NotationDirectiveKeyword.Return,
    );
    expect(parseNotationDirective("@Time: (4+2+2)/4")?.keyword).toBe(
      NotationDirectiveKeyword.Time,
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

describe("swara durations", () => {
  it("treats one space-separated token as one unit", () => {
    expect(parseSwaraDurations("S")).toEqual([
      { text: "S", sounds: ["S"], units: 1 },
    ]);
  });

  it("splits swaras joined without a space into one shared unit", () => {
    expect(parseSwaraDurations("SR")).toEqual([
      { text: "SR", sounds: ["S", "R"], units: 1 },
    ]);
    expect(parseSwaraDurations("ṠṘGM")).toEqual([
      { text: "ṠṘGM", sounds: ["Ṡ", "Ṙ", "G", "M"], units: 1 },
    ]);
  });

  it.each([
    ["S .", 2], // a minim
    ["S . .", 3], // a dotted minim
    ["S -", 2],
    ["S ,", 2],
  ])("folds the duration marks in %j into units", (value, expected) => {
    expect(parseSwaraDurations(value)).toEqual([
      { text: "S", sounds: ["S"], units: expected },
    ]);
  });

  it("extends only the swara cell that precedes a mark", () => {
    expect(parseSwaraDurations("S R . .")).toEqual([
      { text: "S", sounds: ["S"], units: 1 },
      { text: "R", sounds: ["R"], units: 3 },
    ]);
  });

  it("folds marks across tala dividers", () => {
    expect(parseSwaraDurations("S . | R ||").map((beat) => beat.units)).toEqual(
      [2, 1],
    );
  });

  it("keeps every base cell audible at one unit", () => {
    const beats = parseSwaraDurations("S R G M | P D | N Ṡ ||");
    expect(beats.map((beat) => beat.units)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(beats.reduce((total, beat) => total + beat.units, 0)).toBe(8);
  });

  it("folds a line-opening mark run into one continuation beat", () => {
    // The line continues the previous line's last cell for four units.
    expect(parseSwaraDurations("- - - - ||")).toEqual([
      { text: "-", sounds: [], units: 4 },
    ]);
  });

  it("reads * as a rest that duration marks lengthen", () => {
    expect(parseSwaraDurations("S * - | R * - -")).toEqual([
      { text: "S", sounds: ["S"], units: 1 },
      { text: "*", sounds: [], units: 2, rest: true },
      { text: "R", sounds: ["R"], units: 1 },
      { text: "*", sounds: [], units: 3, rest: true },
    ]);
  });

  it("rejects the retired dhirga mark in a section", () => {
    expect(() => parseScoreNotation("# A [swaras]\nS ; ||")).toThrow(
      'The dhirga mark ";" is not supported',
    );
  });

  it("accepts token arrays", () => {
    expect(parseSwaraDurations(["S", "."])).toEqual([
      { text: "S", sounds: ["S"], units: 2 },
    ]);
  });

  it("keeps a compact swara token as a one-unit beat", () => {
    expect(parseSwaraDurations("G,")).toEqual([
      { text: "G,", sounds: ["G"], units: 1 },
    ]);
    expect(parseSwaraDurations("S ,,")).toEqual([
      { text: "S", sounds: ["S"], units: 2 },
    ]);
  });
});

describe("cell-aligned swara and lyric pairing", () => {
  const compactPair = [
    "# Pallavi",
    "G, M, D, ,, | NN DN | S, ,, ||",
    "Ni nnu ko - | - - | ri - ||",
  ].join("\n");

  it("pairs lyric cells with compact swara cells", () => {
    const parsed = parseScoreNotation(compactPair);
    expect(parsed.sections[0]).toMatchObject({
      kind: NotationSectionKind.Lyrics,
    });
  });

  it("rejects a lyric row with extra cells for slot subdivisions", () => {
    expect(() => parseScoreNotation("# A\nG, M, ||\nla - ta bo ||")).toThrow(
      "same number of cells (2 swara cells !== 4 lyric cells)",
    );
  });

  it("rejects lyric dividers that the swara row does not have", () => {
    expect(() => parseScoreNotation("# A\nG, M ||\nla | ta ||")).toThrow(
      "same positions",
    );
  });

  it("keeps each compact token and lyric in one beat cell", () => {
    const markup = renderToStaticMarkup(
      React.createElement(SwaraTable, {
        swaras: "G, M | ND SN ||",
        lyrics: "la ti | ka ra ||",
        number: 1,
      }),
    );
    expect(markup).not.toContain("colSpan");
    expect(markup.match(/class="swara-cell/g)).toHaveLength(8);
    expect(markup).toContain("tala-solid-before");
  });
});

describe("time signature directive", () => {
  const timedPair = [
    "# Pallavi",
    "@Time: (4+2+2)/4",
    "G, M, D, ,, | NN DN | S, ,, ||",
    "Ni nnu ko - | - - | ri - ||",
  ].join("\n");

  it("parses grouping and denominator forms", () => {
    expect(parseTimeSignature("(4+2+2)/4")).toEqual({
      grouping: [4, 2, 2],
      denominator: 4,
    });
    expect(parseTimeSignature("4+2+2 / 4")).toEqual({
      grouping: [4, 2, 2],
      denominator: 4,
    });
    expect(parseTimeSignature("8/4")).toEqual({
      grouping: [8],
      denominator: 4,
    });
    expect(parseTimeSignature("(3)/8")).toEqual({
      grouping: [3],
      denominator: 8,
    });
  });

  it.each(["8/4 — prose", "4/3", "abc", "/", "(8/4", "(4+2+2))/4"])(
    "rejects the malformed signature %j",
    (value) => {
      expect(() => parseTimeSignature(value)).toThrow("@Time must name");
    },
  );

  it("attaches the parsed signature to its section", () => {
    const parsed = parseScoreNotation(timedPair);
    expect(parsed.sections[0].time).toEqual({
      grouping: [4, 2, 2],
      denominator: 4,
    });
  });

  it("rejects an anga that breaks the declared grouping", () => {
    expect(() =>
      parseScoreNotation(
        "# P\n@Time: (4+2+2)/4\nS R G | M P | D N ||\nla ta bo | ga ma | ni dha ||",
      ),
    ).toThrow("Anga 1 has 3 cells; @Time (4+2+2)/4 expects 4.");
  });

  it("rejects a row that stops mid-measure", () => {
    expect(() =>
      parseScoreNotation(
        "# P\n@Time: (4+2+2)/4\nS R G M | P D ||\nla ta bo ga | ma ni ||",
      ),
    ).toThrow("stops after anga 2 of 3");
  });

  it("rejects a row without a closing measure divider", () => {
    expect(() =>
      parseScoreNotation("# A [swaras]\n@Time: (2+2)/4\nS R | G M"),
    ).toThrow("must end with ||");
  });

  it("rejects a duplicate or late @Time", () => {
    expect(() =>
      parseScoreNotation(
        "# A [swaras]\n@Time: (2+2)/4\n@Time: 4/4\nS R | G M ||",
      ),
    ).toThrow("may declare @Time only once");
    expect(() =>
      parseScoreNotation("# A [swaras]\nS R | G M ||\n@Time: (2+2)/4"),
    ).toThrow("@Time must appear before");
  });

  it("reports the line of a malformed @Time value", () => {
    try {
      parseScoreNotation(
        "# A [swaras]\nS R | G M ||\n# B [swaras]\n@Time: soon\nS S | S S ||",
      );
      expect.unreachable("a malformed @Time should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotationParseError);
      expect(error).toMatchObject({ line: 4, column: 1 });
    }
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
      time: { grouping: [4, 2, 2], denominator: 4 },
    });
    expect(
      parsed.sections[0].before.map((directive) => directive.keyword),
    ).toEqual([
      NotationDirectiveKeyword.Time,
      NotationDirectiveKeyword.Sahitya,
    ]);
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

describe("split lyrics and explicit variants", () => {
  it("maps split syllables to slots, allowing a final melisma", () => {
    expect(splitLyricSlots("Ni/nu", "SR")).toEqual(["Ni", "nu"]);
    expect(splitLyricSlots("nnu/ko-", "GMM")).toEqual(["nnu", "ko", "-"]);
    expect(splitLyricSlots("lee/me", "GMM")).toEqual(["lee", "me"]);
    expect(splitLyricSlots("Ni", "SR")).toBeNull();
  });

  it("renders syllables below their individual swaras", () => {
    const html = renderToStaticMarkup(
      React.createElement(SwaraTable, {
        swaras: "SR GMM GMM ||",
        lyrics: "Ni/nu nnu/ko- lee/me ||",
      }),
    );
    expect(html).toContain(">Ni</span>");
    expect(html).toContain(">nu</span>");
    expect(html).toContain('grid-column:span 2">me</span>');
    expect(html.match(/class="swara-cell/g)).toHaveLength(6);
    expect(html).not.toContain("colSpan");
    expect(html).toContain("repeat(2, minmax(0, 1fr))");
    expect(html).toContain("repeat(3, minmax(0, 1fr))");
    expect(html).not.toContain("Ni/nu");
    expect(html).toContain("tala-double-end");
  });

  it("treats variant numbers as part of a sound, including octave aliases", () => {
    expect(swaraSlotCount("N2N3")).toBe(2);
    expect(normalizeSwaraToken("n3")).toBe("Ṇ3");
    expect(normalizeSwaraToken("N3'")).toBe("N3̇");
    expect(classifyOctave("Ṇ3")).toBe(OctavePosition.Lower);
    expect(classifyOctave("N3̇")).toBe(OctavePosition.Upper);
    expect(splitSwaraSlots("N3̇Ṇ2,")?.map((slot) => slot.text)).toEqual([
      "N3̇",
      "Ṇ2",
      ",",
    ]);
    expect(parseSwaraDurations("N2N3")[0].sounds).toEqual(["N2", "N3"]);
  });

  it.each(["N4", "M3", "S1", "P2", "R0"])(
    "validates %s in lyrical sections too",
    (swara) => {
      expect(() => parseScoreNotation(`# P\n${swara} ||\nla ||`)).toThrow(
        "Invalid explicit swara variant",
      );
    },
  );
});

it("reports the source line for an invalid opening explicit variant", () => {
  try {
    parseScoreNotation("# A [swaras]\n@Time: 1/4\nN4 ||");
    expect.fail("Invalid variant should fail parsing");
  } catch (error) {
    expect(error).toBeInstanceOf(NotationParseError);
    expect((error as NotationParseError).line).toBe(3);
  }
});

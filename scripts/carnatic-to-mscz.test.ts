import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildMeasures,
  buildMscx,
  convertMdx,
  decomposeUnits,
  listScoreFiles,
  parseSelection,
  scaleDegrees,
  swaraPitch,
  unitsToDuration,
} from "./carnatic-to-mscz.ts";
import {
  CARNATIC_CASES,
  evaluateCase,
  snapshotPathFor,
} from "../components/carnatic-cases.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

const exampleMdx = (notation: string, metadata = "") => `# Example

\`\`\`yaml
title: Example
composer: Purandara Dasa
raga: Mayamalavagowla
${metadata}
\`\`\`

\`\`\`carnatic
${notation}
\`\`\`
`;

describe("scale degrees", () => {
  it("resolves svarasthana semitones from the arohana", () => {
    const degrees = scaleDegrees("S R1 G3 M1 P D1 N3 S");
    expect(degrees.get("S")).toBe(0);
    expect(degrees.get("R")).toBe(1);
    expect(degrees.get("G")).toBe(4);
    expect(degrees.get("M")).toBe(5);
    expect(degrees.get("D")).toBe(8);
    expect(degrees.get("N")).toBe(11);
  });

  it("fills letters missing from the arohana using the avarohana", () => {
    // Malahari: G3 appears only in the descent.
    const degrees = scaleDegrees("S R1 M1 P D1 S", "S D1 P M1 G3 R1 S");
    expect(degrees.get("G")).toBe(4);
    expect(degrees.get("R")).toBe(1);
  });

  it("rejects an unknown svarasthana", () => {
    expect(() => scaleDegrees("S R4 M1 S")).toThrow("Unknown svarasthana");
  });

  it("tolerates typed octave marks in the arohana", () => {
    const degrees = scaleDegrees("S R1' G3 M1 P D1 N3 S");
    expect(degrees.get("R")).toBe(1);
    expect(degrees.get("S")).toBe(0);
  });
});

describe("swara pitch", () => {
  const degrees = scaleDegrees("S R1 G3 M1 P D1 N3 S", "S N3 D1 P M1 G3 R1 S");

  it("maps written Sa to G4 with concert Bb transposition", () => {
    expect(swaraPitch("S", degrees)).toEqual({
      pitch: 67,
      tpc: 15,
      tpc2: 12,
      accidental: undefined,
    });
  });

  it("maps R1 to written Ab with a flat accidental", () => {
    expect(swaraPitch("R", degrees)).toEqual({
      pitch: 68,
      tpc: 10,
      tpc2: 7,
      accidental: "flat",
    });
  });

  it("maps tara-sthayi Sa one octave up and mandra-sthayi Ni one down", () => {
    expect(swaraPitch("Ṡ", degrees).pitch).toBe(79);
    expect(swaraPitch("Ṇ", degrees).pitch).toBe(66);
  });

  it("rejects a swara outside the declared scale", () => {
    expect(() => swaraPitch("G", scaleDegrees("S R1 M1 P D1 S"))).toThrow(
      "not in the declared arohana/avarohana",
    );
    expect(() => swaraPitch("S,", degrees)).toThrow("Cannot read a swara");
  });
});

describe("duration units", () => {
  it("maps units to note values", () => {
    expect(unitsToDuration(1)).toEqual({ type: "quarter" });
    expect(unitsToDuration(2)).toEqual({ type: "half" });
    expect(unitsToDuration(3)).toEqual({ type: "half", dots: 1 });
  });

  it("splits long holds into tied note values, longest first", () => {
    expect(decomposeUnits(9)).toEqual([4, 4, 1]);
    expect(decomposeUnits(6)).toEqual([4, 2]);
    expect(decomposeUnits(1.25)).toEqual([1, 0.25]);
  });
});

describe("measure building", () => {
  const metadata = {
    arohana: "S R1 G3 M1 P D1 N3 S",
    avarohana: "S N3 D1 P M1 G3 R1 S",
  };

  it("splits measures at || and marks anga boundaries for dashed barlines", () => {
    const measures = buildMeasures(
      "# A [swaras]\nS R G M | P D | N Ṡ ||",
      metadata,
      "crotchet",
    );
    expect(measures).toHaveLength(1);
    expect(measures[0].lengthN).toBe(8);
    expect(measures[0].lengthD).toBe(4);
    expect([...measures[0].dashedAfter].sort()).toEqual([3, 5]);
  });

  it("folds duration marks into the previous chord", () => {
    const measures = buildMeasures(
      "# A [swaras]\nS . R ||",
      metadata,
      "crotchet",
    );
    expect(measures[0].events.map((event) => event.units)).toEqual([2, 1]);
    expect(measures[0].lengthN).toBe(3);
  });

  it("rejects a mark with nothing to extend", () => {
    expect(() =>
      buildMeasures("# A [swaras]\n- - ||", metadata, "crotchet"),
    ).toThrow('opens with the duration mark "-"');
  });

  it("engraves * as a rest that marks lengthen", () => {
    const measures = buildMeasures(
      "# A [swaras]\nS * - | R * - - ||",
      metadata,
      "crotchet",
    );
    expect(measures[0].events).toEqual([
      expect.objectContaining({ kind: "chord", units: 1 }),
      expect.objectContaining({ kind: "rest", units: 2 }),
      expect.objectContaining({ kind: "chord", units: 1 }),
      expect.objectContaining({ kind: "rest", units: 3 }),
    ]);
    expect(measures[0].lengthN).toBe(7);
    expect([...measures[0].dashedAfter]).toEqual([1]);
  });

  it("keeps the anga divider after a folded mark cell", () => {
    const measures = buildMeasures(
      "# A [swaras]\nS - | R ||",
      metadata,
      "crotchet",
    );
    expect([...measures[0].dashedAfter]).toEqual([0]);
  });

  it("rejects the retired dhirga mark", () => {
    expect(() =>
      buildMeasures("# A [swaras]\nS ; ||", metadata, "crotchet"),
    ).toThrow('The dhirga mark ";" is not supported');
  });

  it("splits joined swaras into even subdivisions inside one cell", () => {
    const measures = buildMeasures(
      "# A [swaras]\nSR SRGM ||",
      metadata,
      "crotchet",
    );
    expect(measures[0].events.map((event) => event.units)).toEqual([
      0.5, 0.5, 0.25, 0.25, 0.25, 0.25,
    ]);
    expect(measures[0].lengthN).toBe(2);
  });

  it("decomposes long folded holds into tied chords", () => {
    const measures = buildMeasures(
      "# A [swaras]\nS - - - - - - - - ||",
      metadata,
      "crotchet",
    );
    expect(measures[0].events.map((event) => event.units)).toEqual([4, 4, 1]);
    expect(measures[0].events.map((event) => Boolean(event.tieToNext))).toEqual(
      [true, true, false],
    );
    expect(
      measures[0].events.map((event) => Boolean(event.tieFromPrevious)),
    ).toEqual([false, true, true]);
  });

  it("rejects a lyric syllable under a held swara cell", () => {
    expect(() =>
      buildMeasures("# Pallavi\nS , R ||\nLa bo m ||", metadata, "crotchet"),
    ).toThrow("has no note to attach to");
  });

  it("engraves a joined 3-letter token as a triplet", () => {
    const measures = buildMeasures(
      "# A [swaras]\nSRR GMM ||",
      metadata,
      "crotchet",
    );
    // Two crotchet cells, each splitting into three triplet quavers.
    expect(measures[0].lengthN).toBe(2);
    expect(measures[0].events.map((event) => event.units)).toEqual([
      1 / 3,
      1 / 3,
      1 / 3,
      1 / 3,
      1 / 3,
      1 / 3,
    ]);
    const mscx = buildMscx(metadata, measures);
    expect(count(mscx, "<Tuplet>")).toBe(2);
    expect(count(mscx, "<actualNotes>3</actualNotes>")).toBe(2);
    expect(count(mscx, "<normalNotes>2</normalNotes>")).toBe(2);
    expect(count(mscx, "<baseNote>eighth</baseNote>")).toBe(2);
    expect(count(mscx, "<endTuplet/>")).toBe(2);
    expect(count(mscx, "<durationType>eighth</durationType>")).toBe(6);
  });

  it("rejects a held mark inside a triplet token", () => {
    expect(() =>
      buildMeasures("# A [swaras]\nS,R M ||", metadata, "crotchet"),
    ).toThrow("mixes a triplet with a held mark");
  });

  it("splits compact mark slots inside a token", () => {
    // `G,` = quaver G tied to a quaver hold; `D, ,,` = 4 tied quavers.
    const measures = buildMeasures(
      "# A [swaras]\nG, M, D, ,, | NN DN | S, ,, ||",
      metadata,
      "crotchet",
    );
    expect(measures).toHaveLength(1);
    expect(measures[0].lengthN).toBe(8); // 8/4
    expect(measures[0].events.map((event) => event.units)).toEqual([
      1, 1, 2, 0.5, 0.5, 0.5, 0.5, 2,
    ]);
  });

  it("attaches a lyric cell to the first sound of its swara cell", () => {
    const measures = buildMeasures(
      "# P\nG, NN ||\nla nnu ||",
      metadata,
      "crotchet",
    );
    expect(measures[0].events.map((event) => event.lyricText ?? null)).toEqual([
      "la",
      "nnu",
      null,
    ]);
  });

  it("maps slash syllables and trailing continuation to individual sounds", () => {
    const events = buildMeasures(
      "# P\nSR GMM GMM ||\nNi/nu nnu/ko- lee/me ||",
      metadata,
      "crotchet",
    )[0].events;
    expect(events.map((event) => event.lyricText ?? null)).toEqual([
      "Ni",
      "nu",
      "nnu",
      "ko",
      "-",
      "lee",
      "me",
      null,
    ]);
    expect(events.map((event) => event.units)).toEqual([
      0.5,
      0.5,
      1 / 3,
      1 / 3,
      1 / 3,
      1 / 3,
      1 / 3,
      1 / 3,
    ]);
  });

  it("keeps plain lyrics on the first note of each cell", () => {
    const events = buildMeasures(
      "# P\nSR RG GM ,, ||\nNi nnu ko - ||",
      metadata,
      "crotchet",
    )[0].events;
    expect(events.map((event) => event.lyricText ?? null)).toEqual([
      "Ni",
      null,
      "nnu",
      null,
      "ko",
      null,
    ]);
  });

  it("uses N3 as a local accidental in an N2 scale without changing subsequent N", () => {
    const events = buildMeasures(
      "# A [swaras]\nN N3 N N2N3 n3 N3' ||",
      { ...metadata, arohana: "S R2 G3 M1 P D2 N2 S", avarohana: undefined },
      "crotchet",
    )[0].events;
    expect(events.map((event) => event.pitch)).toEqual([
      77, 78, 77, 77, 78, 66, 90,
    ]);
  });

  it("rejects a lyric syllable on a standalone held cell", () => {
    expect(() =>
      buildMeasures("# P\nG , ||\nla bo ||", metadata, "crotchet"),
    ).toThrow("has no note to attach to");
  });

  it("flags the last measure of every section for a section break", () => {
    const measures = buildMeasures(
      "# A [swaras]\nS R ||\nG M ||\n# B [swaras]\nP D ||",
      metadata,
      "crotchet",
    );
    expect(
      measures.map((measure) => Boolean(measure.sectionBreakAfter)),
    ).toEqual([false, true, true]);
  });

  it("lets a section @Time pin a quaver denominator over the score unit", () => {
    // (2+2)/8: two-cell angas of compact 2-slot tokens become quaver cells.
    const measures = buildMeasures(
      "# A [swaras]\n@Time: (2+2)/8\nG, M, | S, ,, ||",
      metadata,
      "crotchet",
    );
    expect(measures).toHaveLength(1);
    expect(measures[0].lengthN).toBe(4);
    expect(measures[0].lengthD).toBe(8);
    expect(measures[0].events.map((event) => event.units)).toEqual([
      0.5, 0.5, 1,
    ]);
  });

  it("applies the declared signature only to its own section", () => {
    const measures = buildMeasures(
      "# A [swaras]\n@Time: (2+2)/8\nG, M, | S, ,, ||\n# B [swaras]\nS R G M ||",
      metadata,
      "crotchet",
    );
    expect(measures.map((measure) => measure.lengthD)).toEqual([8, 4]);
  });

  it("rejects notation that breaks a declared @Time grouping", () => {
    expect(() =>
      buildMeasures(
        "# A [swaras]\n@Time: (2+2)/8\nG, M, D, | S, ,, ||",
        metadata,
        "crotchet",
      ),
    ).toThrow("Anga 1 has 3 cells; @Time (2+2)/8 expects 2.");
  });

  it("resolves octave aliases in swara rows", () => {
    // S' = tāra Ṡ (G5), n = mandra Ṇ (N4 in written pitch space).
    const measures = buildMeasures(
      "# A [swaras]\nS' n ||",
      metadata,
      "crotchet",
    );
    expect(measures[0].events.map((event) => event.pitch)).toEqual([79, 66]);
  });

  it("rejects a contradictory lowercase-letter-plus-apostrophe alias", () => {
    expect(() =>
      buildMeasures("# A [swaras]\nn' S ||", metadata, "crotchet"),
    ).toThrow("Cannot read a swara");
  });

  it("treats an aliased second row of swaras as swaras, not lyrics", () => {
    const measures = buildMeasures("# P\nS R ||\ns r ||", metadata, "crotchet");
    expect(
      measures.map((measure) => measure.events.map((event) => event.pitch)),
    ).toEqual([
      [67, 68],
      [55, 56],
    ]);
  });
});

describe("mscx rendering", () => {
  const metadata = {
    title: "Example",
    composer: "Purandara Dasa",
    raga: "Mayamalavagowla",
    tala: "Aadi",
    talaGrouping: "4 + 2 + 2",
    arohana: "S R1 G3 M1 P D1 N3 S",
    avarohana: "S N3 D1 P M1 G3 R1 S",
  };

  const notation = [
    "# Pallavi",
    "@Sahitya: Example text",
    "S , R | Ṡ . . ||",
    "La - m | bha - - ||",
    "@Repeat: Example text…",
  ].join("\n");

  const mscx = buildMscx(
    metadata,
    buildMeasures(notation, metadata, "crotchet"),
  );

  it("emits the alto sax instrument, G key signature, and lyric colors", () => {
    expect(mscx).toContain(
      `instrumentId>wind.reed.saxophone.alto</instrumentId>`,
    );
    expect(mscx).toContain("<actualKey>1</actualKey>");
    expect(mscx).toContain("<concertKey>-2</concertKey>");
    expect(mscx).toContain(`<lyricsEvenColor r="176" g="0" b="32" a="255"/>`);
  });

  it("emits measure signature, tala dividers, and the end barline", () => {
    expect(mscx).toContain("<sigN>6</sigN>");
    expect(mscx).toContain("<sigD>4</sigD>");
    expect(count(mscx, "<subtype>dashed</subtype>")).toBe(1);
    expect(count(mscx, "<subtype>end</subtype>")).toBe(1);
  });

  it("emits folded durations, ties, and concert-pitch notes", () => {
    // S , = minim, R = crotchet, Ṡ . . = dotted minim (no tie needed here)
    expect(mscx).toContain("<durationType>half</durationType>");
    expect(mscx).toContain("<dots>1</dots>");
    // written Ṡ = G5 (79) sounds concert Bb4 (70)
    expect(mscx).toContain("<pitch>70</pitch>");
    expect(mscx).toContain("<tpc>12</tpc>");
    expect(mscx).toContain("<tpc2>15</tpc2>");
  });

  it("emits styled swara verse-1 and sahitya verse-2 lyrics", () => {
    expect(mscx).toContain("<text><b>Ṡ</b></text>");
    expect(mscx).toContain("<no>1</no>");
    expect(mscx).toContain("<text>bha</text>");
    expect(mscx).toContain("<tpc2>15</tpc2>");
  });

  it("emits section titles, sahitya, and repeat directions", () => {
    expect(mscx).toContain("<RehearsalMark>");
    expect(mscx).toContain("<text>Pallavi</text>");
    expect(mscx).toContain("Sahitya: Example text");
    expect(mscx).toContain("Repeat: Example text…");
  });

  it("emits a section break in the last measure of each section", () => {
    // Pallavi ends on even measure 2, so its section break also replaces the
    // regular two-measure line break there.
    const sections = buildMscx(
      metadata,
      buildMeasures(
        "# A [swaras]\nS R ||\nG M ||\nP D ||\n# B [swaras]\nS G ||",
        metadata,
        "crotchet",
      ),
    );
    expect(count(sections, "<subtype>section</subtype>")).toBe(2);
    expect(count(sections, "<subtype>line</subtype>")).toBe(0);
  });

  it("respects the quaver unit denominator", () => {
    const quaverMscx = buildMscx(
      { ...metadata, notationUnit: "quaver" },
      buildMeasures("# A [swaras]\nS R G M ||", metadata, "quaver"),
    );
    expect(quaverMscx).toContain("<sigN>4</sigN>");
    expect(quaverMscx).toContain("<sigD>8</sigD>");
    expect(quaverMscx).toContain("<durationType>eighth</durationType>");
  });
});

describe("raga registry metadata", () => {
  it("resolves arohana and avarohana from data/ragas.toml via the raga name", () => {
    const { mscx } = convertMdx(exampleMdx("# A [swaras]\nS R G M ||"), {
      stem: "example",
    });
    expect(mscx).toContain("Arohana: S R1 G3 M1 P D1 N3 S");
    expect(mscx).toContain("Avarohana: S N3 D1 P M1 G3 R1 S");
  });

  it("resolves a janya raga's parent scale (Malahari of Mayamalavagowla)", () => {
    const { mscx } = convertMdx(
      exampleMdx("# A [swaras]\nS R M P D ||").replace(
        "raga: Mayamalavagowla",
        "raga: Malahari",
      ),
      { stem: "example" },
    );
    expect(mscx).toContain("Arohana: S R1 M1 P D1 S");
    expect(mscx).toContain("Avarohana: S D1 P M1 G3 R1 S");
  });

  it("rejects an unknown raga and points to the registry", () => {
    expect(() =>
      convertMdx(
        exampleMdx("# A [swaras]\nS R G M ||").replace(
          "raga: Mayamalavagowla",
          "raga: Madeupragam",
        ),
        { stem: "example" },
      ),
    ).toThrow('Unknown raga "Madeupragam"');
  });

  it("rejects plain arohana keys, which are derived from the registry now", () => {
    expect(() =>
      convertMdx(
        exampleMdx("# A [swaras]\nS R G M ||", "arohana: S R1 G3 M1 P D1 N3 S"),
        { stem: "example" },
      ),
    ).toThrow('Metadata "arohana" is now derived from data/ragas.toml');
  });

  it("honours a documented arohana_override as a source-driven variant", () => {
    const { mscx } = convertMdx(
      exampleMdx(
        "# A [swaras]\nS R G M ||",
        [
          "arohana_override: S R1 G3 M1 P D1 S",
          "source: Manuscript excerpt lacked N3 in the ascent",
        ].join("\n"),
      ),
      { stem: "example" },
    );
    expect(mscx).toContain("Arohana: S R1 G3 M1 P D1 S");
    expect(mscx).toContain("Avarohana: S N3 D1 P M1 G3 R1 S");
  });

  it("rejects overrides without a source or notation_exception note", () => {
    expect(() =>
      convertMdx(
        exampleMdx(
          "# A [swaras]\nS R G M ||",
          "arohana_override: S R1 G3 M1 P D1 S",
        ),
        { stem: "example" },
      ),
    ).toThrow("must cite their source");
  });
});

describe("mdx conversion to mscz", () => {
  it("packages the mscx and container manifest into one archive", () => {
    const { mscz, title } = convertMdx(exampleMdx("# A [swaras]\nS R G M ||"), {
      stem: "example",
    });
    expect(title).toBe("Example");
    const files = unzipSync(mscz);
    const names = Object.keys(files).sort();
    expect(names).toEqual(["META-INF/container.xml", "example.mscx"]);
    const container = strFromU8(files["META-INF/container.xml"]);
    expect(container).toContain(`full-path="example.mscx"`);
    const mscx = strFromU8(files["example.mscx"]);
    expect(mscx).toContain("<museScore version=");
  });

  it("reads notation_unit from the YAML metadata", () => {
    const { mscx } = convertMdx(
      exampleMdx("# A [swaras]\nS R G M ||", "notation_unit: quaver"),
      { stem: "example" },
    );
    expect(mscx).toContain("<sigD>8</sigD>");
  });

  it("lets the CLI unit override the metadata", () => {
    const { mscx } = convertMdx(
      exampleMdx("# A [swaras]\nS R G M ||", "notation_unit: quaver"),
      { stem: "example", unit: "crotchet" },
    );
    expect(mscx).toContain("<sigD>4</sigD>");
  });
});

describe("cli score picker", () => {
  it("lists every companion MDX under scores/", () => {
    const files = listScoreFiles(path.join(root, "scores"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.endsWith(".mdx"))).toBe(true);
    expect(files).toContain(
      path.join(root, "scores/02_basics/sri_gananatha_geethe.mdx"),
    );
  });

  it("parses a comma-separated selection into sorted unique indices", () => {
    expect(parseSelection("2, 1 2", 4)).toEqual([0, 1]);
    expect(parseSelection("all", 3)).toEqual([0, 1, 2]);
  });

  it("rejects out-of-range and empty selections", () => {
    expect(() => parseSelection("0", 4)).toThrow("between 1 and 4");
    expect(() => parseSelection("5", 4)).toThrow("between 1 and 4");
    expect(() => parseSelection("x", 4)).toThrow("between 1 and 4");
    expect(() => parseSelection("", 4)).toThrow("at least one");
  });
});

describe("repository scores", () => {
  const scoreFiles = [
    "scores/02_basics/sri_gananatha_geethe.mdx",
    "scores/02_basics/sarale_varase_to_alankaaras.mdx",
    "scores/05_varnams/ninnu_kori_vasantha_varnam.mdx",
    "scores/06_bhajans/bhagyada_lakshmi_baaramma.mdx",
  ];

  it.each(scoreFiles)("converts %s without errors", (relative) => {
    const mdx = fs.readFileSync(path.join(root, relative), "utf8");
    const stem = path.basename(relative, ".mdx");
    const { mscx, mscz, title } = convertMdx(mdx, { stem });
    expect(title).toBeTruthy();
    expect(mscx).toContain("</museScore>");
    expect(Object.keys(unzipSync(mscz))).toContain(`${stem}.mscx`);
  });
});

/**
 * Shared cases: the same list drives the in-browser "Converter test cases"
 * page. Each case is checked against its expectations and its output text is
 * compared with the stored snapshot file. After an intended converter change,
 * accept the new outputs with `npx vitest run -u`.
 */
describe("shared converter cases", () => {
  const groups = [...new Set(CARNATIC_CASES.map((testCase) => testCase.group))];

  it("uses unique case ids", () => {
    const ids = CARNATIC_CASES.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9-]+$/u.test(id))).toBe(true);
  });

  describe.each(groups)("%s", (group) => {
    const cases = CARNATIC_CASES.filter((testCase) => testCase.group === group);

    it.each(cases.map((testCase) => [testCase.title, testCase] as const))(
      "%s",
      async (_title, testCase) => {
        const mdx = testCase.file
          ? fs.readFileSync(path.join(root, testCase.file), "utf8")
          : (testCase.mdx ?? "");
        const evaluation = evaluateCase(convertMdx, testCase, mdx);

        if (evaluation.errorExpectation) {
          expect
            .soft(
              evaluation.errorExpectation.passed,
              evaluation.errorExpectation.message,
            )
            .toBe(true);
        }
        for (const check of evaluation.checks) {
          expect
            .soft(check.passed, `${testCase.id}: ${check.label}`)
            .toBe(true);
        }
        await expect(evaluation.text).toMatchFileSnapshot(
          path.join(root, snapshotPathFor(testCase)),
        );
      },
    );
  });
});

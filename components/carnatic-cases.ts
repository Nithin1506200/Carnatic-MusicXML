/**
 * Shared converter test cases: one list of `carnatic` notation inputs with a
 * description and expectations, consumed by both the Vitest suite
 * (`scripts/carnatic-to-mscz.test.ts`) and the in-browser "Converter test
 * cases" page (`app/converter-cases.tsx`).
 *
 * Each case produces one text output: the generated `.mscx` XML, or the error
 * message when the converter is expected to reject the notation. That text is
 * stored under `components/__snapshots__/carnatic-cases/<id>.txt`; the test
 * suite compares against it with `toMatchFileSnapshot` (accept changes with
 * `npx vitest run -u`), and the page shows the stored snapshot next to a diff
 * whenever the current output differs.
 *
 * This module is browser-safe: it holds data and pure helpers only. Cases that
 * read a repository score name the file, and each environment supplies the
 * file contents (Node reads the disk, Vite imports the raw text).
 */

import type { NoteUnit } from "./carnatic-mscx.ts";

/** One structural expectation on the generated output text. */
export type CaseCheck =
  { contains: string } | { lacks: string } | { count: string; times: number };

export interface CarnaticCase {
  /** Stable identifier; also the snapshot file stem. */
  id: string;
  /** Short name shown in the case list and test title. */
  title: string;
  /** What the case exercises and why the output should look as it does. */
  description: string;
  /** Group heading, mirroring the Vitest describe blocks. */
  group: string;
  /** Full companion MDX (YAML metadata + fenced `carnatic` block). */
  mdx?: string;
  /** Repository score to convert instead of inline `mdx`. */
  file?: string;
  /** CLI-style unit override passed to the converter. */
  unit?: NoteUnit;
  /** When set, the converter must throw a message containing this text. */
  expectError?: string;
  /** Structural checks on the generated `.mscx` (ignored for error cases). */
  checks?: CaseCheck[];
}

export type CaseOutput =
  | { kind: "mscx"; mscx: string; mscz: Uint8Array; title: string }
  | { kind: "error"; message: string };

export interface CaseCheckResult {
  check: CaseCheck;
  passed: boolean;
  /** Human-readable form of the check, e.g. `contains "<sigN>6</sigN>"`. */
  label: string;
}

export interface CaseEvaluation {
  output: CaseOutput;
  /** The text compared against the stored snapshot. */
  text: string;
  /** Whether the thrown/absent error matched `expectError`. */
  errorExpectation: { passed: boolean; message: string } | null;
  checks: CaseCheckResult[];
}

type ConvertMdx = (
  mdx: string,
  options: { stem: string; unit?: string },
) => { mscx: string; mscz: Uint8Array; title: string };

const RAGA = "Mayamalavagowla";

/** Builds a minimal companion MDX around a notation block. */
export const exampleMdx = (
  notation: string,
  metadata: string[] = [],
  raga = RAGA,
) =>
  [
    "# Example",
    "",
    "```yaml",
    "title: Example",
    "composer: Purandara Dasa",
    `raga: ${raga}`,
    ...metadata,
    "```",
    "",
    "```carnatic",
    notation,
    "```",
    "",
  ].join("\n");

const talaMetadata = ['tala: "Aadi"', 'tala_grouping: "4 + 2 + 2"'];

export const CARNATIC_CASES: CarnaticCase[] = [
  // --- Measures and rhythm -------------------------------------------------
  {
    id: "anga-barlines",
    group: "Measures and rhythm",
    title: "Anga boundaries become dashed barlines",
    description:
      "A single Aadi avarta split with `|` at the 4 + 2 + 2 anga boundaries. The measure gets an 8/4 signature and two dashed barlines inside it; the `||` closes the measure with the end barline.",
    mdx: exampleMdx("# A [swaras]\nS R G M | P D | N S\u0307 ||", talaMetadata),
    checks: [
      { contains: "<sigN>8</sigN>" },
      { contains: "<sigD>4</sigD>" },
      { count: "<subtype>dashed</subtype>", times: 2 },
      { count: "<subtype>end</subtype>", times: 1 },
    ],
  },
  {
    id: "folded-duration-mark",
    group: "Measures and rhythm",
    title: "Duration marks fold into the previous note",
    description:
      "`S . R ||`: the `.` extends Sa by one unit, so Sa is a minim and Ri a crotchet in a 3/4 measure.",
    mdx: exampleMdx("# A [swaras]\nS . R ||"),
    checks: [
      { contains: "<sigN>3</sigN>" },
      { count: "<durationType>half</durationType>", times: 1 },
      { count: "<durationType>quarter</durationType>", times: 1 },
    ],
  },
  {
    id: "rest-token",
    group: "Measures and rhythm",
    title: "Rests are written as * and take duration marks",
    description:
      "`S * - R | * - - ||` over `sa - - ri | - - - ||`: each `*` is a one-unit rest, the `-` after the first makes a half rest, the two after the second a dotted-half rest, and a sahitya `-` under a rest is allowed. The measure is 7/4 and the anga divider follows the rest.",
    mdx: exampleMdx("# Pallavi\nS * - R | * - - ||\nsa - - ri | - - - ||"),
    checks: [
      { contains: "<sigN>7</sigN>" },
      { count: "<Rest>", times: 2 },
      { count: "<durationType>half</durationType>", times: 2 },
      { count: "<dots>1</dots>", times: 1 },
      { count: "<subtype>dashed</subtype>", times: 1 },
      { contains: "<text>ri</text>" },
    ],
  },
  {
    id: "rest-carried-across-barline",
    group: "Measures and rhythm",
    title: "A mark opening a measure prolongs a rest too",
    description:
      "`S * || - R ||`: the measure-opening `-` continues the rest that closed the previous measure, so the second measure starts with a crotchet rest and no tie.",
    mdx: exampleMdx("# A [swaras]\nS * ||\n- R ||"),
    checks: [{ count: "<Rest>", times: 2 }, { lacks: "<Tie>" }],
  },
  {
    id: "carry-over-mark-across-barline",
    group: "Measures and rhythm",
    title: "A mark opening a measure ties the previous measure's swara",
    description:
      "The second avarta starts with `-` under the syllable `sā`: the tara Sa that ends the first avarta carries across the barline as a tied crotchet, the syllable attaches to that tied note, and no rest is written.",
    mdx: exampleMdx(
      [
        "# Pallavi",
        "@Time: (4+2+2)/4",
        "S R G M | P D | N S\u0307 ||",
        "sa ri ga ma | pa dha | ni sā ||",
        "- N D P | M G | R S ||",
        "sā ni dha pa | ma ga | ri sa ||",
      ].join("\n"),
      talaMetadata,
    ),
    checks: [
      { count: "<Measure>", times: 2 },
      { count: "<Tie>", times: 1 },
      { count: "<prev>", times: 1 },
      { lacks: "<Rest>" },
      { count: "<text>sā</text>", times: 2 },
      { count: "<pitch>70</pitch>", times: 2 },
    ],
  },
  {
    id: "carry-over-mark-run-across-barline",
    group: "Measures and rhythm",
    title: "A run of marks opening a measure ties a longer hold",
    description:
      "`S R || - - G ||`: the two `-` cells continue Ri for two units into the second measure as a tied minim before Ga sounds, in a 3/4 measure.",
    mdx: exampleMdx("# A [swaras]\nS R ||\n- - G ||"),
    checks: [
      { contains: "<sigN>3</sigN>" },
      { count: "<Tie>", times: 1 },
      { count: "<prev>", times: 1 },
      { count: "<durationType>half</durationType>", times: 1 },
      { lacks: "<Rest>" },
    ],
  },
  {
    id: "joined-swaras-subdivide",
    group: "Measures and rhythm",
    title: "Joined swaras split one cell evenly",
    description:
      "`SR SRGM ||`: two letters share a crotchet as quavers and four letters share it as semiquavers, in a 2/4 measure.",
    mdx: exampleMdx("# A [swaras]\nSR SRGM ||"),
    checks: [
      { contains: "<sigN>2</sigN>" },
      { count: "<durationType>eighth</durationType>", times: 2 },
      { count: "<durationType>16th</durationType>", times: 4 },
    ],
  },
  {
    id: "long-hold-tied",
    group: "Measures and rhythm",
    title: "Long holds decompose into tied notes",
    description:
      "`S - - - - - - - - ||` holds Sa for nine units: engraved as semibreve + semibreve + crotchet joined with ties.",
    mdx: exampleMdx("# A [swaras]\nS - - - - - - - - ||"),
    checks: [
      { contains: "<sigN>9</sigN>" },
      { count: "<durationType>whole</durationType>", times: 2 },
      { count: "<Tie>", times: 2 },
      { count: "<prev>", times: 2 },
    ],
  },
  {
    id: "triplet-token",
    group: "Measures and rhythm",
    title: "Three joined letters engrave as a triplet",
    description:
      "`SRR GMM ||`: each three-letter token becomes a 3:2 quaver tuplet inside one crotchet cell.",
    mdx: exampleMdx("# A [swaras]\nSRR GMM ||"),
    checks: [
      { count: "<Tuplet>", times: 2 },
      { count: "<actualNotes>3</actualNotes>", times: 2 },
      { count: "<normalNotes>2</normalNotes>", times: 2 },
      { count: "<baseNote>eighth</baseNote>", times: 2 },
      { count: "<endTuplet/>", times: 2 },
      { count: "<durationType>eighth</durationType>", times: 6 },
    ],
  },
  {
    id: "compact-mark-slots",
    group: "Measures and rhythm",
    title: "Compact mark slots inside a token",
    description:
      "`G, M, D, ,, | NN DN | S, ,, ||`: `G,` is a quaver G tied to a quaver hold (one crotchet), `D, ,,` four tied quavers (a minim), giving an 8/4 measure.",
    mdx: exampleMdx(
      "# A [swaras]\nG, M, D, ,, | NN DN | S, ,, ||",
      talaMetadata,
    ),
    checks: [
      { contains: "<sigN>8</sigN>" },
      { count: "<durationType>half</durationType>", times: 2 },
      { count: "<durationType>quarter</durationType>", times: 2 },
      { count: "<durationType>eighth</durationType>", times: 4 },
    ],
  },
  {
    id: "lyric-unsplit-melisma",
    group: "Measures and rhythm",
    title: "Plain lyric syllables extend across joined swaras",
    description:
      "SR RG GM ,, over Ni nnu ko - keeps each syllable on the first sound of its cell.",
    mdx: exampleMdx("# P\nSR RG GM ,, ||\nNi nnu ko - ||"),
    checks: [{ count: "<no>1</no>", times: 3 }],
  },
  {
    id: "lyric-slash-syllables",
    group: "Measures and rhythm",
    title: "Slash-separated syllables align within joined swaras",
    description:
      "Ni/nu maps to S/R; nnu/ko- maps to G/M/M; lee/me maps to G/M with me continuing on the final M. The swara preview keeps three equal beat columns, with subdivisions inside each beat.",
    mdx: exampleMdx("# P\n@Time: 3/4\nSR GMM GMM ||\nNi/nu nnu/ko- lee/me ||"),
    checks: [
      { contains: "<sigN>3</sigN>" },
      { contains: "<sigD>4</sigD>" },
      { count: "<no>1</no>", times: 7 },
      { contains: "<text>ko</text>" },
      { lacks: "<text>Ni/nu</text>" },
    ],
  },
  {
    id: "explicit-swara-variants",
    group: "Pitch and octaves",
    title: "Explicit variants override the raga for individual notes",
    description:
      "N2 N3 N preserves both variants and returns to Harikambhoji’s default N2. Numbered swaras also work in compact tokens and octave aliases.",
    mdx: exampleMdx("# A [swaras]\nN2 N3 N N2N3 n2 N3' ||", [], "Harikambhoji"),
    checks: [
      { contains: "<pitch>68</pitch>" },
      { contains: "<pitch>69</pitch>" },
      { contains: "<pitch>56</pitch>" },
      { contains: "<pitch>81</pitch>" },
    ],
  },
  ...["Ni//nu", "Ni/nu/ko", "/Ni", "Ni/"].map((lyric, index) => ({
    id: `reject-invalid-lyric-split-${index + 1}`,
    group: "Rejected notation",
    title: `Reject malformed or overfull lyric split: ${lyric}`,
    description:
      "Split syllables must be non-empty and fit within their paired swara cell.",
    mdx: exampleMdx(`# P\nSR ||\n${lyric} ||`),
    expectError: "must have non-empty syllables",
  })),
  {
    id: "reject-lyric-on-held-slot",
    group: "Rejected notation",
    title: "Reject a split syllable on a held slot",
    description: "A continuation slot cannot start a new lyric syllable.",
    mdx: exampleMdx("# P\nG, ||\nla/ti ||"),
    expectError: "falls under a held swara slot",
  },
  ...["N4", "M3", "S1", "P2", "R0"].map((swara) => ({
    id: `reject-explicit-variant-${swara.toLowerCase()}`,
    group: "Rejected notation",
    title: `Reject invalid explicit variant ${swara}`,
    description: "Only R/G/D/N 1–3 and M 1–2 have numbered variants.",
    mdx: exampleMdx(`# A [swaras]\n${swara} ||`),
    expectError: "Invalid explicit swara variant",
  })),
  {
    id: "lyric-attaches-to-first-sound",
    group: "Measures and rhythm",
    title: "A lyric cell attaches to the first sound of its swara cell",
    description:
      "`G, NN` over `la nnu`: `la` sits under the G quaver and `nnu` under the first N; the second N carries no sahitya.",
    mdx: exampleMdx("# P\nG, NN ||\nla nnu ||"),
    checks: [
      { contains: "<text>la</text>" },
      { contains: "<text>nnu</text>" },
      { count: "<no>1</no>", times: 2 },
    ],
  },
  {
    id: "section-breaks",
    group: "Measures and rhythm",
    title: "Section breaks after the last measure of every section",
    description:
      "Two sections with two and one measures: the last measure of each section carries a section layout break, so the score prints two of them.",
    mdx: exampleMdx("# A [swaras]\nS R ||\nG M ||\n# B [swaras]\nP D ||"),
    checks: [
      { count: "<subtype>section</subtype>", times: 2 },
      { count: "<RehearsalMark>", times: 2 },
    ],
  },
  {
    id: "time-directive-quaver",
    group: "Measures and rhythm",
    title: "@Time pins a quaver denominator over the score unit",
    description:
      "`@Time: (2+2)/8` makes two-cell angas of compact two-slot tokens into quaver cells: the measure prints 4/8 although the score unit is a crotchet.",
    mdx: exampleMdx("# A [swaras]\n@Time: (2+2)/8\nG, M, | S, ,, ||"),
    checks: [
      { contains: "<sigN>4</sigN>" },
      { contains: "<sigD>8</sigD>" },
      { count: "<subtype>dashed</subtype>", times: 1 },
    ],
  },
  {
    id: "time-directive-own-section",
    group: "Measures and rhythm",
    title: "@Time applies only to its own section",
    description:
      "Section A declares `(2+2)/8`; section B has no directive and falls back to the crotchet unit, so the two measures carry different signatures.",
    mdx: exampleMdx(
      "# A [swaras]\n@Time: (2+2)/8\nG, M, | S, ,, ||\n# B [swaras]\nS R G M ||",
    ),
    checks: [{ contains: "<sigD>8</sigD>" }, { contains: "<sigD>4</sigD>" }],
  },
  {
    id: "octave-aliases",
    group: "Measures and rhythm",
    title: "Octave aliases in swara rows",
    description:
      "`S' n ||`: an apostrophe raises Sa to tara S\u0307 (written G5, concert Bb4 = 70) and a lowercase letter lowers Ni to mandra N\u0323 (written F#4, concert A3 = 57).",
    mdx: exampleMdx("# A [swaras]\nS' n ||"),
    checks: [
      { contains: "<pitch>70</pitch>" },
      { contains: "<pitch>57</pitch>" },
      { contains: "<b>S\u0307</b>" },
    ],
  },
  {
    id: "aliased-second-row-is-swaras",
    group: "Measures and rhythm",
    title: "A lowercase second row is swaras, not lyrics",
    description:
      "`s r` under `S R` is a mandra-sthayi swara row rather than sahitya: the score has two measures and no verse-2 lyrics.",
    mdx: exampleMdx("# P\nS R ||\ns r ||"),
    checks: [{ count: "<Measure", times: 2 }, { lacks: "<no>1</no>" }],
  },

  // --- Full score rendering -------------------------------------------------
  {
    id: "pallavi-rendering",
    group: "Score rendering",
    title: "Instrument, key, lyrics, and directions",
    description:
      "A Pallavi with a sahitya row, `@Sahitya` and `@Repeat` directives under Aadi tala: alto sax instrument, G written key over concert Bb, bold swara verse 1, crimson sahitya verse 2, a rehearsal mark, and the two direction texts.",
    mdx: exampleMdx(
      [
        "# Pallavi",
        "@Sahitya: Example text",
        "S , R | S\u0307 . . ||",
        "La - m | bha - - ||",
        "@Repeat: Example text…",
      ].join("\n"),
      talaMetadata,
    ),
    checks: [
      { contains: "instrumentId>wind.reed.saxophone.alto</instrumentId>" },
      { contains: "<actualKey>1</actualKey>" },
      { contains: "<concertKey>-2</concertKey>" },
      { contains: '<lyricsEvenColor r="176" g="0" b="32" a="255"/>' },
      { contains: "<sigN>6</sigN>" },
      { count: "<subtype>dashed</subtype>", times: 1 },
      { count: "<subtype>end</subtype>", times: 1 },
      { contains: "<dots>1</dots>" },
      { contains: "<pitch>70</pitch>" },
      { contains: "<tpc>12</tpc>" },
      { contains: "<tpc2>15</tpc2>" },
      { contains: "<text><b>S\u0307</b></text>" },
      { contains: "<text>bha</text>" },
      { contains: "<RehearsalMark>" },
      { contains: "<text>Pallavi</text>" },
      { contains: "Sahitya: Example text" },
      { contains: "Repeat: Example text…" },
    ],
  },
  {
    id: "quaver-unit-metadata",
    group: "Score rendering",
    title: "notation_unit: quaver from the YAML metadata",
    description:
      "With `notation_unit: quaver` each cell is a quaver, so `S R G M ||` prints a 4/8 measure of quavers.",
    mdx: exampleMdx("# A [swaras]\nS R G M ||", ["notation_unit: quaver"]),
    checks: [
      { contains: "<sigN>4</sigN>" },
      { contains: "<sigD>8</sigD>" },
      { count: "<durationType>eighth</durationType>", times: 4 },
    ],
  },
  {
    id: "cli-unit-overrides-metadata",
    group: "Score rendering",
    title: "A CLI unit overrides the metadata unit",
    description:
      "The same quaver score converted with `--unit crotchet`: the override wins and the measure prints 4/4.",
    mdx: exampleMdx("# A [swaras]\nS R G M ||", ["notation_unit: quaver"]),
    unit: "crotchet",
    checks: [{ contains: "<sigD>4</sigD>" }],
  },

  // --- Raga registry ---------------------------------------------------------
  {
    id: "raga-registry-scale",
    group: "Raga registry",
    title: "Arohana and avarohana come from data/ragas.toml",
    description:
      "The metadata declares only `raga: Mayamalavagowla`; the scale text in the score is derived from the registry.",
    mdx: exampleMdx("# A [swaras]\nS R G M ||"),
    checks: [
      { contains: "Arohana: S R1 G3 M1 P D1 N3 S" },
      { contains: "Avarohana: S N3 D1 P M1 G3 R1 S" },
    ],
  },
  {
    id: "janya-raga-parent-scale",
    group: "Raga registry",
    title: "A janya raga resolves its parent scale",
    description:
      "Malahari is a janya of Mayamalavagowla; G3 appears only in its avarohana and the registry supplies both rows.",
    mdx: exampleMdx("# A [swaras]\nS R M P D ||", [], "Malahari"),
    checks: [
      { contains: "Arohana: S R1 M1 P D1 S" },
      { contains: "Avarohana: S D1 P M1 G3 R1 S" },
    ],
  },
  {
    id: "arohana-override-with-source",
    group: "Raga registry",
    title: "A sourced arohana_override is honoured",
    description:
      "`arohana_override` with a `source` note replaces the registry ascent while the descent stays registry-derived.",
    mdx: exampleMdx("# A [swaras]\nS R G M ||", [
      "arohana_override: S R1 G3 M1 P D1 S",
      "source: Manuscript excerpt lacked N3 in the ascent",
    ]),
    checks: [
      { contains: "Arohana: S R1 G3 M1 P D1 S" },
      { contains: "Avarohana: S N3 D1 P M1 G3 R1 S" },
    ],
  },

  // --- Rejected notation ---------------------------------------------------
  {
    id: "reject-section-opening-mark",
    group: "Rejected notation",
    title: "A mark opening a section",
    description:
      "Section B starts with `-` after section A ended on Ri. A carry never crosses a section heading and silence must be written as `*`, so the mark has nothing to extend.",
    mdx: exampleMdx("# A [swaras]\nS R ||\n# B [swaras]\n- G ||"),
    expectError: 'Section "B" opens with the duration mark "-"',
  },
  {
    id: "reject-dhirga-mark",
    group: "Rejected notation",
    title: "The dhirga mark ;",
    description:
      "`S ; ||`: `;` is not part of the grammar. Hold a swara with one `,` or `-` cell per beat.",
    mdx: exampleMdx("# A [swaras]\nS ; ||"),
    expectError: 'The dhirga mark ";" is not supported',
  },
  {
    id: "reject-lyric-under-rest",
    group: "Rejected notation",
    title: "A lyric syllable under a rest cell",
    description: "`S * ||` over `sa bo ||`: a rest has no note for `bo`.",
    mdx: exampleMdx("# P\nS * ||\nsa bo ||"),
    expectError: "falls under a rest cell",
  },
  {
    id: "reject-lyric-under-held-cell",
    group: "Rejected notation",
    title: "A lyric syllable under a held swara cell",
    description:
      "`S , R` over `La bo m`: the `,` cell has no note, so the syllable `bo` cannot attach to anything.",
    mdx: exampleMdx("# Pallavi\nS , R ||\nLa bo m ||"),
    expectError: "has no note to attach to",
  },
  {
    id: "reject-lyric-on-standalone-hold",
    group: "Rejected notation",
    title: "A lyric syllable on a standalone held cell",
    description:
      "`G , ||` over `la bo ||`: the standalone hold cell has no note for `bo`.",
    mdx: exampleMdx("# P\nG , ||\nla bo ||"),
    expectError: "has no note to attach to",
  },
  {
    id: "reject-held-mark-in-triplet",
    group: "Rejected notation",
    title: "A held mark inside a triplet token",
    description:
      "`S,R` mixes a three-slot triplet with a held mark, which has no engraving.",
    mdx: exampleMdx("# A [swaras]\nS,R M ||"),
    expectError: "mixes a triplet with a held mark",
  },
  {
    id: "reject-time-grouping-mismatch",
    group: "Rejected notation",
    title: "Notation that breaks a declared @Time grouping",
    description:
      "`@Time: (2+2)/8` expects two cells per anga but the first anga has three.",
    mdx: exampleMdx("# A [swaras]\n@Time: (2+2)/8\nG, M, D, | S, ,, ||"),
    expectError: "Anga 1 has 3 cells; @Time (2+2)/8 expects 2.",
  },
  {
    id: "reject-contradictory-alias",
    group: "Rejected notation",
    title: "A lowercase letter with an apostrophe",
    description:
      "`n'` asks for mandra and tara at once, so it is not a readable swara.",
    mdx: exampleMdx("# A [swaras]\nn' S ||"),
    expectError: "Cannot read a swara",
  },
  {
    id: "reject-unknown-raga",
    group: "Rejected notation",
    title: "An unregistered raga",
    description:
      "`raga: Madeupragam` is not in data/ragas.toml; the error points to the registry.",
    mdx: exampleMdx("# A [swaras]\nS R G M ||", [], "Madeupragam"),
    expectError: 'Unknown raga "Madeupragam"',
  },
  {
    id: "reject-plain-arohana-key",
    group: "Rejected notation",
    title: "A plain arohana key in the metadata",
    description:
      "Scale rows are derived from the registry; a literal `arohana:` key is rejected.",
    mdx: exampleMdx("# A [swaras]\nS R G M ||", [
      "arohana: S R1 G3 M1 P D1 N3 S",
    ]),
    expectError: 'Metadata "arohana" is now derived from data/ragas.toml',
  },
  {
    id: "reject-override-without-source",
    group: "Rejected notation",
    title: "An override with no source note",
    description:
      "`arohana_override` without `source` or `notation_exception` must be refused.",
    mdx: exampleMdx("# A [swaras]\nS R G M ||", [
      "arohana_override: S R1 G3 M1 P D1 S",
    ]),
    expectError: "must cite their source",
  },

  // --- Repository scores ---------------------------------------------------
  {
    id: "score-sri-gananatha-geethe",
    group: "Repository scores",
    title: "scores/02_basics/sri_gananatha_geethe.mdx",
    description: "The full companion MDX converts without errors.",
    file: "scores/02_basics/sri_gananatha_geethe.mdx",
    checks: [{ contains: "</museScore>" }],
  },
  {
    id: "score-sarale-varase-to-alankaaras",
    group: "Repository scores",
    title: "scores/02_basics/sarale_varase_to_alankaaras.mdx",
    description: "The full companion MDX converts without errors.",
    file: "scores/02_basics/sarale_varase_to_alankaaras.mdx",
    checks: [{ contains: "</museScore>" }],
  },
  {
    id: "score-ninnu-kori-vasantha-varnam",
    group: "Repository scores",
    title: "scores/05_varnams/ninnu_kori_vasantha_varnam.mdx",
    description: "The full companion MDX converts without errors.",
    file: "scores/05_varnams/ninnu_kori_vasantha_varnam.mdx",
    checks: [{ contains: "</museScore>" }],
  },
  {
    id: "score-bhagyada-lakshmi-baaramma",
    group: "Repository scores",
    title: "scores/06_bhajans/bhagyada_lakshmi_baaramma.mdx",
    description: "The full companion MDX converts without errors.",
    file: "scores/06_bhajans/bhagyada_lakshmi_baaramma.mdx",
    checks: [{ contains: "</museScore>" }],
  },
];

/** Snapshot file path (repository-relative) for a case. */
export const snapshotPathFor = (testCase: CarnaticCase) =>
  `components/__snapshots__/carnatic-cases/${testCase.id}.txt`;

/** The converter stem for a case: the score file stem, else the case id. */
export const stemFor = (testCase: CarnaticCase) =>
  testCase.file
    ? testCase.file.replace(/^.*\//, "").replace(/\.mdx$/, "")
    : testCase.id;

const countOf = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

export const describeCheck = (check: CaseCheck): string => {
  if ("contains" in check) return `contains ${JSON.stringify(check.contains)}`;
  if ("lacks" in check) return `lacks ${JSON.stringify(check.lacks)}`;
  return `${JSON.stringify(check.count)} × ${check.times}`;
};

export const runCheck = (mscx: string, check: CaseCheck): CaseCheckResult => {
  let passed: boolean;
  if ("contains" in check) passed = mscx.includes(check.contains);
  else if ("lacks" in check) passed = !mscx.includes(check.lacks);
  else passed = countOf(mscx, check.count) === check.times;
  return { check, passed, label: describeCheck(check) };
};

/** Turns a converter result into the snapshot text. */
export const outputText = (output: CaseOutput): string =>
  output.kind === "mscx" ? output.mscx : `Error: ${output.message}\n`;

/** Runs the converter on a case; the MDX source has already been resolved. */
export const runCase = (
  convertMdx: ConvertMdx,
  testCase: CarnaticCase,
  mdx: string,
): CaseOutput => {
  try {
    const converted = convertMdx(mdx, {
      stem: stemFor(testCase),
      unit: testCase.unit,
    });
    return { kind: "mscx", ...converted };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

/** Runs the converter and evaluates the case's expectations. */
export const evaluateCase = (
  convertMdx: ConvertMdx,
  testCase: CarnaticCase,
  mdx: string,
): CaseEvaluation => {
  const output = runCase(convertMdx, testCase, mdx);
  let errorExpectation: CaseEvaluation["errorExpectation"] = null;
  if (testCase.expectError !== undefined) {
    if (output.kind === "error") {
      const passed = output.message.includes(testCase.expectError);
      errorExpectation = {
        passed,
        message: passed
          ? `Rejected as expected: ${JSON.stringify(testCase.expectError)}`
          : `Expected an error containing ${JSON.stringify(testCase.expectError)}, got: ${output.message}`,
      };
    } else {
      errorExpectation = {
        passed: false,
        message: `Expected an error containing ${JSON.stringify(testCase.expectError)}, but the conversion succeeded.`,
      };
    }
  } else if (output.kind === "error") {
    errorExpectation = {
      passed: false,
      message: `Expected a successful conversion, got: ${output.message}`,
    };
  }
  const checks =
    output.kind === "mscx"
      ? (testCase.checks ?? []).map((check) => runCheck(output.mscx, check))
      : [];
  return { output, text: outputText(output), errorExpectation, checks };
};

/** Whether every expectation of an evaluation held. */
export const evaluationPassed = (evaluation: CaseEvaluation): boolean =>
  (evaluation.errorExpectation?.passed ?? true) &&
  evaluation.checks.every((check) => check.passed);
